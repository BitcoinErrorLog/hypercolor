import React from 'react';
import { PixelRatio, StyleSheet, Text } from 'react-native';
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

  it('keeps the primary CTA reachable at large text', () => {
    const fontScaleSpy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <WelcomeScreenContent
          loading={false}
          connectPending={false}
          error={null}
          resetAvailable={false}
          resetOpen={false}
          resetBusy={false}
          onConnect={jest.fn()}
          onOpenReset={jest.fn()}
          onConfirmReset={jest.fn()}
          onDismissReset={jest.fn()}
        />,
      );
    });

    expect(PixelRatio.getFontScale()).toBe(2);
    const cta = tree.root.findByProps({ testID: 'welcomeConnectRing' });
    const label = tree.root
      .findAllByType(Text)
      .find(node => node.props.children === COPY.connectWithPubkyRing);
    expect(StyleSheet.flatten(cta.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(label?.props.numberOfLines).toBeUndefined();
    expect(label?.props.adjustsFontSizeToFit).toBeUndefined();
    fontScaleSpy.mockRestore();
  });

  it('keeps the pending primary CTA reachable at large text', () => {
    const fontScaleSpy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <WelcomeScreenContent
          loading={false}
          connectPending
          error={null}
          resetAvailable={false}
          resetOpen={false}
          resetBusy={false}
          onConnect={jest.fn()}
          onOpenReset={jest.fn()}
          onConfirmReset={jest.fn()}
          onDismissReset={jest.fn()}
        />,
      );
    });

    expect(PixelRatio.getFontScale()).toBe(2);
    const cta = tree.root.findByProps({ testID: 'welcomeConnectRing' });
    const label = tree.root
      .findAllByType(Text)
      .find(node => node.props.children === COPY.connectWithPubkyRing);
    expect(StyleSheet.flatten(cta.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(label?.props.numberOfLines).toBeUndefined();
    expect(label?.props.adjustsFontSizeToFit).toBeUndefined();
    fontScaleSpy.mockRestore();
  });
});
