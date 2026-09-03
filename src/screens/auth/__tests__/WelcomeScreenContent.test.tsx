import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { WelcomeScreenContent } from '../WelcomeScreenContent';
import { COPY } from '../../../copy/uxCopy';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

describe('WelcomeScreenContent wiring', () => {
  it('forwards connect / reset handlers and renders idle copy', () => {
    const onConnect = jest.fn();
    const onOpenReset = jest.fn();
    const onConfirmReset = jest.fn();
    const onDismissReset = jest.fn();

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <WelcomeScreenContent
          loading={false}
          connectPending={false}
          error={null}
          resetAvailable
          resetOpen={false}
          resetBusy={false}
          showDebugPanel
          debugPanel={<Text testID="welcomeDebugStub">debug</Text>}
          onConnect={onConnect}
          onOpenReset={onOpenReset}
          onConfirmReset={onConfirmReset}
          onDismissReset={onDismissReset}
        />,
      );
    });

    expect(tree.root.findByProps({ testID: 'welcomeScreen' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'welcomeDebugStub' })).toBeTruthy();
    expect(
      tree.root.findAllByProps({ children: COPY.connectWithPubkyRing }).length,
    ).toBeGreaterThan(0);

    act(() => {
      tree.root.findByProps({ testID: 'welcomeConnectRing' }).props.onPress();
      tree.root.findByProps({ testID: 'welcomeResetAppData' }).props.onPress();
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onOpenReset).toHaveBeenCalledTimes(1);
  });
});
