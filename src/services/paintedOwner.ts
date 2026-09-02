import type { PubkyKey } from '../types';
import { KeyStore } from './KeyStore';

/**
 * Painted session identity for owner-conditional commits.
 *
 * Precedence: explicit signing-out → explicit owner paint → needs-sign-in
 * (no fallback) → auth store → KeyStore. Absence (null) is fail-closed at
 * commit whenever a write names an expected owner. Schema / pre-auth tests
 * must {@link paintOwner}, not rely on a production skip.
 *
 * Sign-out restore is compare-and-swap against a generation captured at
 * {@link ensureSignOutPaint}. {@link paintOwner} bumps the generation so a
 * concurrent sign-in cannot be overwritten by a late prelude restore.
 */
export const SIGNING_OUT = 'signing-out';

export type PaintedOwner = PubkyKey | typeof SIGNING_OUT | null;

type Overlay =
  | { kind: 'unset' }
  | { kind: 'owner'; pubky: PubkyKey }
  | { kind: 'signing-out' }
  | { kind: 'needs-sign-in' };

let overlay: Overlay = { kind: 'unset' };
let authOwnerReader: (() => PubkyKey | null) | null = null;
let signOutGeneration = 0;
let wipeInFlight: Promise<void> | null = null;

export function registerAuthOwnerReader(reader: () => PubkyKey | null): void {
  authOwnerReader = reader;
}

/** Active identity for commit guards. Call on sign-in / session adopt. */
export function paintOwner(pubky: PubkyKey): void {
  signOutGeneration += 1;
  overlay = { kind: 'owner', pubky };
}

/**
 * Distinct no-owner state. Paint synchronously before any sign-out await
 * so in-flight owned writes cannot interleave with teardown.
 */
export function paintSigningOut(): void {
  overlay = { kind: 'signing-out' };
}

/**
 * Start (or reuse) a sign-out paint and return the generation that a later
 * {@link restorePaintedOwner} must match. Idempotent while already
 * signing-out so ProfileScreen + PubkyService + LinkService share one
 * generation.
 */
export function ensureSignOutPaint(): number {
  if (overlay.kind === 'signing-out') return signOutGeneration;
  signOutGeneration += 1;
  overlay = { kind: 'signing-out' };
  return signOutGeneration;
}

/**
 * Re-paint the still-signed-in owner after a *reversible* sign-out failure
 * (prelude or unverified marker). Restores only while paint is still
 * {@link SIGNING_OUT} and `generation` is the current sign-out generation.
 * A {@link paintOwner} or {@link invalidateSignOutRestore} in between leaves
 * the concurrent paint in place.
 */
export function restorePaintedOwner(pubky: PubkyKey, generation: number): void {
  if (overlay.kind !== 'signing-out') return;
  if (generation !== signOutGeneration) return;
  overlay = { kind: 'owner', pubky };
}

/**
 * Bump the sign-out generation so a pending restore cannot fire. Called
 * after the sign-out marker is verified, before the first destructive
 * statement, and implicitly by {@link paintOwner}.
 */
export function invalidateSignOutRestore(): void {
  signOutGeneration += 1;
}

export function currentSignOutGeneration(): number {
  return signOutGeneration;
}

/**
 * Non-destructive signed-out paint: commit identity is null and does not
 * fall through to KeyStore.getPubky(). Used after a completed boot wipe
 * and when the interrupted-sign-out marker cannot be read.
 */
export function paintNeedsSignIn(): void {
  overlay = { kind: 'needs-sign-in' };
}

export function isNeedsSignInPaint(): boolean {
  return overlay.kind === 'needs-sign-in';
}

/**
 * True while teardown is in flight or the session was cleared to Welcome
 * without an owner. App startup must not drain or recover under this.
 */
export function shouldHoldPreAuthWork(): boolean {
  return overlay.kind === 'signing-out' || overlay.kind === 'needs-sign-in';
}

/**
 * Drop the in-memory overlay so commit identity is read from auth / KeyStore.
 * Boot calls this after confirming sign-out is not incomplete, matching a
 * fresh JS context. Do not call this to undo a failed sign-out — use
 * {@link restorePaintedOwner} for the reversible prelude only.
 */
export function resetPaintOverlayForBoot(): void {
  overlay = { kind: 'unset' };
  signOutGeneration = 0;
}

export function trackWipeInFlight<T>(work: Promise<T>): Promise<T> {
  const gate: Promise<void> = work.then(
    () => undefined,
    () => undefined,
  );
  wipeInFlight = gate;
  void gate.finally(() => {
    if (wipeInFlight === gate) wipeInFlight = null;
  });
  return work;
}

export async function waitForWipeInFlight(): Promise<void> {
  if (wipeInFlight) await wipeInFlight;
}

export function hasWipeInFlight(): boolean {
  return wipeInFlight !== null;
}

/**
 * Returns the in-flight wipe promise, or null when idle. Callers that must
 * not yield a microtask when there is no wipe (Ring cancel vs approve)
 * should `if (pending) await pending` rather than always `await`.
 */
export function pendingWipeInFlight(): Promise<void> | null {
  return wipeInFlight;
}

export function activeOwnerAtCommit(): PaintedOwner {
  if (overlay.kind === 'signing-out') return SIGNING_OUT;
  if (overlay.kind === 'owner') return overlay.pubky;
  if (overlay.kind === 'needs-sign-in') return null;
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
