import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { PubkyKey, UserProfile } from '../types';

interface AuthState {
  isAuthenticated: boolean;
  pubky: PubkyKey | null;
  homeserver: string | null;
  profile: UserProfile | null;

  setAuthenticated: (pubky: PubkyKey, homeserver: string) => void;
  setProfile: (profile: UserProfile) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  immer(set => ({
    isAuthenticated: false,
    pubky: null,
    homeserver: null,
    profile: null,

    setAuthenticated: (pubky, homeserver) =>
      set(state => {
        state.isAuthenticated = true;
        state.pubky = pubky;
        state.homeserver = homeserver;
      }),

    setProfile: profile =>
      set(state => {
        state.profile = profile;
      }),

    clearSession: () =>
      set(state => {
        state.isAuthenticated = false;
        state.pubky = null;
        state.homeserver = null;
        state.profile = null;
      }),
  })),
);
