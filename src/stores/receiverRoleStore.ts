import { create } from 'zustand';
import type { ReceiverRole } from '../types/link';

interface ReceiverRoleState {
  role: ReceiverRole | null;
  toast: string | null;
  needsReenable: boolean;
  snoozedStandby: boolean;
  snoozedReenable: boolean;
  setRole: (
    role: ReceiverRole | null,
    toast?: string | null,
    extras?: { needsReenable?: boolean },
  ) => void;
  snoozeCurrentBanner: () => void;
  clearToast: () => void;
  reset: () => void;
}

export const useReceiverRoleStore = create<ReceiverRoleState>(set => ({
  role: null,
  toast: null,
  needsReenable: false,
  snoozedStandby: false,
  snoozedReenable: false,
  setRole: (role, toast = null, extras) =>
    set({
      role,
      toast: toast ?? null,
      needsReenable: extras?.needsReenable ?? false,
    }),
  snoozeCurrentBanner: () =>
    set(s => {
      if (s.role === 'standby') return { snoozedStandby: true };
      if (s.needsReenable) return { snoozedReenable: true };
      return {};
    }),
  clearToast: () => set({ toast: null }),
  reset: () =>
    set({
      role: null,
      toast: null,
      needsReenable: false,
      snoozedStandby: false,
      snoozedReenable: false,
    }),
}));

export function setReceiverRoleState(
  role: ReceiverRole | null,
  toast: string | null = null,
  extras?: { needsReenable?: boolean },
): void {
  useReceiverRoleStore.getState().setRole(role, toast, extras);
}
