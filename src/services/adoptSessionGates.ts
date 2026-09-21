import { COPY } from '../copy/uxCopy';
import { capabilitiesCoverRingGrant } from '../types/link';
import { KeyStore } from './KeyStore';
import { PaykitLinkNative, isLinkNativeError } from './link/PaykitLinkNative';
import { LinkService } from './link/LinkService';

export class BindingMismatchError extends Error {
  override readonly name = 'BindingMismatchError';
  constructor(message = 'Approved session pubky does not match the persisted owner') {
    super(message);
  }
}

export class ScopesDeclinedError extends Error {
  override readonly name = 'ScopesDeclinedError';
  constructor(message = COPY.authorizationDeclinedBody) {
    super(message);
  }
}

export function isBindingMismatchError(err: unknown): boolean {
  return err instanceof BindingMismatchError;
}

export function isScopesDeclinedError(err: unknown): boolean {
  return err instanceof ScopesDeclinedError;
}

export type SessionCapabilitySet = {
  capabilities: string;
  origin: string;
};

/**
 * F2: when a persisted owner exists, a different approved pubky is rejected
 * by signing out *that alias only*. Never wipe the persisted owner.
 */
export async function rejectIfOwnerMismatch(
  sessionAlias: string,
  sessionPubky: string,
): Promise<'match' | 'fresh'> {
  let persistedOwner: string | null = null;
  try {
    persistedOwner = KeyStore.isInitialized() ? KeyStore.getPubky() : null;
  } catch {
    persistedOwner = null;
  }
  if (!persistedOwner) return 'fresh';
  if (persistedOwner === sessionPubky) return 'match';
  await LinkService.signOutSessionQuiet(sessionAlias);
  throw new BindingMismatchError();
}

/**
 * F7: read the session capability set from the pinned homeserver `/session`
 * and require coverage of both RING_GRANT scopes before any KeyStore commit.
 */
export async function requireRingGrantCoverage(
  sessionAlias: string,
): Promise<SessionCapabilitySet> {
  let inspected: SessionCapabilitySet;
  try {
    inspected = await PaykitLinkNative.sessionCapabilities(sessionAlias);
  } catch (err) {
    await LinkService.signOutSessionQuiet(sessionAlias);
    if (isLinkNativeError(err) && (err.code === 'auth' || err.code === 'validation')) {
      throw new ScopesDeclinedError();
    }
    throw err;
  }
  if (!capabilitiesCoverRingGrant(inspected.capabilities)) {
    await LinkService.signOutSessionQuiet(sessionAlias);
    throw new ScopesDeclinedError();
  }
  return inspected;
}

export async function revokeUncommittedAlias(sessionAlias: string): Promise<void> {
  await LinkService.signOutSessionQuiet(sessionAlias);
  KeyStore.deleteLinkSessionIfAlias(sessionAlias);
}
