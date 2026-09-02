import { create } from 'zustand';
import { LinkService, type LinkEnableStatus } from '../services/link/LinkService';
import { StorageService } from '../services/StorageService';
import { useAuthStore } from './authStore';
import {
  isBannerSessionKind,
  sessionUiFromEnableStatus,
  type SessionUiKind,
} from '../ui/sessionUi';

interface SessionStatusState {
  kind: SessionUiKind;
  enableStatus: LinkEnableStatus | null;
  pendingRequestCount: number;
  refreshing: boolean;
  refresh: () => Promise<void>;
  retryOffline: () => Promise<void>;
  setPendingRequestCount: (count: number) => void;
}

export const useSessionStatusStore = create<SessionStatusState>(set => ({
  kind: 'no-identity',
  enableStatus: null,
  pendingRequestCount: 0,
  refreshing: false,

  setPendingRequestCount: count => set({ pendingRequestCount: count }),

  refresh: async () => {
    const { isAuthenticated, pubky } = useAuthStore.getState();
    if (!isAuthenticated || !pubky) {
      set({ kind: 'no-identity', enableStatus: null });
      return;
    }
    set({ refreshing: true });
    try {
      const [status, receiver, pending] = await Promise.all([
        LinkService.getEnableStatus(),
        StorageService.getLinkReceiver(pubky),
        StorageService.countPendingMessageRequests(pubky),
      ]);
      const kind = sessionUiFromEnableStatus(true, status, receiver?.markerPublished === true);
      set({
        kind,
        enableStatus: status,
        pendingRequestCount: pending,
        refreshing: false,
      });
    } catch {
      set({ refreshing: false });
    }
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
