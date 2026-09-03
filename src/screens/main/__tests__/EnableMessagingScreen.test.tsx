import React from 'react';
import { AppState, Linking } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import EnableMessagingScreen from '../EnableMessagingScreen';
import { LinkService } from '../../../services/link/LinkService';
import { COPY } from '../../../copy/uxCopy';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const PUBKYAUTH_URL =
  'pubkyauth:///?caps=/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw&secret=abc&relay=https://relay.example';

const mockGoBack = jest.fn();
const mockReset = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, reset: mockReset }),
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

async function startAuthorizing(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    tree.root.findByProps({ testID: 'enableMessagingStart' }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('EnableMessagingScreen', () => {
  beforeEach(() => {
    mockGoBack.mockReset();
    mockReset.mockReset();
  });

  it('shows a QR of the pubkyauth grant while authorizing', async () => {
    const pending = new Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }>(
      () => undefined,
    );
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('needs-enable');
    (LinkService.enable as jest.Mock).mockResolvedValue({
      authorizationUrl: PUBKYAUTH_URL,
      awaitEnabled: () => pending,
      cancel: jest.fn(),
      releaseKeepalive: jest.fn(),
    });

    const tree = await render(<EnableMessagingScreen />);
    await flushController();
    await startAuthorizing(tree);

    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'enableMessagingScanHint' }).props.children).toBe(
      COPY.waitingForRingBody,
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
      releaseKeepalive: jest.fn(),
    });

    const tree = await render(<EnableMessagingScreen />);
    await flushController();
    await startAuthorizing(tree);

    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'enableMessagingStatus' }).props.children).toBe(
      COPY.waitingForRing,
    );
    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    await unmount(tree);
  });

  it('does not show Native module missing as a status label', async () => {
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('native-missing');

    const tree = await render(<EnableMessagingScreen />);
    await flushController();

    expect(tree.root.findByProps({ testID: 'enableMessagingStatus' }).props.children).toBe(
      COPY.messagingUnavailable,
    );
    expect(tree.root.findAllByProps({ children: 'Native module missing' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'authQr' })).toHaveLength(0);
    await unmount(tree);
  });

  it('renders Open chats as the only brand-filled success action and resets to Chats', async () => {
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('enabled');

    const tree = await render(<EnableMessagingScreen />);
    await flushController();

    const openChats = tree.root.findByProps({ testID: 'enableMessagingOpenChats' });
    expect(openChats.props.accessibilityLabel).toBe(COPY.openChats);
    expect(tree.root.findByProps({ testID: 'enableMessagingDone' }).props.accessibilityLabel).toBe(
      COPY.done,
    );
    expect(tree.root.findAllByProps({ children: 'You can leave this screen.' })).toHaveLength(0);

    await act(async () => {
      openChats.props.onPress();
    });
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Main', params: { screen: 'Chats' } }],
    });
    await unmount(tree);
  });

  it('re-checks enable status when returning from background', async () => {
    const pending = new Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }>(
      () => undefined,
    );
    let appListener: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      appListener = handler as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('needs-enable');
    (LinkService.enable as jest.Mock).mockResolvedValue({
      authorizationUrl: PUBKYAUTH_URL,
      awaitEnabled: () => pending,
      cancel: jest.fn(),
      releaseKeepalive: jest.fn(),
    });

    const tree = await render(<EnableMessagingScreen />);
    await flushController();
    await startAuthorizing(tree);
    expect(tree.root.findByProps({ testID: 'enableMessagingStatus' }).props.children).toBe(
      COPY.waitingForRing,
    );

    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('enabled');
    await act(async () => {
      appListener?.('active');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'enableMessagingStatus' }).props.children).toBe(
      COPY.encryptedMessagingEnabled,
    );
    expect(tree.root.findByProps({ testID: 'enableMessagingOpenChats' })).toBeTruthy();
    await unmount(tree);
  });

  it('disables Enable encrypted messaging while enable() is unresolved', async () => {
    let resolveEnable!: (flow: {
      authorizationUrl: string;
      awaitEnabled: () => Promise<unknown>;
      cancel: () => void;
      releaseKeepalive: () => void;
    }) => void;
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('needs-enable');
    (LinkService.enable as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveEnable = resolve;
        }),
    );

    const tree = await render(<EnableMessagingScreen />);
    await flushController();
    await act(async () => {
      tree.root.findByProps({ testID: 'enableMessagingStart' }).props.onPress();
    });
    const start = tree.root.findByProps({ testID: 'enableMessagingStart' });
    expect(start.props.disabled).toBe(true);
    expect(start.props.accessibilityState).toEqual({ busy: true, disabled: true });
    await act(async () => {
      resolveEnable({
        authorizationUrl: PUBKYAUTH_URL,
        awaitEnabled: () => new Promise(() => undefined),
        cancel: jest.fn(),
        releaseKeepalive: jest.fn(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await unmount(tree);
  });
});
