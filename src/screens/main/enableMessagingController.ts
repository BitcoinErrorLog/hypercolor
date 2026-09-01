import type { LinkEnableFlow, LinkEnableStatus } from '../../services/link/LinkService';

export type EnableMessagingPhase =
  | 'checking'
  | 'native-missing'
  | 'enabled'
  | 'session-offline'
  | 'authorizing'
  | 'success'
  | 'error';

export type EnableMessagingState = {
  phase: EnableMessagingPhase;
  authorizationUrl: string | null;
  message: string | null;
  pubky: string | null;
  receiverPath: string | null;
  copied: boolean;
};

export const INITIAL_ENABLE_MESSAGING_STATE: EnableMessagingState = {
  phase: 'checking',
  authorizationUrl: null,
  message: null,
  pubky: null,
  receiverPath: null,
  copied: false,
};

export type EnableMessagingDeps = {
  getEnableStatus: () => Promise<LinkEnableStatus>;
  enable: () => Promise<LinkEnableFlow>;
  openUrl: (url: string) => Promise<void>;
  copyText: (text: string) => void;
};

export type EnableMessagingController = {
  getState: () => EnableMessagingState;
  subscribe: (listener: (state: EnableMessagingState) => void) => () => void;
  start: () => Promise<void>;
  beginAuth: () => Promise<void>;
  openRing: () => Promise<void>;
  copyAuthorizationUrl: () => void;
  cancel: () => void;
};

/** Paykit emits this exact scheme. Only these URLs may be handed to the OS. */
export const PUBKYAUTH_URL_PREFIX = 'pubkyauth://';

export function isAutoOpenableAuthUrl(url: string): boolean {
  return url.startsWith(PUBKYAUTH_URL_PREFIX);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return String(err);
}

export function createEnableMessagingController(
  deps: EnableMessagingDeps,
): EnableMessagingController {
  let state: EnableMessagingState = { ...INITIAL_ENABLE_MESSAGING_STATE };
  let flow: LinkEnableFlow | null = null;
  let cancelled = false;
  const listeners = new Set<(next: EnableMessagingState) => void>();

  function emit(patch: Partial<EnableMessagingState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  async function beginAuth(): Promise<void> {
    if (cancelled) return;
    try {
      flow = await deps.enable();
      if (cancelled) {
        flow.cancel();
        return;
      }
      emit({
        phase: 'authorizing',
        authorizationUrl: flow.authorizationUrl,
        message: null,
        copied: false,
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
      if (cancelled) return;
      emit({
        phase: 'success',
        pubky: enabled.pubky,
        receiverPath: enabled.receiverPath,
        message: null,
      });
    } catch (err) {
      if (cancelled) return;
      emit({
        phase: 'error',
        message: errorMessage(err),
      });
    }
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
      let status: LinkEnableStatus;
      try {
        status = await deps.getEnableStatus();
      } catch (err) {
        if (cancelled) return;
        emit({ phase: 'error', message: errorMessage(err) });
        return;
      }
      if (cancelled) return;
      if (status === 'native-missing') {
        emit({
          phase: 'native-missing',
          message: 'PaykitLinkModule is not linked into this build.',
        });
        return;
      }
      if (status === 'enabled') {
        emit({
          phase: 'enabled',
          message: 'Encrypted messaging is already enabled on this device.',
        });
        return;
      }
      if (status === 'session-offline') {
        emit({
          phase: 'session-offline',
          message:
            'A messaging session exists but could not be restored. Authorize again when the network is available.',
        });
        return;
      }
      await beginAuth();
    },
    beginAuth,
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
