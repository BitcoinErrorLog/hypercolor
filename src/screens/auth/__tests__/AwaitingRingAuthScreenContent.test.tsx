import React from 'react';
import { act, create } from 'react-test-renderer';
import { AwaitingRingAuthScreenContent } from '../AwaitingRingAuthScreenContent';
import { COPY } from '../../../copy/uxCopy';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

jest.mock('../../../components/AuthQr', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest mock factory */
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
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
          delegationBusy={false}
          onCancel={noop}
          onOpenRing={onOpenRing}
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
    expect(tree.root.findAllByProps({ testID: 'awaitingRingAuthCopy' })).toHaveLength(0);
  });

  it('renders expired copy once and uses shared action buttons', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <AwaitingRingAuthScreenContent
          phase="expired"
          ringAuthUrl="pubkyauth://expired"
          delegationBusy={false}
          onCancel={noop}
          onOpenRing={noop}
          onGenerateNew={noop}
          onTryAgain={noop}
        />,
      );
    });
    expect(
      JSON.stringify(tree.toJSON()).match(new RegExp(COPY.authorizationExpired, 'g')),
    ).toHaveLength(1);
    expect(
      tree.root
        .findAllByProps({ testID: 'awaitingRingAuthGenerateNew' })
        .some(node => node.props.accessibilityRole === 'button'),
    ).toBe(true);
  });
});
