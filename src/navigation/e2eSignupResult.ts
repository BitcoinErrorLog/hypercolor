export type E2eSignupHudState = {
  pubky: string;
  secretHex: string;
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
