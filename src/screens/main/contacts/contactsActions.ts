import type {
  AddContactResult,
  ImportFollowsRefreshResult,
} from '../../../services/ContactsService';
import type { PubkyKey } from '../../../types';

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
  addManualContact: (owner: PubkyKey, pubky: string) => Promise<AddContactResult>;
}): Promise<AddContactResult> {
  if (!args.ownerPubky) {
    return { ok: false, reason: 'error', message: 'Could not add that contact.' };
  }
  return args.addManualContact(args.ownerPubky, args.pubky);
}
