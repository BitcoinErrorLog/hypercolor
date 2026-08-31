import { KeyStore } from '../services/KeyStore';
import { useAuthStore } from '../stores/authStore';
import type { PubkyKey } from '../types';

export type E2eSignupHudState = {
  pubky: string;
  secretHex: string;
  homeserverPubky: string;
  error?: boolean;
};

export type E2eSavedIdentity = {
  pubky: string;
  secretHex: string;
  homeserverPubky: string;
};

const savedIdentities = new Map<string, E2eSavedIdentity>();

export function saveE2eIdentity(slot: string, identity: E2eSavedIdentity): void {
  const key = slot.trim().toLowerCase();
  if (key.length === 0) return;
  savedIdentities.set(key, identity);
}

export function getE2eIdentity(slot: string): E2eSavedIdentity | null {
  return savedIdentities.get(slot.trim().toLowerCase()) ?? null;
}

let hud: E2eSignupHudState | null = null;
const listeners = new Set<(value: E2eSignupHudState | null) => void>();

export function getE2eSignupHud(): E2eSignupHudState | null {
  return hud;
}

export function setE2eSignupHud(value: E2eSignupHudState | null): void {
  hud = value;
  for (const listener of listeners) listener(hud);
}

export function subscribeE2eSignupHud(
  listener: (value: E2eSignupHudState | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Continue after a successful debug signup. Re-applies auth so Android
 * Intent / React Navigation linking cannot leave Welcome on screen after
 * the HUD is dismissed.
 */
export function applyE2eSignupContinue(state: E2eSignupHudState | null): boolean {
  setE2eSignupHud(null);
  if (!state || state.error) return false;
  const homeserver = state.homeserverPubky.trim();
  const pubky = state.pubky.trim();
  if (homeserver.length === 0 || pubky.length === 0 || pubky.startsWith('error:')) {
    return false;
  }
  KeyStore.setHomeserver(homeserver);
  useAuthStore.getState().setAuthenticated(pubky as PubkyKey, homeserver);
  return true;
}
