import { AppState } from 'react-native';
import { create } from 'zustand';
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
  setPendingRequestCount: (count: number) => void;
  setGroupUnreadCount: (count: number) => void;
}

let refreshGeneration = 0;

async function runRefresh(): Promise<void> {
  const gen = ++refreshGeneration;
  const { isAuthenticated, pubky } = useAuthStore.getState();
  if (!isAuthenticated || !pubky) {
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

  let receiverPublished = false;
  let pending = useSessionStatusStore.getState().pendingRequestCount;
  let groupUnread = useSessionStatusStore.getState().groupUnreadCount;
  try {
    const [receiver, pendingCount, unread] = await Promise.all([
      StorageService.getLinkReceiver(pubky),
      StorageService.countPendingMessageRequests(pubky),
      StorageService.countUnreadGroupMessages(pubky),
    ]);
    if (gen !== refreshGeneration) return;
    receiverPublished = receiver?.markerPublished === true;
    pending = pendingCount;
    groupUnread = unread;
  } catch {
    // Optional reads must not overwrite getEnableStatus().
  }
  if (gen !== refreshGeneration) return;

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
    try {
      await LinkService.restorePersistedSession();
    } catch {
      // Status refresh below reports offline vs enabled.
    }
    await useSessionStatusStore.getState().refresh();
  },
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
