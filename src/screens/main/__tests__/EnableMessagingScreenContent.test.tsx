import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  EnableMessagingScreenContent,
  formatEnableRemaining,
} from '../EnableMessagingScreenContent';
import { INITIAL_ENABLE_MESSAGING_STATE } from '../enableMessagingController';
import { COPY } from '../../../copy/uxCopy';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
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

describe('EnableMessagingScreenContent wiring', () => {
  it('formats remaining time and pads countdown above the gesture inset', () => {
    expect(formatEnableRemaining(42)).toBe('Remaining: 00:42');
    expect(formatEnableRemaining(125)).toBe('Remaining: 02:05');

    const onPrimary = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <EnableMessagingScreenContent
          state={{
            ...INITIAL_ENABLE_MESSAGING_STATE,
            phase: 'authorizing',
            authorizationUrl: 'pubkyauth://vrt',
            authorizingStartedAt: Date.now(),
            message: COPY.waitingForRing,
          }}
          remainingLabel="Remaining: 00:42"
          onBack={noop}
          onPrimary={onPrimary}
          onSecondary={noop}
          onCopyAuth={noop}
        />,
      );
    });

    const countdown = tree.root.findByProps({ testID: 'enableMessagingCountdown' });
    expect(countdown.props.accessibilityLabel).toBe('Remaining: 00:42');
    expect(JSON.stringify(countdown.props.style)).toContain('34');
    act(() => {
      tree.root.findByProps({ testID: 'enableMessagingOpenRing' }).props.onPress();
    });
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('renders failure copy once through ErrorState', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <EnableMessagingScreenContent
          state={{
            ...INITIAL_ENABLE_MESSAGING_STATE,
            phase: 'denied',
            message: COPY.authorizationDeclinedBody,
          }}
          onBack={noop}
          onPrimary={noop}
          onSecondary={noop}
          onCopyAuth={noop}
        />,
      );
    });

    expect(tree.root.findByProps({ testID: 'enableMessagingError' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'enableMessagingStatus' })).toHaveLength(0);
    expect(
      JSON.stringify(tree.toJSON()).match(new RegExp(COPY.authorizationDeclined, 'g')),
    ).toHaveLength(1);
  });
});
