import { AppState } from 'react-native';
import { create } from 'zustand';
import { KeyStore } from '../services/KeyStore';
import { LinkService, type LinkEnableStatus } from '../services/link/LinkService';
import { StorageService } from '../services/StorageService';
import { useAuthStore } from './authStore';
import {
  isBannerSessionKind,
  sessionUiFromEnableStatus,
  type SessionUiKind,
} from '../ui/sessionUi';
import { sanitizeError, type SanitizedError } from '../ui/sanitizedError';

export const SESSION_STATUS_POLL_MS = 15_000;

interface SessionStatusState {
  kind: SessionUiKind;
  enableStatus: LinkEnableStatus | null;
  pendingRequestCount: number;
  groupUnreadCount: number;
  refreshing: boolean;
  lastError: SanitizedError | null;
  refresh: () => Promise<void>;
  retryOffline: () => Promise<void>;
  markKeystoreUnavailable: () => void;
  setPendingRequestCount: (count: number) => void;
  setGroupUnreadCount: (count: number) => void;
}

let refreshGeneration = 0;
let lastReceiverPublished: { pubky: string; published: boolean } | null = null;

export function resetSessionStatusReceiverEvidence(): void {
  if (process.env.NODE_ENV !== 'test' && !(typeof __DEV__ !== 'undefined' && __DEV__)) {
    return;
  }
  lastReceiverPublished = null;
}

async function runRefresh(): Promise<void> {
  if (!KeyStore.isInitialized()) {
    useSessionStatusStore.getState().markKeystoreUnavailable();
    return;
  }
  const gen = ++refreshGeneration;
  const { isAuthenticated, pubky } = useAuthStore.getState();
  if (!isAuthenticated || !pubky) {
    lastReceiverPublished = null;
    useSessionStatusStore.setState({
      kind: 'no-identity',
      enableStatus: null,
      lastError: null,
      refreshing: false,
    });
    return;
  }
  useSessionStatusStore.setState({ refreshing: true });

  let status: LinkEnableStatus;
  try {
    status = await LinkService.getEnableStatus();
  } catch (err) {
    if (gen !== refreshGeneration) return;
    const lastError = sanitizeError(err);
    const networkish = lastError.category === 'offline' || lastError.category === 'network';
    useSessionStatusStore.setState({
      lastError,
      kind: networkish ? 'offline' : useSessionStatusStore.getState().kind,
      refreshing: false,
    });
    return;
  }
  if (gen !== refreshGeneration) return;

  let receiverPublished =
    lastReceiverPublished?.pubky === pubky ? lastReceiverPublished.published : false;
  let pending = useSessionStatusStore.getState().pendingRequestCount;
  let groupUnread = useSessionStatusStore.getState().groupUnreadCount;
  const [receiverResult, pendingResult, unreadResult] = await Promise.allSettled([
    StorageService.getLinkReceiver(pubky),
    StorageService.countPendingMessageRequests(pubky),
    StorageService.countUnreadGroupMessages(pubky),
  ]);
  if (gen !== refreshGeneration) return;
  if (receiverResult.status === 'fulfilled') {
    receiverPublished = receiverResult.value?.markerPublished === true;
    lastReceiverPublished = { pubky, published: receiverPublished };
  }
  if (pendingResult.status === 'fulfilled') {
    pending = pendingResult.value;
  }
  if (unreadResult.status === 'fulfilled') {
    groupUnread = unreadResult.value;
  }

  const kind = sessionUiFromEnableStatus(true, status, receiverPublished);
  useSessionStatusStore.setState({
    kind,
    enableStatus: status,
    pendingRequestCount: pending,
    groupUnreadCount: groupUnread,
    lastError: null,
    refreshing: false,
  });
}

export const useSessionStatusStore = create<SessionStatusState>(set => ({
  kind: 'no-identity',
  enableStatus: null,
  pendingRequestCount: 0,
  groupUnreadCount: 0,
  refreshing: false,
  lastError: null,

  setPendingRequestCount: count => set({ pendingRequestCount: count }),
  setGroupUnreadCount: count => set({ groupUnreadCount: count }),

  refresh: async () => {
    await runRefresh();
  },

  retryOffline: async () => {
    if (!KeyStore.isInitialized()) {
      useSessionStatusStore.getState().markKeystoreUnavailable();
      return;
    }
    try {
      await LinkService.restorePersistedSession();
    } catch {
      // Status refresh below reports offline vs enabled.
    }
    await useSessionStatusStore.getState().refresh();
  },

  markKeystoreUnavailable: () =>
    set({
      kind: 'keystore-unavailable',
      enableStatus: null,
      lastError: null,
      refreshing: false,
    }),
}));

export function sessionBannerVisible(kind: SessionUiKind): boolean {
  return isBannerSessionKind(kind);
}

/** Single app-shell owner: AppState, bounded poll. Screens must not refresh this store. */
export function startSessionStatusLifecycle(): () => void {
  void useSessionStatusStore.getState().refresh();
  const poll = setInterval(() => {
    if (useAuthStore.getState().isAuthenticated) {
      void useSessionStatusStore.getState().refresh();
    }
  }, SESSION_STATUS_POLL_MS);
  const sub = AppState.addEventListener('change', next => {
    if (next === 'active' && useAuthStore.getState().isAuthenticated) {
      void useSessionStatusStore.getState().refresh();
    }
  });
  return () => {
    clearInterval(poll);
    sub.remove();
  };
}
