import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AwaitingRingAuthScreen from '../AwaitingRingAuthScreen';

const PAYKIT_CONNECT_URL =
  'pubkyring://paykit-connect?deviceId=hypercolor-sim&callback=hypercolor%3A%2F%2Fring-callback&ephemeralPk=aabbcc&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw';

const mockGoBack = jest.fn();
const mockUseRoute = jest.fn();
const mockSetString = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => mockUseRoute(),
}));

jest.mock('../../../utils/copyText', () => ({
  copyText: (...args: unknown[]) => mockSetString(...args),
}));

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

describe('AwaitingRingAuthScreen', () => {
  beforeEach(() => {
    mockSetString.mockReset();
    mockUseRoute.mockReturnValue({ params: { ringAuthUrl: PAYKIT_CONNECT_URL } });
  });

  it('shows a QR of the paykit-connect URL and first-class scan copy', async () => {
    const tree = await render(<AwaitingRingAuthScreen />);

    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthScanHint' }).props.children).toBe(
      'Scan with Bitkit or Pubky Ring on this or another device.',
    );
    expect(tree.root.findAllByProps({ children: PAYKIT_CONNECT_URL }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthOpenRing' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'awaitingRingAuthCopy' })).toBeTruthy();
    await unmount(tree);
  });

  it('copies the paykit-connect URL', async () => {
    const tree = await render(<AwaitingRingAuthScreen />);

    act(() => {
      tree.root.findByProps({ testID: 'awaitingRingAuthCopy' }).props.onPress();
    });

    expect(mockSetString).toHaveBeenCalledWith(PAYKIT_CONNECT_URL);
    await unmount(tree);
  });

  it('hides the QR when no URL was passed', async () => {
    mockUseRoute.mockReturnValue({ params: { ringAuthUrl: '' } });
    const tree = await render(<AwaitingRingAuthScreen />);
    expect(tree.root.findAllByProps({ testID: 'authQr' })).toHaveLength(0);
    await unmount(tree);
  });
});
