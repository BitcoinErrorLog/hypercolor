import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Contact } from '../../../types';
import {
  CONTACTS_EMPTY_BODY,
  CONTACTS_EMPTY_PRIMARY,
  CONTACTS_EMPTY_SECONDARY,
  CONTACTS_EMPTY_TITLE,
  ContactsScreenContent,
} from '../contacts/ContactsScreenContent';
import { CONSENT_TITLE } from '../../../ui/contacts/FollowsConsentSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const BOB = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';

function contact(patch: Partial<Contact> & { pubky: string }): Contact {
  return {
    ownerPubky: OWNER,
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: 1,
    ...patch,
  };
}

const noop = () => undefined;

function contentProps(
  overrides: Partial<React.ComponentProps<typeof ContactsScreenContent>> = {},
): React.ComponentProps<typeof ContactsScreenContent> {
  return {
    contacts: [],
    suggestions: [],
    followsImportEnabled: false,
    refreshing: false,
    importing: false,
    consentOpen: false,
    importStatus: null,
    importError: null,
    importErrorDetails: null,
    usedNexusFallback: false,
    loadError: null,
    loadErrorDetails: null,
    offline: false,
    onRefresh: noop,
    onAdd: noop,
    onOpenContact: noop,
    onUseFollows: noop,
    onConsentConfirm: noop,
    onConsentDismiss: noop,
    onRefreshFollows: noop,
    onStopFollows: noop,
    onAddSuggestion: noop,
    onRetryLoad: noop,
    onRetryImport: noop,
    onScanQr: noop,
    ...overrides,
  };
}

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

function treeHasText(tree: ReactTestRenderer, needle: string): boolean {
  return tree.root.findAllByType(Text).some(node => {
    const children: unknown = node.props.children;
    if (typeof children === 'string') return children.includes(needle);
    if (Array.isArray(children)) {
      return children.some(child => typeof child === 'string' && child.includes(needle));
    }
    return false;
  });
}

describe('ContactsScreenContent', () => {
  it('renders the empty state with add and use-follows actions, not pull-to-import', async () => {
    const onAdd = jest.fn();
    const onUseFollows = jest.fn();
    const tree = await render(<ContactsScreenContent {...contentProps({ onAdd, onUseFollows })} />);
    expect(treeHasText(tree, CONTACTS_EMPTY_TITLE)).toBe(true);
    expect(treeHasText(tree, CONTACTS_EMPTY_BODY)).toBe(true);
    expect(treeHasText(tree, CONTACTS_EMPTY_PRIMARY)).toBe(true);
    expect(treeHasText(tree, CONTACTS_EMPTY_SECONDARY)).toBe(true);
    expect(treeHasText(tree, 'Pull to import')).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'contactsRequests' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'contactsEmptyAdd' })).toBeTruthy();
    await act(async () => {
      tree.root.findByProps({ testID: 'contactsEmptyUseFollows' }).props.onPress();
    });
    expect(onUseFollows).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps the consent confirm disabled until the checkbox is checked', async () => {
    const onConfirm = jest.fn();
    const tree = await render(
      <ContactsScreenContent
        {...contentProps({ consentOpen: true, onConsentConfirm: onConfirm })}
      />,
    );
    expect(treeHasText(tree, CONSENT_TITLE)).toBe(true);
    expect(treeHasText(tree, 'never asks Nexus who follows you')).toBe(true);
    expect(treeHasText(tree, 'they never auto-accept a message')).toBe(true);
    expect(treeHasText(tree, 'accepted automatically')).toBe(false);
    expect(treeHasText(tree, 'keep auto-accepting')).toBe(false);
    const confirm = tree.root.findByProps({ testID: 'followsConsentConfirm' });
    expect(confirm.props.disabled).toBe(true);
    await act(async () => {
      tree.root.findByProps({ testID: 'followsConsentCheckbox' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'followsConsentConfirm' }).props.disabled).toBe(false);
    await act(async () => {
      tree.root.findByProps({ testID: 'followsConsentConfirm' }).props.onPress();
    });
    expect(onConfirm).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows relationship chips only after import and keeps suggestions out of the contact list', async () => {
    const added = contact({
      pubky: ALICE,
      displayName: 'Alice',
      addedManually: true,
      isFollowing: true,
    });
    const suggestion = contact({
      pubky: BOB,
      displayName: 'Bob',
      addedManually: false,
      isFollowing: true,
    });
    const onOpen = jest.fn();
    const tree = await render(
      <ContactsScreenContent
        {...contentProps({
          contacts: [added],
          suggestions: [suggestion],
          followsImportEnabled: true,
          onOpenContact: onOpen,
        })}
      />,
    );
    expect(treeHasText(tree, 'Following')).toBe(true);
    expect(treeHasText(tree, 'claims to be Bob')).toBe(true);
    expect(treeHasText(tree, 'Add as contact')).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'contactRow' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'suggestionRow' }).length).toBeGreaterThan(0);
    await act(async () => {
      tree.root.findAllByProps({ testID: 'contactRow' })[0]!.props.onPress();
    });
    expect(onOpen).toHaveBeenCalledWith(ALICE);
    await act(async () => {
      tree.unmount();
    });
  });

  it('does not show Following chips when import is off and still offers Use my follows', async () => {
    const added = contact({
      pubky: ALICE,
      displayName: 'Alice',
      isFollowing: true,
      isMutual: true,
    });
    const onUseFollows = jest.fn();
    const tree = await render(
      <ContactsScreenContent
        {...contentProps({ contacts: [added], followsImportEnabled: false, onUseFollows })}
      />,
    );
    expect(treeHasText(tree, 'Mutual')).toBe(false);
    expect(treeHasText(tree, 'Following')).toBe(false);
    await act(async () => {
      tree.root.findByProps({ testID: 'contactsUseFollows' }).props.onPress();
    });
    expect(onUseFollows).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('announces a suggestion with shortPubky and claims-to-be, not the claimed name as primary', async () => {
    const suggestion = contact({
      pubky: BOB,
      displayName: 'Bob',
      addedManually: false,
      isFollowing: true,
    });
    const tree = await render(
      <ContactsScreenContent
        {...contentProps({
          suggestions: [suggestion],
          followsImportEnabled: true,
        })}
      />,
    );
    const row = tree.root.findByProps({ testID: 'suggestionContactRow' });
    expect(row.props.accessibilityLabel).toContain('Open suggestion');
    expect(row.props.accessibilityLabel).toContain('claims to be Bob');
    expect(row.props.accessibilityLabel.startsWith('Open contact Bob')).toBe(false);
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows a leftover blocked contact as Blocked · cleanup pending', async () => {
    const leftover = contact({ pubky: ALICE, displayName: 'Alice' });
    const tree = await render(
      <ContactsScreenContent
        {...contentProps({
          contacts: [leftover],
          blockState: { [ALICE]: 'cleanup-pending' },
        })}
      />,
    );
    expect(treeHasText(tree, 'Blocked · cleanup pending')).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'contactRowBlockedState' }).length).toBeGreaterThan(
      0,
    );
    await act(async () => {
      tree.unmount();
    });
  });
});
