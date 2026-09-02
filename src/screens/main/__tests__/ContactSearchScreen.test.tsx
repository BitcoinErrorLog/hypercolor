import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ContactSearchView } from '../contacts/ContactSearchView';
import { afterManualContactAdded, submitManualContact } from '../contacts/contactsActions';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

async function render(
  onAdd: (pubky: string) => void = () => undefined,
  error: string | null = null,
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
      />,
    );
  });
  return tree;
}

describe('ContactSearchView', () => {
  it('shows validation copy for a malformed pubky and has no Scan QR control', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'contactSearchInput' }).props.onChangeText('not-a-pubky');
    });
    expect(JSON.stringify(tree.toJSON())).toContain(
      'Must be a 52-character z-base-32 pubky (no 0, 2, l, or v).',
    );
    expect(JSON.stringify(tree.toJSON())).not.toContain('Scan QR');
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

  it('lands on contact detail after a successful add', async () => {
    const landing = afterManualContactAdded(ALICE);
    expect(landing.detailPubky).toBe(ALICE);
    expect(landing.navigateArgs).toEqual([
      'Main',
      { screen: 'Contacts', params: { focusPubky: ALICE } },
    ]);
  });
});
