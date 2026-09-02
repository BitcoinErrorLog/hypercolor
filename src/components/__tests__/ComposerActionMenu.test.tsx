import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { COPY } from '../../copy/uxCopy';
import { composerActionItems } from '../../ui/composerActions';
import { ComposerActionMenu } from '../ComposerActionMenu';

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

describe('ComposerActionMenu', () => {
  it('shows disabled payment rows with the contract reason', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const actions = composerActionItems('private-group', {
      messagingEnabled: true,
      inboxClosed: false,
      hasTipEndpoints: false,
    });
    const tree = await render(
      <ComposerActionMenu visible actions={actions} onSelect={onSelect} onClose={onClose} />,
    );
    const pay = tree.root.findByProps({ testID: 'composerAction-request-payment' });
    expect(pay.props.accessibilityState.disabled).toBe(true);
    expect(pay.props.accessibilityLabel).toContain(COPY.paymentsDmOnly);
    await act(async () => {
      tree.root.findByProps({ testID: 'composerActionCancel' }).props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    await unmount(tree);
  });

  it('dismisses from the backdrop', async () => {
    const onClose = jest.fn();
    const tree = await render(
      <ComposerActionMenu
        visible
        actions={composerActionItems('dm', {
          messagingEnabled: true,
          inboxClosed: false,
          hasTipEndpoints: true,
        })}
        onSelect={jest.fn()}
        onClose={onClose}
      />,
    );
    await act(async () => {
      tree.root.findByProps({ testID: 'composerActionBackdrop' }).props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount(tree);
  });
});
