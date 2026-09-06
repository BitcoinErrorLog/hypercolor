import { filterDmConversations, filterConversationsByPrefs } from '../chatList';
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
    const nicknamed = peerIdentity(PEER, {
      displayName: 'Ada',
      nickname: 'Ada-alias',
      addedManually: false,
    });
    expect(nicknamed.title).toBe('Ada-alias');
    expect(nicknamed.subtitle).toBe(shortPubky(PEER));
  });
});

describe('filterConversationsByPrefs', () => {
  it('hides archived from inbox and keeps muted visible until archived', () => {
    const rows = [{ conversationId: `dm:${PEER}` }, { conversationId: `dm:${OTHER}` }];
    const prefs = {
      [`dm:${PEER}`]: { muted: true, archived: false },
      [`dm:${OTHER}`]: { muted: false, archived: true },
    };
    expect(filterConversationsByPrefs(rows, prefs, 'inbox').map(r => r.conversationId)).toEqual([
      `dm:${PEER}`,
    ]);
    expect(filterConversationsByPrefs(rows, prefs, 'archived').map(r => r.conversationId)).toEqual([
      `dm:${OTHER}`,
    ]);
    expect(filterConversationsByPrefs(rows, prefs, 'muted').map(r => r.conversationId)).toEqual([
      `dm:${PEER}`,
    ]);
  });
});
