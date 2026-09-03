import type { Contact, PubkyKey } from '../../../types';
import type { TrustExplanation } from '../../../services/TrustEngine';
import { linkStateLabel } from './ContactDetailView';

export type ContactDetailLoadResult = {
  contact: Contact | null;
  trust: TrustExplanation | null;
  linkLabel: string;
  paymentIdentifiers: string[];
  paymentsUnavailableOffline: boolean;
  loadError: string | null;
  loadErrorDetails: string | null;
};

export type ContactDetailLoadDeps = {
  ownerPubky: PubkyKey;
  pubky: PubkyKey;
  stored: Contact | undefined;
  isCurrent: () => boolean;
  getContact: (pubky: PubkyKey, ownerPubky: PubkyKey) => Promise<Contact | null>;
  explainTrust: (pubky: PubkyKey, ownerPubky: PubkyKey) => Promise<TrustExplanation>;
  getLink: (ownerPubky: PubkyKey, peerPubky: PubkyKey) => Promise<{ status: string } | null>;
  getPeerTipEndpoints: (pubky: PubkyKey) => Promise<Array<{ identifier: string }>>;
};

/**
 * Loads root ContactDetail data. Callers bump a generation / owner token
 * and pass `isCurrent` so an A→B identity switch discards A's deferred
 * storage and payment results instead of rendering them under B.
 */
export async function loadContactDetail(
  deps: ContactDetailLoadDeps,
): Promise<ContactDetailLoadResult | 'cancelled'> {
  if (!deps.isCurrent()) return 'cancelled';
  try {
    const row = deps.stored ?? (await deps.getContact(deps.pubky, deps.ownerPubky));
    if (!deps.isCurrent()) return 'cancelled';
    if (!row || row.ownerPubky !== deps.ownerPubky) {
      return emptyError('Could not load this contact.', null);
    }
    const explained = await deps.explainTrust(row.pubky, deps.ownerPubky);
    if (!deps.isCurrent()) return 'cancelled';
    const link = await deps.getLink(deps.ownerPubky, row.pubky);
    if (!deps.isCurrent()) return 'cancelled';
    const status =
      link?.status === 'established' || link?.status === 'handshaking' ? link.status : null;
    try {
      const tips = await deps.getPeerTipEndpoints(row.pubky);
      if (!deps.isCurrent()) return 'cancelled';
      return {
        contact: row,
        trust: explained,
        linkLabel: linkStateLabel(status),
        paymentIdentifiers: tips.map(t => t.identifier),
        paymentsUnavailableOffline: false,
        loadError: null,
        loadErrorDetails: null,
      };
    } catch {
      if (!deps.isCurrent()) return 'cancelled';
      return {
        contact: row,
        trust: explained,
        linkLabel: linkStateLabel(status),
        paymentIdentifiers: [],
        paymentsUnavailableOffline: true,
        loadError: null,
        loadErrorDetails: null,
      };
    }
  } catch (err) {
    if (!deps.isCurrent()) return 'cancelled';
    return emptyError(
      'Could not load this contact.',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function emptyError(loadError: string, loadErrorDetails: string | null): ContactDetailLoadResult {
  return {
    contact: null,
    trust: null,
    linkLabel: linkStateLabel(null),
    paymentIdentifiers: [],
    paymentsUnavailableOffline: false,
    loadError,
    loadErrorDetails,
  };
}
