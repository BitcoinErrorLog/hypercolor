import type { ImportFollowsRefreshResult } from '../../../../services/ContactsService';
import { afterManualContactAdded, pullToRefreshFollows } from '../contactsActions';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';

describe('pullToRefreshFollows', () => {
  it('passes the consent flag through and does not invent an opt-in', async () => {
    const refreshFollowsIfEnabled = jest.fn(
      async (_owner: string, enabled: boolean): Promise<ImportFollowsRefreshResult> => {
        if (!enabled) {
          return { skipped: true, imported: 0, followees: [], usedNexusFallback: false };
        }
        return {
          skipped: false,
          ok: true,
          imported: 0,
          followees: [],
          usedNexusFallback: false,
        };
      },
    );

    const off = await pullToRefreshFollows({
      ownerPubky: OWNER,
      followsImportEnabled: false,
      refreshFollowsIfEnabled,
    });
    expect(refreshFollowsIfEnabled).toHaveBeenCalledWith(OWNER, false);
    expect(off).toEqual({
      skipped: true,
      imported: 0,
      followees: [],
      usedNexusFallback: false,
    });

    await pullToRefreshFollows({
      ownerPubky: OWNER,
      followsImportEnabled: true,
      refreshFollowsIfEnabled,
    });
    expect(refreshFollowsIfEnabled).toHaveBeenLastCalledWith(OWNER, true);
  });

  it('lands on Contacts with the added pubky focused', () => {
    expect(afterManualContactAdded(OWNER)).toEqual({
      detailPubky: OWNER,
      navigateArgs: ['Main', { screen: 'Contacts', params: { focusPubky: OWNER } }],
    });
  });
});
