import React from 'react';
import { Dimensions } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FollowsConsentSheet, CONSENT_TITLE } from '../FollowsConsentSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));

async function render(
  width: number,
  height: number,
  fontScale: number,
): Promise<ReactTestRenderer> {
  jest.spyOn(Dimensions, 'get').mockReturnValue({
    width,
    height,
    scale: 2,
    fontScale,
  } as ReturnType<typeof Dimensions.get>);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <FollowsConsentSheet
        visible
        busy={false}
        onConfirm={() => undefined}
        onDismiss={() => undefined}
      />,
    );
  });
  return tree;
}

describe('FollowsConsentSheet', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the confirm action outside the scroll region on a small iPhone at 200% text', async () => {
    const tree = await render(375, 667, 2);
    expect(JSON.stringify(tree.toJSON())).toContain(CONSENT_TITLE);
    const scroll = tree.root.findByProps({ testID: 'followsConsentScroll' });
    const actions = tree.root.findByProps({ testID: 'followsConsentActions' });
    const confirm = tree.root.findByProps({ testID: 'followsConsentConfirm' });
    expect(scroll).toBeTruthy();
    expect(actions).toBeTruthy();
    expect(confirm.props.accessibilityState.disabled).toBe(true);
    expect(scroll.findAllByProps({ testID: 'followsConsentConfirm' })).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps the confirm action reachable on a small Android profile at 200% text', async () => {
    const tree = await render(360, 800, 2);
    expect(tree.root.findByProps({ testID: 'followsConsentConfirm' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'followsConsentNotNow' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'followsConsentActions' })).toBeTruthy();
    await act(async () => {
      tree.unmount();
    });
  });
});
