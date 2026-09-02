import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CONTACTS_COPY } from '../../../../ui/contacts/contactsCopy';
import type { Contact } from '../../../../types';
import { ContactDetailView } from '../ContactDetailView';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

const added: Contact = {
  pubky: ALICE,
  ownerPubky: OWNER,
  displayName: 'Alice',
  trustScore: 0.4,
  isFollowing: true,
  isFollower: false,
  isMutual: false,
  addedManually: true,
  firstSeenAt: 1,
};

const noop = () => undefined;

function viewProps(
  overrides: Partial<React.ComponentProps<typeof ContactDetailView>> = {},
): React.ComponentProps<typeof ContactDetailView> {
  return {
    pubky: ALICE,
    contact: added,
    loading: false,
    loadError: null,
    loadErrorDetails: null,
    trust: null,
    linkLabel: 'Encrypted link ready',
    paymentIdentifiers: [],
    paymentsUnavailableOffline: false,
    followsImportEnabled: true,
    blocked: false,
    cleanupPending: false,
    onBack: noop,
    onMessage: noop,
    onCopy: noop,
    onShare: noop,
    onRetry: noop,
    onBlock: noop,
    onUnblock: noop,
    onRemove: noop,
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

describe('ContactDetailView', () => {
  it('shows identity, relationship, link, trust, and Message — not Requests', async () => {
    const onMessage = jest.fn();
    const tree = await render(
      <ContactDetailView
        {...viewProps({
          trust: {
            score: 0.15,
            reasons: [{ code: 'following', contribution: 0.15, label: 'You follow them' }],
          },
          onMessage,
        })}
      />,
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(ALICE);
    expect(json).toContain('Alice');
    expect(json).toContain('Following');
    expect(json).toContain('Encrypted link ready');
    expect(json).toContain('You follow them');
    expect(json).toContain('Message');
    expect(json).not.toContain('Requests');
    expect(tree.root.findAllByProps({ testID: 'contactsRequests' })).toHaveLength(0);
    await act(async () => {
      tree.root.findByProps({ testID: 'contactDetailMessage' }).props.onPress();
    });
    expect(onMessage).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('tells the user Block closes the Encrypted Link and deletes one-to-one messages', async () => {
    const tree = await render(<ContactDetailView {...viewProps()} />);
    await act(async () => {
      tree.root.findByProps({ testID: 'contactDetailBlock' }).props.onPress();
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('The Encrypted Link is closed');
    expect(json).toContain('cannot deliver messages');
    expect(json).toContain('One-to-one messages');
    expect(json).toContain('Unblocking is a separate action');
    expect(json).toContain('adding their pubky again does not lift the block');
    expect(json).not.toContain('Existing chats stay');
    await act(async () => {
      tree.unmount();
    });
  });

  it('shows Blocked with Unblock and confirms what unblocking does', async () => {
    const onUnblock = jest.fn();
    const tree = await render(<ContactDetailView {...viewProps({ blocked: true, onUnblock })} />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(CONTACTS_COPY.blockedState);
    expect(tree.root.findAllByProps({ testID: 'contactDetailMessage' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'contactDetailBlock' })).toHaveLength(0);
    await act(async () => {
      tree.root.findByProps({ testID: 'contactDetailUnblock' }).props.onPress();
    });
    const open = JSON.stringify(tree.toJSON());
    expect(open).toContain(CONTACTS_COPY.unblockTitle);
    expect(open).toContain('They can send you a message request again');
    expect(open).toContain('No chats, encrypted link, or contact data is restored');
    await act(async () => {
      tree.root.findByProps({ testID: 'confirmSheetConfirm' }).props.onPress();
    });
    expect(onUnblock).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps Retry on a cleanup-pending blocked contact', async () => {
    const onRetry = jest.fn();
    const tree = await render(
      <ContactDetailView {...viewProps({ blocked: true, cleanupPending: true, onRetry })} />,
    );
    expect(JSON.stringify(tree.toJSON())).toContain(CONTACTS_COPY.blockedCleanupPending);
    await act(async () => {
      tree.root.findByProps({ testID: 'contactErrorRetry' }).props.onPress();
    });
    expect(onRetry).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });
});
