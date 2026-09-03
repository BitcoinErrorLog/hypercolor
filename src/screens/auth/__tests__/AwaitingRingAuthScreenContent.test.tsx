import React from 'react';
import { act, create } from 'react-test-renderer';
import { AwaitingRingAuthScreenContent } from '../AwaitingRingAuthScreenContent';

jest.mock('../../../components/AuthQr', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    AuthQr: ({ value }: { value: string }) =>
      React.createElement(Text, { testID: 'authQrStub' }, value),
  };
});

const noop = () => undefined;

describe('AwaitingRingAuthScreenContent wiring', () => {
  it('renders the QR for a waiting URL and forwards Open Ring', () => {
    const onOpenRing = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <AwaitingRingAuthScreenContent
          phase="waiting"
          ringAuthUrl="pubkyauth://vrt-fixture"
          copied={false}
          delegationBusy={false}
          onCancel={noop}
          onOpenRing={onOpenRing}
          onCopy={noop}
          onGenerateNew={noop}
          onTryAgain={noop}
        />,
      );
    });
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthScreen' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'authQrStub' }).props.children).toBe(
      'pubkyauth://vrt-fixture',
    );
    act(() => {
      tree.root.findByProps({ testID: 'awaitingRingAuthOpenRing' }).props.onPress();
    });
    expect(onOpenRing).toHaveBeenCalledTimes(1);
  });
});
