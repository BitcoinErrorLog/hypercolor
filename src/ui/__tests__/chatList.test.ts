import { filterDmConversations } from '../chatList';
import { shortPubky } from '../shortPubky';
import { peerIdentity } from '../peerIdentity';

const PEER = 'a'.repeat(52);
const OTHER = 'b'.repeat(52);

describe('filterDmConversations', () => {
  it('keeps dm: rows and drops group and public conversation ids', () => {
    const rows = [
      { conversationId: `dm:${PEER}`, label: 'dm' },
      { conversationId: `group:${OTHER}`, label: 'group' },
      { conversationId: `public:${PEER}`, label: 'public' },
      { conversationId: 'not-a-dm', label: 'junk' },
    ];
    expect(filterDmConversations(rows).map(row => row.label)).toEqual(['dm']);
  });
});

describe('shortPubky', () => {
  it('truncates a z32 key and never returns the full 52 characters', () => {
    expect(shortPubky(PEER)).toBe(`${PEER.slice(0, 6)}…${PEER.slice(-4)}`);
    expect(shortPubky(PEER)).not.toBe(PEER);
    expect(shortPubky(PEER).includes(PEER)).toBe(false);
  });
});

describe('peerIdentity', () => {
  it('shows shortPubky with claimed name secondary until the contact is trusted', () => {
    const claimed = peerIdentity(PEER, { displayName: 'Ada', addedManually: false });
    expect(claimed.title).toBe(shortPubky(PEER));
    expect(claimed.subtitle).toBe('claims to be Ada');
    const trusted = peerIdentity(PEER, { displayName: 'Ada', addedManually: true });
    expect(trusted.title).toBe('Ada');
    expect(trusted.subtitle).toBeNull();
  });
});
