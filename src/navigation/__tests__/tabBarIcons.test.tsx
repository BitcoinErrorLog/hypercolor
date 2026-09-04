import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { color } from '../../theme';
import { MAIN_TAB_ICONS, MainTabBarIcon, type MainTabName } from '../tabBarIcons';

jest.mock('@expo/vector-icons/Ionicons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react');
  function MockIonicons({ name, color, size }: { name: string; color: string; size: number }) {
    return createElement('ionicon', { testID: `ionicon-${name}`, name, color, size });
  }
  MockIonicons.loadFont = jest.fn(async () => undefined);
  return MockIonicons;
});

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

const TABS: MainTabName[] = ['Chats', 'Channels', 'Contacts', 'Profile'];

describe('MainTabBarIcon', () => {
  it('maps every tab to a distinct focused and unfocused ionicon', () => {
    const focused = TABS.map(tab => MAIN_TAB_ICONS[tab].focused);
    const unfocused = TABS.map(tab => MAIN_TAB_ICONS[tab].unfocused);
    expect(new Set(focused).size).toBe(TABS.length);
    expect(new Set(unfocused).size).toBe(TABS.length);
    expect(MAIN_TAB_ICONS.Chats.unfocused).toBe('chatbubble-outline');
    expect(MAIN_TAB_ICONS.Channels.unfocused).toBe('radio-outline');
    expect(MAIN_TAB_ICONS.Contacts.unfocused).toBe('people-outline');
    expect(MAIN_TAB_ICONS.Profile.unfocused).toBe('person-circle-outline');
  });

  it('renders the focused glyph with the tab bar color and size', async () => {
    const tree = await render(
      <MainTabBarIcon routeName="Chats" focused color={color.brand} size={24} />,
    );
    const node = tree.root.findByProps({ testID: 'ionicon-chatbubble' });
    expect(node.props.name).toBe('chatbubble');
    expect(node.props.color).toBe(color.brand);
    expect(node.props.size).toBe(24);
    await act(async () => {
      tree.unmount();
    });
  });

  it('renders the outline glyph when inactive', async () => {
    const tree = await render(
      <MainTabBarIcon routeName="Contacts" focused={false} color={color.textSecondary} size={22} />,
    );
    const node = tree.root.findByProps({ testID: 'ionicon-people-outline' });
    expect(node.props.name).toBe('people-outline');
    expect(node.props.color).toBe(color.textSecondary);
    expect(node.props.size).toBe(22);
    await act(async () => {
      tree.unmount();
    });
  });
});
