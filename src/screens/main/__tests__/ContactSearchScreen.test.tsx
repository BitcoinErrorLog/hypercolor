import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ContactSearchView } from '../contacts/ContactSearchView';
import {
  afterManualContactAdded,
  decideScannedContact,
  submitManualContact,
} from '../contacts/contactsActions';
import { COPY } from '../../../copy/uxCopy';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

async function render(
  onAdd: (pubky: string) => void = () => undefined,
  error: string | null = null,
  onScanQr: () => void = () => undefined,
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ContactSearchView
        loading={false}
        error={error}
        errorDetails={null}
        onCancel={() => undefined}
        onAdd={onAdd}
        onScanQr={onScanQr}
      />,
    );
  });
  return tree;
}

describe('ContactSearchView', () => {
  it('shows validation copy for a malformed pubky and a Scan QR control', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'contactSearchInput' }).props.onChangeText('not-a-pubky');
    });
    expect(JSON.stringify(tree.toJSON())).toContain(
      'Must be a 52-character z-base-32 pubky (no 0, 2, l, or v).',
    );
    expect(tree.root.findByProps({ testID: 'contactsScanQr' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'contactSearchAdd' }).props.disabled).toBe(true);
    await act(async () => {
      tree.unmount();
    });
  });

  it('enables Add contact for a valid z32 pubky', async () => {
    const onAdd = jest.fn();
    const tree = await render(onAdd);
    await act(async () => {
      tree.root.findByProps({ testID: 'contactSearchInput' }).props.onChangeText(ALICE);
    });
    expect(tree.root.findByProps({ testID: 'contactSearchAdd' }).props.disabled).toBe(false);
    await act(async () => {
      tree.root.findByProps({ testID: 'contactSearchAdd' }).props.onPress();
    });
    expect(onAdd).toHaveBeenCalledWith(ALICE);
    await act(async () => {
      tree.unmount();
    });
  });

  it('renders duplicate copy with an error role, not a color-only change', async () => {
    const tree = await render(() => undefined, 'This pubky is already in your contacts.');
    expect(JSON.stringify(tree.toJSON())).toContain('This pubky is already in your contacts.');
    expect(tree.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('submitManualContact / afterManualContactAdded', () => {
  it('does not navigate when add reports a duplicate', async () => {
    const addManualContact = jest.fn(async () => ({
      ok: false as const,
      reason: 'duplicate' as const,
      message: 'This pubky is already in your contacts.',
    }));
    const result = await submitManualContact({
      ownerPubky: OWNER,
      pubky: ALICE,
      addManualContact,
    });
    expect(result.ok).toBe(false);
    expect(addManualContact).toHaveBeenCalledWith(OWNER, ALICE);
  });

  it('forwards confirmUnblock when the user confirmed Unblock and add', async () => {
    const addManualContact = jest.fn(async () => ({
      ok: true as const,
      contact: {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: 1,
      },
    }));
    const result = await submitManualContact({
      ownerPubky: OWNER,
      pubky: ALICE,
      confirmUnblock: true,
      addManualContact,
    });
    expect(result.ok).toBe(true);
    expect(addManualContact).toHaveBeenCalledWith(OWNER, ALICE, { confirmUnblock: true });
  });

  it('lands on contact detail after a successful add', async () => {
    const landing = afterManualContactAdded(ALICE);
    expect(landing.detailPubky).toBe(ALICE);
    expect(landing.navigateArgs).toEqual([
      'Main',
      { screen: 'Contacts', params: { focusPubky: ALICE } },
    ]);
  });
});

describe('contact QR scan', () => {
  it('rejects self and accepts a scanned canonical URI into addManualContact', async () => {
    expect(decideScannedContact(`pubky://${OWNER}`, OWNER)).toEqual({
      kind: 'error',
      message: COPY.thatsYourOwnPubky,
    });
    expect(decideScannedContact(`pubky://${ALICE}`, OWNER)).toEqual({
      kind: 'add',
      pubky: ALICE,
    });
    const addManualContact = jest.fn(async () => ({
      ok: true as const,
      contact: {
        pubky: ALICE,
        ownerPubky: OWNER,
        trustScore: 0,
        isFollowing: false,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: 1,
      },
    }));
    const decision = decideScannedContact(`https://pubky.app/profile/${ALICE}`, OWNER);
    if (decision.kind !== 'add') throw new Error('expected add');
    const result = await submitManualContact({
      ownerPubky: OWNER,
      pubky: decision.pubky,
      addManualContact,
    });
    expect(result.ok).toBe(true);
    expect(addManualContact).toHaveBeenCalledWith(OWNER, ALICE);
  });
});
