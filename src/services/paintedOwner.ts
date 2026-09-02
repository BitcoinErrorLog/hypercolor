import type { PubkyKey } from '../types';
import { KeyStore } from './KeyStore';

/**
 * Painted session identity for owner-conditional commits.
 *
 * Precedence: explicit signing-out → explicit owner paint → auth store →
 * KeyStore. Absence (null) is fail-closed at commit whenever a write names
 * an expected owner. Schema / pre-auth tests must {@link paintOwner}, not
 * rely on a production skip.
 */
export const SIGNING_OUT = 'signing-out';

export type PaintedOwner = PubkyKey | typeof SIGNING_OUT | null;

type Overlay = { kind: 'unset' } | { kind: 'owner'; pubky: PubkyKey } | { kind: 'signing-out' };

let overlay: Overlay = { kind: 'unset' };
let authOwnerReader: (() => PubkyKey | null) | null = null;

export function registerAuthOwnerReader(reader: () => PubkyKey | null): void {
  authOwnerReader = reader;
}

/** Active identity for commit guards. Call on sign-in / session adopt. */
export function paintOwner(pubky: PubkyKey): void {
  overlay = { kind: 'owner', pubky };
}

/**
 * Distinct no-owner state. Paint synchronously before any sign-out await
 * so in-flight owned writes cannot interleave with teardown.
 */
export function paintSigningOut(): void {
  overlay = { kind: 'signing-out' };
}

/** Drop the overlay so auth / KeyStore (or null) are the paint again. */
export function clearPaintedOwner(): void {
  overlay = { kind: 'unset' };
}

export function activeOwnerAtCommit(): PaintedOwner {
  if (overlay.kind === 'signing-out') return SIGNING_OUT;
  if (overlay.kind === 'owner') return overlay.pubky;
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
