import { groupReadCursorId } from '../../types/group';
import {
  filterChannelsByMode,
  filterChannelsByPrefs,
  mayReadPublicGraph,
  mayWritePublicGraph,
  parseChannelMode,
  publicListVisible,
  withUnreadCounts,
  type ChannelListItem,
} from '../channelList';
import type { GroupChannel } from '../../types/group';

const OWNER = 'a'.repeat(52);

function channel(
  partial: Partial<GroupChannel> & Pick<GroupChannel, 'channelId' | 'isPublic'>,
): GroupChannel {
  return {
    ownerPubky: OWNER,
    name: partial.channelId,
    createdAt: 1,
    updatedAt: 1,
    createdBy: OWNER,
    lastMessageAt: null,
    membershipEpoch: 0,
    ...partial,
  };
}

describe('filterChannelsByPrefs', () => {
  it('hides archived channels from inbox using thread_local_prefs keys', () => {
    const rows: ChannelListItem[] = [
      { ...channel({ channelId: 'priv-1', isPublic: false, name: 'Open' }), unreadCount: 0 },
      { ...channel({ channelId: 'priv-2', isPublic: false, name: 'Quiet' }), unreadCount: 0 },
    ];
    const prefs = {
      'priv-1': { muted: true, archived: false },
      'priv-2': { muted: false, archived: true },
    };
    expect(filterChannelsByPrefs(rows, prefs, 'inbox').map(r => r.channelId)).toEqual(['priv-1']);
    expect(filterChannelsByPrefs(rows, prefs, 'archived').map(r => r.channelId)).toEqual([
      'priv-2',
    ]);
    expect(filterChannelsByPrefs(rows, prefs, 'muted').map(r => r.channelId)).toEqual(['priv-1']);
  });
});

describe('filterChannelsByMode', () => {
  const rows: ChannelListItem[] = [
    { ...channel({ channelId: 'priv-1', isPublic: false, name: 'Private one' }), unreadCount: 2 },
    { ...channel({ channelId: 'pub-1', isPublic: true, name: 'Public one' }), unreadCount: 0 },
    { ...channel({ channelId: 'priv-2', isPublic: false, name: 'Private two' }), unreadCount: 0 },
  ];

  it('lists only private groups in Private mode', () => {
    expect(filterChannelsByMode(rows, 'private').map(row => row.channelId)).toEqual([
      'priv-1',
      'priv-2',
    ]);
  });

  it('lists only public topics in Public mode', () => {
    expect(filterChannelsByMode(rows, 'public').map(row => row.channelId)).toEqual(['pub-1']);
  });
});

describe('public graph opt-in', () => {
  it('forbids public reads before consent', () => {
    expect(mayReadPublicGraph(false)).toBe(false);
    expect(publicListVisible(false)).toBe(false);
    expect(mayWritePublicGraph(false)).toBe(false);
  });

  it('allows public reads after Load public topics', () => {
    expect(mayReadPublicGraph(true)).toBe(true);
    expect(publicListVisible(true)).toBe(true);
    expect(mayWritePublicGraph(true)).toBe(true);
  });
});

describe('withUnreadCounts', () => {
  it('attaches unread counts keyed by channel id', () => {
    const rows = withUnreadCounts([channel({ channelId: 'priv-1', isPublic: false })], {
      'priv-1': 4,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unreadCount).toBe(4);
  });
});

describe('parseChannelMode', () => {
  it('defaults unknown values to private', () => {
    expect(parseChannelMode('public')).toBe('public');
    expect(parseChannelMode('private')).toBe('private');
    expect(parseChannelMode(undefined)).toBe('private');
  });
});

describe('groupReadCursorId', () => {
  it('namespaces the cursor away from dm conversation ids', () => {
    expect(groupReadCursorId('abc')).toBe('group:abc');
  });
});
