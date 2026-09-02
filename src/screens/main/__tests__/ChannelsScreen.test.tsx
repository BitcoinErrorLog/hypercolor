import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { COPY } from '../../../copy/uxCopy';
import type { ChannelListItem } from '../../../ui/channelList';
import { ChannelsScreenContent } from '../ChannelsScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: () => undefined,
  useRoute: () => ({ params: {} }),
}));

jest.mock('../../../stores/authStore', () => ({
  useAuthStore: (sel: (s: { pubky: string }) => unknown) => sel({ pubky: 'a'.repeat(52) }),
}));

jest.mock('../../../services/StorageService', () => ({
  StorageService: {
    unreadCountsForGroupChannels: jest.fn().mockResolvedValue({}),
    getAllContacts: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../../services/group/GroupService', () => ({
  GroupService: { listChannels: jest.fn().mockResolvedValue([]) },
  takePendingPublicJoin: jest.fn(() => null),
  subscribeGroupEvents: jest.fn(() => () => undefined),
}));

const OWNER = 'a'.repeat(52);

function item(
  partial: Pick<ChannelListItem, 'channelId' | 'name' | 'isPublic' | 'unreadCount'>,
): ChannelListItem {
  return {
    ownerPubky: OWNER,
    createdAt: 1,
    updatedAt: 1,
    createdBy: OWNER,
    lastMessageAt: Date.now(),
    membershipEpoch: 0,
    ...partial,
  };
}

const CHANNELS: ChannelListItem[] = [
  item({ channelId: 'priv-1', name: 'Crew', isPublic: false, unreadCount: 3 }),
  item({ channelId: 'pub-1', name: 'Town square', isPublic: true, unreadCount: 0 }),
];

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

async function unmount(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    tree.unmount();
  });
}

function byTestId(tree: ReactTestRenderer, testID: string) {
  return tree.root
    .findAllByProps({ testID })
    .filter(node => typeof node.props.onPress === 'function');
}

const noop = () => undefined;

function props(
  overrides: Partial<React.ComponentProps<typeof ChannelsScreenContent>> = {},
): React.ComponentProps<typeof ChannelsScreenContent> {
  return {
    channels: CHANNELS,
    contacts: [],
    mode: 'private',
    publicOptIn: false,
    publicReads: 0,
    createOpen: false,
    joinOpen: false,
    createPublicDefault: false,
    busy: false,
    memberCap: 50,
    onModeChange: noop,
    onLoadPublic: noop,
    onOpenCreate: noop,
    onCloseCreate: noop,
    onOpenJoin: noop,
    onCloseJoin: noop,
    onCreatePrivate: noop,
    onCreatePublic: noop,
    onJoinPublic: noop,
    onOpenChannel: noop,
    ...overrides,
  };
}

describe('ChannelsScreenContent', () => {
  it('lists private groups with unread badges and hides public rows', async () => {
    const tree = await render(<ChannelsScreenContent {...props()} />);
    expect(byTestId(tree, 'channelRowPrivate').length).toBeGreaterThan(0);
    expect(byTestId(tree, 'channelRowPublic')).toHaveLength(0);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Crew');
    expect(json).not.toContain('Town square');
    expect(json).toContain('3');
    await unmount(tree);
  });

  it('does not list public topics until Load public topics is pressed', async () => {
    const tree = await render(
      <ChannelsScreenContent {...props({ mode: 'public', publicOptIn: false, publicReads: 0 })} />,
    );
    expect(byTestId(tree, 'channelRowPublic')).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'channelsLoadPublic' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'channelsPublicReadCount' }).props.children).toBe('0');
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.publicSubstrateMobile);
    await unmount(tree);
  });

  it('lists public topics after opt-in', async () => {
    const tree = await render(
      <ChannelsScreenContent {...props({ mode: 'public', publicOptIn: true })} />,
    );
    expect(byTestId(tree, 'channelRowPublic').length).toBeGreaterThan(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Town square');
    await unmount(tree);
  });
});
