import type { PubkyKey } from '../types';
import { KeyStore } from './KeyStore';

/**
 * Painted session identity for owner-conditional commits. The auth store
 * registers a reader at module load; SQL tests that never import authStore
 * fall through to KeyStore, then to "no session" (skip the commit guard).
 */
let authOwnerReader: (() => PubkyKey | null) | null = null;

export function registerAuthOwnerReader(reader: () => PubkyKey | null): void {
  authOwnerReader = reader;
}

export function activeOwnerAtCommit(): PubkyKey | null {
  if (authOwnerReader) {
    try {
      const fromAuth = authOwnerReader();
      if (fromAuth) return fromAuth;
    } catch {
      // Fall through to KeyStore.
    }
  }
  const getPubky = KeyStore.getPubky;
  if (typeof getPubky !== 'function') return null;
  try {
    return getPubky() ?? null;
  } catch {
    return null;
  }
}
