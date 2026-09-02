import type { LinkEnableFlow, LinkEnableStatus } from '../../services/link/LinkService';
import { COPY, ENABLE_AUTH_TTL_MS } from '../../copy/uxCopy';
import { isDeniedEnableError, sanitizeError } from '../../ui/sanitizedError';

export type EnableMessagingPhase =
  | 'checking'
  | 'native-missing'
  | 'needs-enable'
  | 'session-offline'
  | 'authorizing'
  | 'expired'
  | 'denied'
  | 'success'
  | 'error';

export type EnableMessagingState = {
  phase: EnableMessagingPhase;
  authorizationUrl: string | null;
  message: string | null;
  details: string | null;
  pubky: string | null;
  receiverPath: string | null;
  copied: boolean;
  authorizingStartedAt: number | null;
};

export const INITIAL_ENABLE_MESSAGING_STATE: EnableMessagingState = {
  phase: 'checking',
  authorizationUrl: null,
  message: null,
  details: null,
  pubky: null,
  receiverPath: null,
  copied: false,
  authorizingStartedAt: null,
};

export type EnableMessagingDeps = {
  getEnableStatus: () => Promise<LinkEnableStatus>;
  enable: () => Promise<LinkEnableFlow>;
  openUrl: (url: string) => Promise<void>;
  copyText: (text: string) => void;
  now?: () => number;
};

export type EnableMessagingController = {
  getState: () => EnableMessagingState;
  subscribe: (listener: (state: EnableMessagingState) => void) => () => void;
  start: () => Promise<void>;
  beginAuth: () => Promise<void>;
  retry: () => Promise<void>;
  onAppActive: () => Promise<void>;
  openRing: () => Promise<void>;
  copyAuthorizationUrl: () => void;
  cancel: () => void;
};

/** Paykit emits this exact scheme. Only these URLs may be handed to the OS. */
export const PUBKYAUTH_URL_PREFIX = 'pubkyauth://';

export function isAutoOpenableAuthUrl(url: string): boolean {
  return url.startsWith(PUBKYAUTH_URL_PREFIX);
}

function phaseMessage(phase: EnableMessagingPhase): string | null {
  switch (phase) {
    case 'checking':
      return null;
    case 'native-missing':
      return COPY.messagingUnavailable;
    case 'needs-enable':
      return COPY.approveScopesBody;
    case 'session-offline':
      return COPY.sessionOfflineBanner;
    case 'authorizing':
      return COPY.waitingForRingBody;
    case 'expired':
      return COPY.enableExpiredBody;
    case 'denied':
      return COPY.authorizationDeclinedBody;
    case 'success':
      return COPY.encryptedMessagingEnabledBody;
    case 'error':
      return COPY.couldNotStartAuthorization;
  }
}

export function createEnableMessagingController(
  deps: EnableMessagingDeps,
): EnableMessagingController {
  let state: EnableMessagingState = { ...INITIAL_ENABLE_MESSAGING_STATE };
  let flow: LinkEnableFlow | null = null;
  let cancelled = false;
  const listeners = new Set<(next: EnableMessagingState) => void>();
  const now = () => (deps.now ? deps.now() : Date.now());

  function emit(patch: Partial<EnableMessagingState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  function emitPhase(phase: EnableMessagingPhase, extra: Partial<EnableMessagingState> = {}): void {
    emit({
      phase,
      message: extra.message ?? phaseMessage(phase),
      details: extra.details ?? null,
      ...extra,
    });
  }

  function isPastTtl(startedAt: number | null): boolean {
    if (startedAt === null) return false;
    return now() - startedAt >= ENABLE_AUTH_TTL_MS;
  }

  async function applyStatus(status: LinkEnableStatus): Promise<void> {
    if (status === 'native-missing') {
      flow?.cancel();
      flow = null;
      emitPhase('native-missing');
      return;
    }
    if (status === 'enabled') {
      flow?.cancel();
      flow = null;
      emitPhase('success', {
        authorizationUrl: null,
        authorizingStartedAt: null,
      });
      return;
    }
    if (status === 'session-offline') {
      emitPhase('session-offline', {
        authorizationUrl: null,
        authorizingStartedAt: null,
      });
      return;
    }
    emitPhase('needs-enable', {
      authorizationUrl: null,
      authorizingStartedAt: null,
    });
  }

  async function beginAuth(): Promise<void> {
    if (cancelled) return;
    try {
      flow = await deps.enable();
      if (cancelled) {
        flow.cancel();
        return;
      }
      emitPhase('authorizing', {
        authorizationUrl: flow.authorizationUrl,
        copied: false,
        authorizingStartedAt: now(),
        details: null,
      });
      // Only pubkyauth:// may hit the OS. https:/intent: URLs carry a client
      // secret and would leak it to a browser or another app. Non-matching
      // schemes stay authorizing so QR + copy still work.
      if (isAutoOpenableAuthUrl(flow.authorizationUrl)) {
        try {
          await deps.openUrl(flow.authorizationUrl);
        } catch {
          // Keep authorizing; the user can tap Open Pubky Ring or scan the QR.
        }
      }
      if (cancelled) {
        flow.cancel();
        return;
      }
      const enabled = await flow.awaitEnabled();
      if (cancelled || state.phase !== 'authorizing') return;
      emitPhase('success', {
        pubky: enabled.pubky,
        receiverPath: enabled.receiverPath,
        authorizationUrl: null,
        authorizingStartedAt: null,
      });
    } catch (err) {
      if (cancelled || state.phase !== 'authorizing') return;
      const sanitized = sanitizeError(err);
      if (isDeniedEnableError(err)) {
        emitPhase('denied', { details: sanitized.details });
        return;
      }
      emitPhase('error', {
        message: sanitized.message,
        details: sanitized.details,
      });
    }
  }

  async function readStatusAndApply(): Promise<void> {
    let status: LinkEnableStatus;
    try {
      status = await deps.getEnableStatus();
    } catch (err) {
      if (cancelled) return;
      const sanitized = sanitizeError(err);
      emitPhase('error', { message: sanitized.message, details: sanitized.details });
      return;
    }
    if (cancelled) return;
    await applyStatus(status);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      cancelled = false;
      emit({ ...INITIAL_ENABLE_MESSAGING_STATE });
      await readStatusAndApply();
    },
    beginAuth,
    async retry() {
      if (cancelled) return;
      if (state.phase === 'denied' || state.phase === 'expired' || state.phase === 'error') {
        await beginAuth();
        return;
      }
      await readStatusAndApply();
    },
    async onAppActive() {
      if (cancelled) return;
      let status: LinkEnableStatus;
      try {
        status = await deps.getEnableStatus();
      } catch {
        return;
      }
      if (cancelled) return;
      if (status === 'enabled') {
        await applyStatus(status);
        return;
      }
      if (status === 'session-offline') {
        await applyStatus(status);
        return;
      }
      if (state.phase === 'authorizing') {
        if (isPastTtl(state.authorizingStartedAt)) {
          flow?.cancel();
          flow = null;
          emitPhase('expired', {
            authorizationUrl: null,
            authorizingStartedAt: null,
          });
        }
        return;
      }
      if (state.phase === 'checking' || state.phase === 'needs-enable') {
        await applyStatus(status);
      }
    },
    async openRing() {
      const url = state.authorizationUrl;
      if (!url) {
        throw new Error('No authorization URL to open');
      }
      if (!isAutoOpenableAuthUrl(url)) {
        return;
      }
      await deps.openUrl(url);
    },
    copyAuthorizationUrl() {
      const url = state.authorizationUrl;
      if (!url) return;
      deps.copyText(url);
      emit({ copied: true });
    },
    cancel() {
      cancelled = true;
      flow?.cancel();
    },
  };
}
