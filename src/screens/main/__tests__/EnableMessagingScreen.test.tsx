import React from 'react';
import { Linking } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import EnableMessagingScreen from '../EnableMessagingScreen';
import { LinkService } from '../../../services/link/LinkService';

beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const PUBKYAUTH_URL =
  'pubkyauth:///?caps=/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw&secret=abc&relay=https://relay.example';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));

jest.mock('../../../services/link/LinkService', () => ({
  LinkService: {
    getEnableStatus: jest.fn(),
    enable: jest.fn(),
  },
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

async function flushController(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('EnableMessagingScreen', () => {
  it('shows a QR of the pubkyauth grant while authorizing', async () => {
    const pending = new Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }>(
      () => undefined,
    );
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('needs-enable');
    (LinkService.enable as jest.Mock).mockResolvedValue({
      authorizationUrl: PUBKYAUTH_URL,
      awaitEnabled: () => pending,
      cancel: jest.fn(),
    });

    const tree = await render(<EnableMessagingScreen />);
    await flushController();

    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'enableMessagingScanHint' }).props.children).toBe(
      'Scan with Pubky Ring on this or another device.',
    );
    expect(tree.root.findAllByProps({ children: PUBKYAUTH_URL }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'enableMessagingOpenRing' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'enableMessagingCopy' })).toBeTruthy();
    expect(Linking.openURL).toHaveBeenCalledWith(PUBKYAUTH_URL);
    await unmount(tree);
  });

  it('does not auto-open an https authorization URL', async () => {
    const pending = new Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }>(
      () => undefined,
    );
    const httpsUrl = 'https://evil.example/auth?secret=leak';
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('needs-enable');
    (LinkService.enable as jest.Mock).mockResolvedValue({
      authorizationUrl: httpsUrl,
      awaitEnabled: () => pending,
      cancel: jest.fn(),
    });

    const tree = await render(<EnableMessagingScreen />);
    await flushController();

    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'enableMessagingStatus' }).props.children).toBe(
      'Waiting for Pubky Ring…',
    );
    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    await unmount(tree);
  });

  it('does not show a QR before an authorization URL exists', async () => {
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('native-missing');

    const tree = await render(<EnableMessagingScreen />);
    await flushController();

    expect(tree.root.findByProps({ testID: 'enableMessagingStatus' }).props.children).toBe(
      'Native module missing',
    );
    expect(tree.root.findAllByProps({ testID: 'authQr' })).toHaveLength(0);
    await unmount(tree);
  });
});
