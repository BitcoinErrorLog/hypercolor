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
  starting: boolean;
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
  starting: false,
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
  __testing: {
    lateFlowDispositionSize: () => number;
  };
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
  let attempt = 0;
  let starting = false;
  let statusGeneration = 0;
  const lateFlowDisposition = new Map<number, 'release' | 'cancel'>();
  const listeners = new Set<(next: EnableMessagingState) => void>();
  const now = () => (deps.now ? deps.now() : Date.now());

  function emit(patch: Partial<EnableMessagingState>): void {
    state = { ...state, ...patch };
    if (typeof patch.starting === 'boolean') {
      starting = patch.starting;
    }
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

  function isCurrentAttempt(generation: number): boolean {
    return !cancelled && generation === attempt;
  }

  /**
   * Status and enable() share `attempt`. A newer status that lands while
   * enable() is still unresolved must invalidate that attempt so its later
   * resolution cannot overwrite Success or leave the CTA latch stuck.
   */
  function invalidateStartingAttempt(status: LinkEnableStatus): void {
    if (!starting) return;
    lateFlowDisposition.set(attempt, status === 'enabled' ? 'release' : 'cancel');
    attempt += 1;
  }

  function disposeLateFlow(myAttempt: number, nextFlow: LinkEnableFlow): void {
    const recorded = lateFlowDisposition.get(myAttempt);
    lateFlowDisposition.delete(myAttempt);
    // Enabled: FGS stop only. cancel+drain would sign out the live session.
    if (recorded === 'release' || (recorded === undefined && state.phase === 'success')) {
      nextFlow.releaseKeepalive();
      return;
    }
    nextFlow.cancel();
    void nextFlow.awaitEnabled().catch(() => undefined);
  }

  async function applyStatus(status: LinkEnableStatus): Promise<void> {
    invalidateStartingAttempt(status);
    if (status === 'native-missing') {
      flow?.cancel();
      flow = null;
      emitPhase('native-missing', { starting: false });
      return;
    }
    if (status === 'enabled') {
      flow?.releaseKeepalive();
      emitPhase('success', {
        authorizationUrl: null,
        authorizingStartedAt: null,
        starting: false,
      });
      return;
    }
    if (status === 'session-offline') {
      emitPhase('session-offline', {
        authorizationUrl: null,
        authorizingStartedAt: null,
        starting: false,
      });
      return;
    }
    emitPhase('needs-enable', {
      authorizationUrl: null,
      authorizingStartedAt: null,
      starting: false,
    });
  }

  async function beginAuth(): Promise<void> {
    if (cancelled) return;
    if (starting) return;
    if (state.phase === 'authorizing' && flow) return;
    if (flow && state.phase !== 'success') {
      flow.cancel();
      flow = null;
    }
    const myAttempt = ++attempt;
    emit({ starting: true });
    try {
      const nextFlow = await deps.enable();
      if (!isCurrentAttempt(myAttempt)) {
        disposeLateFlow(myAttempt, nextFlow);
        return;
      }
      flow = nextFlow;
      emitPhase('authorizing', {
        authorizationUrl: flow.authorizationUrl,
        copied: false,
        authorizingStartedAt: now(),
        details: null,
        starting: false,
      });
      if (isAutoOpenableAuthUrl(flow.authorizationUrl)) {
        try {
          await deps.openUrl(flow.authorizationUrl);
        } catch {
          // Keep authorizing; the user can tap Open Pubky Ring or scan the QR.
        }
      }
      if (!isCurrentAttempt(myAttempt)) {
        return;
      }
      const enabled = await flow.awaitEnabled();
      if (!isCurrentAttempt(myAttempt)) return;
      if (state.phase === 'success') return;
      emitPhase('success', {
        pubky: enabled.pubky,
        receiverPath: enabled.receiverPath,
        authorizationUrl: null,
        authorizingStartedAt: null,
        starting: false,
      });
    } catch (err) {
      lateFlowDisposition.delete(myAttempt);
      if (!isCurrentAttempt(myAttempt)) return;
      if (state.phase === 'success' || state.phase === 'expired' || state.phase === 'denied') {
        return;
      }
      const sanitized = sanitizeError(err);
      if (isDeniedEnableError(err)) {
        emitPhase('denied', { details: sanitized.details, starting: false });
        return;
      }
      emitPhase('error', {
        message: sanitized.message,
        details: sanitized.details,
        starting: false,
      });
    } finally {
      lateFlowDisposition.delete(myAttempt);
      if (myAttempt === attempt && starting) {
        emit({ starting: false });
      }
    }
  }

  async function readStatusAndApply(): Promise<void> {
    const gen = ++statusGeneration;
    let status: LinkEnableStatus;
    try {
      status = await deps.getEnableStatus();
    } catch (err) {
      if (cancelled || gen !== statusGeneration) return;
      const sanitized = sanitizeError(err);
      emitPhase('error', { message: sanitized.message, details: sanitized.details });
      return;
    }
    if (cancelled || gen !== statusGeneration) return;
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
      attempt += 1;
      starting = false;
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
      const gen = ++statusGeneration;
      let status: LinkEnableStatus;
      try {
        status = await deps.getEnableStatus();
      } catch {
        return;
      }
      if (cancelled || gen !== statusGeneration) return;
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
            starting: false,
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
      attempt += 1;
      if (state.phase === 'success') {
        flow?.releaseKeepalive();
        emit({ starting: false });
        return;
      }
      flow?.cancel();
      flow = null;
      emit({ starting: false });
    },
    __testing: {
      lateFlowDispositionSize: () => lateFlowDisposition.size,
    },
  };
}
