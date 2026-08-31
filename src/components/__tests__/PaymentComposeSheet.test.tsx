import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PaymentComposeSheet, paymentComposeError } from '../PaymentComposeSheet';
import { PAYMENT_REFERENCE_MAX_LEN } from '../../types/payment';

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

describe('paymentComposeError', () => {
  it('rejects an empty or whitespace-only payment reference', () => {
    expect(paymentComposeError('0.001', '')).toBe('Enter a payment reference');
    expect(paymentComposeError('0.001', '   ')).toBe('Enter a payment reference');
  });

  it('rejects control characters and over-long references', () => {
    expect(paymentComposeError('0.001', 'invoice\n2026')).toBe('Payment reference is invalid');
    expect(paymentComposeError('0.001', 'r'.repeat(PAYMENT_REFERENCE_MAX_LEN + 1))).toBe(
      'Payment reference is invalid',
    );
  });

  it('rejects an invalid amount before checking the reference', () => {
    expect(paymentComposeError('', 'invoice-2026-0001')).toBe('Enter a valid BTC amount');
    expect(paymentComposeError('0', 'invoice-2026-0001')).toBe('Enter a valid BTC amount');
  });

  it('accepts a canonical amount and a non-empty reference', () => {
    expect(paymentComposeError('0.001', 'invoice-2026-0001')).toBeNull();
    expect(paymentComposeError(' 0.001 ', ' invoice-2026-0001 ')).toBeNull();
  });
});

describe('PaymentComposeSheet', () => {
  it('does not submit an empty payment reference and shows an error', async () => {
    const onSubmit = jest.fn();
    const tree = await render(
      <PaymentComposeSheet visible busy={false} onClose={jest.fn()} onSubmit={onSubmit} />,
    );
    const submit = tree.root.findByProps({ testID: 'paymentComposeSubmit' });
    await act(async () => {
      submit.props.onPress();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'paymentComposeError' }).props.children).toBe(
      'Enter a payment reference',
    );
    await unmount(tree);
  });

  it('submits a trimmed amount and reference when both are valid', async () => {
    const onSubmit = jest.fn();
    const tree = await render(
      <PaymentComposeSheet visible busy={false} onClose={jest.fn()} onSubmit={onSubmit} />,
    );
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentComposeReference' }).props.onChangeText('  p7-ref  ');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'paymentComposeSubmit' }).props.onPress();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('0.001', 'p7-ref');
    expect(tree.root.findAllByProps({ testID: 'paymentComposeError' })).toHaveLength(0);
    await unmount(tree);
  });
});
