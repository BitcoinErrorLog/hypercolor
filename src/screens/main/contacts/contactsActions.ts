import type {
  AddContactResult,
  ImportFollowsRefreshResult,
} from '../../../services/ContactsService';
import type { PubkyKey } from '../../../types';

/**
 * Pull-to-refresh on Contacts. The consent flag is passed through so
 * `refreshFollowsIfEnabled` can skip homeserver follows listing and Nexus
 * when import is off.
 */
export async function pullToRefreshFollows(args: {
  ownerPubky: PubkyKey | null;
  followsImportEnabled: boolean;
  refreshFollowsIfEnabled: (
    owner: PubkyKey,
    enabled: boolean,
  ) => Promise<ImportFollowsRefreshResult>;
}): Promise<ImportFollowsRefreshResult | null> {
  if (!args.ownerPubky) return null;
  return args.refreshFollowsIfEnabled(args.ownerPubky, args.followsImportEnabled);
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
