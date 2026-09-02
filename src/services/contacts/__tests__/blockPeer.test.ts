import { BLOCK_CLEANUP_PENDING_MESSAGE, blockPeer, unblockPeer } from '../blockPeer';
import type { PubkyKey } from '../../../types';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

describe('blockPeer', () => {
  it('persists deny first, then declines and deletes on the happy path', async () => {
    const order: string[] = [];
    const blocked = new Set<string>();
    const contacts = new Map<PubkyKey, { pubky: PubkyKey }>([[PEER, { pubky: PEER }]]);
    const requests = new Map<PubkyKey, 'pending' | 'declined'>([[PEER, 'pending']]);

    const result = await blockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistBlock: (_owner, peer) => {
        order.push('deny');
        blocked.add(peer);
      },
      declineMessageRequest: async peer => {
        order.push('decline');
        requests.set(peer, 'declined');
      },
      deleteContact: async (_owner, peer) => {
        order.push('delete');
        contacts.delete(peer);
      },
    });

    expect(result).toEqual({ blocked: true, cleanup: 'complete' });
    expect(order).toEqual(['deny', 'decline', 'delete']);
    expect(blocked.has(PEER)).toBe(true);
    expect(requests.get(PEER)).toBe('declined');
    expect(contacts.has(PEER)).toBe(false);
  });

  it('keeps the deny and reports cleanup pending when decline throws', async () => {
    const blocked = new Set<string>();
    const contacts = new Map([[PEER, { pubky: PEER }]]);
    const deleteContact = jest.fn(async (_owner: PubkyKey, peer: PubkyKey) => {
      contacts.delete(peer);
    });
    const result = await blockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistBlock: (_owner, peer) => {
        blocked.add(peer);
      },
      declineMessageRequest: async () => {
        throw new Error('native close failed');
      },
      deleteContact,
    });
    expect(result).toEqual({
      blocked: true,
      cleanup: 'pending',
      message: BLOCK_CLEANUP_PENDING_MESSAGE,
      details: 'native close failed',
    });
    expect(blocked.has(PEER)).toBe(true);
    expect(contacts.has(PEER)).toBe(true);
    expect(deleteContact).not.toHaveBeenCalled();
  });

  it('keeps the deny and reports cleanup pending when contact deletion throws', async () => {
    const blocked = new Set<string>();
    const result = await blockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistBlock: (_owner, peer) => {
        blocked.add(peer);
      },
      declineMessageRequest: async () => undefined,
      deleteContact: async () => {
        throw new Error('sqlite locked');
      },
    });
    expect(result).toEqual({
      blocked: true,
      cleanup: 'pending',
      message: BLOCK_CLEANUP_PENDING_MESSAGE,
      details: 'sqlite locked',
    });
    expect(blocked.has(PEER)).toBe(true);
  });
});

describe('unblockPeer', () => {
  it('removes the deny then releases the declined request', async () => {
    const order: string[] = [];
    const blocked = new Set<string>([PEER]);
    await unblockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistUnblock: (_owner, peer) => {
        order.push('unblock');
        blocked.delete(peer);
      },
      releaseDeclinedRequest: async () => {
        order.push('release');
      },
    });
    expect(order).toEqual(['unblock', 'release']);
    expect(blocked.has(PEER)).toBe(false);
  });
});
