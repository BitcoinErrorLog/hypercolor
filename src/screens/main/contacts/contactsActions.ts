import { COPY } from '../../../copy/uxCopy';
import type {
  AddContactResult,
  AddManualContactOptions,
  ImportFollowsRefreshResult,
} from '../../../services/ContactsService';
import type { PubkyKey } from '../../../types';
import { parseContactQrPayload } from '../../../utils/contactQrPayload';

/**
 * Pull-to-refresh on Contacts. Consent is looked up inside
 * `refreshFollowsIfEnabled` at call time — this helper must not pass a
 * caller boolean that could override the persisted per-owner flag.
 */
export async function pullToRefreshFollows(args: {
  ownerPubky: PubkyKey | null;
  refreshFollowsIfEnabled: (owner: PubkyKey) => Promise<ImportFollowsRefreshResult>;
}): Promise<ImportFollowsRefreshResult | null> {
  if (!args.ownerPubky) return null;
  return args.refreshFollowsIfEnabled(args.ownerPubky);
}

export function afterManualContactAdded(pubky: PubkyKey): {
  detailPubky: PubkyKey;
  navigateArgs: ['Main', { screen: 'Contacts'; params: { focusPubky: PubkyKey } }];
} {
  return {
    detailPubky: pubky,
    navigateArgs: ['Main', { screen: 'Contacts', params: { focusPubky: pubky } }],
  };
}

export async function submitManualContact(args: {
  ownerPubky: PubkyKey | null;
  pubky: string;
  addManualContact: (
    owner: PubkyKey,
    pubky: string,
    options?: AddManualContactOptions,
  ) => Promise<AddContactResult>;
  confirmUnblock?: boolean;
}): Promise<AddContactResult> {
  if (!args.ownerPubky) {
    return { ok: false, reason: 'error', message: 'Could not add that contact.' };
  }
  if (args.confirmUnblock === true) {
    return args.addManualContact(args.ownerPubky, args.pubky, { confirmUnblock: true });
  }
  return args.addManualContact(args.ownerPubky, args.pubky);
}

export type ScannedContactDecision =
  | { kind: 'add'; pubky: PubkyKey }
  | { kind: 'error'; message: string };

export function decideScannedContact(
  raw: string,
  ownerPubky: string | null,
): ScannedContactDecision {
  const parsed = parseContactQrPayload(raw);
  if (!parsed.ok) return { kind: 'error', message: parsed.message };
  if (ownerPubky && parsed.pubky === ownerPubky) {
    return { kind: 'error', message: COPY.thatsYourOwnPubky };
  }
  return { kind: 'add', pubky: parsed.pubky };
}
