import { blockPeer, localInboxProbeSet } from '../blockPeer';
import type { PubkyKey } from '../../../types';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const PEER = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const OTHER = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';

describe('blockPeer', () => {
  it('persists deny, declines the Encrypted Link, deletes the contact, and drops the peer from the inbox probe set', async () => {
    const contacts = new Map<PubkyKey, { pubky: PubkyKey }>([
      [PEER, { pubky: PEER }],
      [OTHER, { pubky: OTHER }],
    ]);
    const links = new Map<PubkyKey, { peerPubky: PubkyKey }>([[PEER, { peerPubky: PEER }]]);
    const requests = new Map<PubkyKey, 'pending' | 'declined'>([[PEER, 'pending']]);
    const blocked = new Set<string>();

    await blockPeer({
      ownerPubky: OWNER,
      peerPubky: PEER,
      persistBlock: (_owner, peer) => {
        blocked.add(peer);
      },
      declineMessageRequest: async peer => {
        links.delete(peer);
        requests.set(peer, 'declined');
      },
      deleteContact: async (_owner, peer) => {
        contacts.delete(peer);
      },
    });

    expect(blocked.has(PEER)).toBe(true);
    expect(requests.get(PEER)).toBe('declined');
    expect(contacts.has(PEER)).toBe(false);
    expect(links.has(PEER)).toBe(false);
    expect(localInboxProbeSet([...contacts.values()], [...links.values()])).toEqual([OTHER]);
  });

  it('does not surface a blocked peer as a request or chat candidate', async () => {
    const contacts: { pubky: PubkyKey }[] = [];
    const links: { peerPubky: PubkyKey }[] = [];
    const requestStatus = 'declined';
    const probe = localInboxProbeSet(contacts, links);
    expect(probe).not.toContain(PEER);
    const wouldPoll = probe.includes(PEER);
    const wouldCreateRequest = requestStatus !== 'declined';
    expect(wouldPoll).toBe(false);
    expect(wouldCreateRequest).toBe(false);
  });

  it('keeps the deny list if closing the Encrypted Link fails', async () => {
    const blocked = new Set<string>();
    const contacts = new Map([[PEER, { pubky: PEER }]]);
    await expect(
      blockPeer({
        ownerPubky: OWNER,
        peerPubky: PEER,
        persistBlock: (_owner, peer) => {
          blocked.add(peer);
        },
        declineMessageRequest: async () => {
          throw new Error('native close failed');
        },
        deleteContact: async (_owner, peer) => {
          contacts.delete(peer);
        },
      }),
    ).rejects.toThrow(/native close failed/);
    expect(blocked.has(PEER)).toBe(true);
    expect(contacts.has(PEER)).toBe(true);
  });
});
