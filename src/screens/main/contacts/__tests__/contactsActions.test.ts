import type { ImportFollowsRefreshResult } from '../../../../services/ContactsService';
import { afterManualContactAdded, pullToRefreshFollows } from '../contactsActions';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';

describe('pullToRefreshFollows', () => {
  it('asks the service for this owner and does not invent an opt-in boolean', async () => {
    const refreshFollowsIfEnabled = jest.fn(
      async (_owner: string): Promise<ImportFollowsRefreshResult> => ({
        skipped: true,
        imported: 0,
        followees: [],
        usedNexusFallback: false,
      }),
    );

    const off = await pullToRefreshFollows({
      ownerPubky: OWNER,
      refreshFollowsIfEnabled,
    });
    expect(refreshFollowsIfEnabled).toHaveBeenCalledWith(OWNER);
    expect(refreshFollowsIfEnabled.mock.calls[0]).toHaveLength(1);
    expect(off).toEqual({
      skipped: true,
      imported: 0,
      followees: [],
      usedNexusFallback: false,
    });
  });

  it('lands on Contacts with the added pubky focused', () => {
    expect(afterManualContactAdded(OWNER)).toEqual({
      detailPubky: OWNER,
      navigateArgs: ['Main', { screen: 'Contacts', params: { focusPubky: OWNER } }],
    });
  });
});
