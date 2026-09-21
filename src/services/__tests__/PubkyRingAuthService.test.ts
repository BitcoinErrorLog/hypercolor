jest.mock('react-native', () => ({
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
}));

jest.mock('../KeyStore', () => ({
  KeyStore: {
    isInitialized: jest.fn(() => false),
    getPubky: jest.fn(() => null),
    setPubky: jest.fn(),
    setHomeserver: jest.fn(),
    clearPendingRingHandoff: jest.fn(),
    setPendingRingHandoff: jest.fn(),
    deleteLinkSessionIfAlias: jest.fn(),
    clearIfPubky: jest.fn(),
  },
}));

jest.mock('../link/PaykitLinkNative', () => ({
  isLinkNativeError: (err: unknown) => {
    if (typeof err !== 'object' || err === null) return false;
    const code = (err as { code?: unknown }).code;
    return (
      typeof code === 'string' &&
      [
        'network',
        'auth',
        'protocol',
        'consumed',
        'validation',
        'unavailable',
        'auth_flow_cancelled',
      ].includes(code)
    );
  },
  PaykitLinkNative: {
    isAvailable: jest.fn(() => false),
    startAuthFlow: jest.fn(),
    awaitAuthApproval: jest.fn(),
    cancelAuthFlow: jest.fn(),
    stopAuthKeepalive: jest.fn(),
    signOutSession: jest.fn(),
    sessionCapabilities: jest.fn(),
  },
}));

jest.mock('../link/LinkService', () => ({
  LinkService: {
    adoptApprovedSession: jest.fn(),
    provisionReceiverAfterConnect: jest.fn(),
    signOutSessionQuiet: jest.fn(),
  },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Linking } from 'react-native';
import { KeyStore } from '../KeyStore';
import {
  BindingMismatchError,
  ScopesDeclinedError,
  cancelPendingDelegation,
  confirmFreshIdentity,
  getPendingDelegationSnapshot,
  parsePubkyauthAuthorizationUrl,
  requestDelegation,
  watchPendingApproval,
  ExpiredDelegationError,
} from '../PubkyRingAuthService';
import { RING_GRANT_CAPABILITIES } from '../../types/link';
import { ENABLE_AUTH_TTL_MS } from '../../copy/uxCopy';
import { PaykitLinkNative } from '../link/PaykitLinkNative';
import { LinkService } from '../link/LinkService';

const OWNER_A = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const OWNER_B = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const ORIGIN = 'https://homeserver.staging.pubky.app';
const AUTH_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AUTH_RELAY = 'https://httprelay.pubky.app/link/';

function authUrl(caps: string = RING_GRANT_CAPABILITIES): string {
  return (
    `pubkyauth:///?caps=${encodeURIComponent(caps)}` +
    `&secret=${AUTH_SECRET}&relay=${encodeURIComponent(AUTH_RELAY)}`
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function started<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

async function mintFlow(url: string = authUrl()): Promise<{
  approval: ReturnType<typeof deferred<{ sessionAlias: string; pubky: string }>>;
  flowId: string;
}> {
  const approval = deferred<{ sessionAlias: string; pubky: string }>();
  const flowId = `flow-${Math.random().toString(16).slice(2)}`;
  jest.mocked(PaykitLinkNative.startAuthFlow).mockResolvedValue({
    flowId,
    authorizationUrl: url,
  });
  jest.mocked(PaykitLinkNative.awaitAuthApproval).mockReturnValue(started(approval.promise));
  await requestDelegation();
  return { approval, flowId };
}

describe('PubkyRingAuthService pubkyauth ceremony', () => {
  beforeEach(() => {
    jest.mocked(Linking.canOpenURL).mockResolvedValue(true);
    jest.mocked(Linking.openURL).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.isAvailable).mockReturnValue(true);
    jest.mocked(PaykitLinkNative.cancelAuthFlow).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.stopAuthKeepalive).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.signOutSession).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.sessionCapabilities).mockResolvedValue({
      capabilities: RING_GRANT_CAPABILITIES,
      origin: ORIGIN,
    });
    jest.mocked(LinkService.adoptApprovedSession).mockResolvedValue({
      alias: 'alias-a',
      pubky: OWNER_A,
    });
    jest.mocked(LinkService.provisionReceiverAfterConnect).mockResolvedValue({
      pubky: OWNER_A,
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise',
    } as never);
    jest.mocked(LinkService.signOutSessionQuiet).mockResolvedValue(undefined);
    jest.mocked(KeyStore.isInitialized).mockReturnValue(false);
    jest.mocked(KeyStore.getPubky).mockReturnValue(null);
    jest.mocked(KeyStore.setPubky).mockReset();
    jest.mocked(KeyStore.setHomeserver).mockReset();
    jest.mocked(KeyStore.setPendingRingHandoff).mockReset();
    jest.mocked(KeyStore.clearIfPubky).mockReset();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await cancelPendingDelegation();
    jest.clearAllMocks();
  });

  it('mints a raw pubkyauth URL covering RING_GRANT and opens it', async () => {
    const { flowId } = await mintFlow();
    expect(PaykitLinkNative.startAuthFlow).toHaveBeenCalledWith(RING_GRANT_CAPABILITIES);
    expect(PaykitLinkNative.awaitAuthApproval).toHaveBeenCalledWith(flowId);
    expect(Linking.canOpenURL).toHaveBeenCalledWith('pubkyauth://');
    expect(Linking.openURL).toHaveBeenCalledWith(authUrl());
    expect(KeyStore.setPendingRingHandoff).not.toHaveBeenCalled();
    const snap = getPendingDelegationSnapshot();
    expect(snap?.url).toBe(authUrl());
    expect(snap?.url.startsWith('pubkyauth:')).toBe(true);
  });

  it('accepts reordered caps that still cover RING_GRANT and rejects a missing hypercolor scope', () => {
    const reordered = `${encodeURIComponent('/pub/hypercolor.app/v1/:rw,/pub/paykit/:rw')}`;
    expect(
      parsePubkyauthAuthorizationUrl(
        `pubkyauth:///?caps=${reordered}&secret=${AUTH_SECRET}&relay=${encodeURIComponent(AUTH_RELAY)}`,
      ).caps,
    ).toBe('/pub/hypercolor.app/v1/:rw,/pub/paykit/:rw');
    expect(() =>
      parsePubkyauthAuthorizationUrl(
        `pubkyauth:///?caps=${encodeURIComponent('/pub/paykit/:rw')}&secret=${AUTH_SECRET}&relay=${encodeURIComponent(AUTH_RELAY)}`,
      ),
    ).toThrow('do not cover RING_GRANT');
  });

  it('cancels the native flow when the minted URL fails the relay allowlist', async () => {
    jest.mocked(PaykitLinkNative.startAuthFlow).mockResolvedValue({
      flowId: 'bad-relay',
      authorizationUrl: `pubkyauth:///?caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}&secret=${AUTH_SECRET}&relay=${encodeURIComponent('https://evil.example/link/')}`,
    });
    await expect(requestDelegation()).rejects.toThrow('allowlisted');
    expect(PaykitLinkNative.cancelAuthFlow).toHaveBeenCalledWith('bad-relay');
  });

  it('expires at the five-minute TTL and signs out a late alias', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const { approval, flowId } = await mintFlow();
    jest.setSystemTime(1_000 + ENABLE_AUTH_TTL_MS);
    await expect(watchPendingApproval()).rejects.toBeInstanceOf(ExpiredDelegationError);
    expect(PaykitLinkNative.cancelAuthFlow).toHaveBeenCalledWith(flowId);
    approval.resolve({ sessionAlias: 'late-alias', pubky: OWNER_A });
    await flush();
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalledWith('late-alias');
    expect(LinkService.adoptApprovedSession).not.toHaveBeenCalled();
  });

  it('cancels an in-flight await and does not adopt a late session', async () => {
    const { approval } = await mintFlow();
    await cancelPendingDelegation();
    approval.resolve({ sessionAlias: 'late-cancel', pubky: OWNER_A });
    await flush();
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalledWith('late-cancel');
    expect(LinkService.adoptApprovedSession).not.toHaveBeenCalled();
  });

  it('adopts a matching owner without writing AppKey material', async () => {
    jest.mocked(KeyStore.isInitialized).mockReturnValue(true);
    jest.mocked(KeyStore.getPubky).mockReturnValue(OWNER_A);
    const { approval } = await mintFlow();
    approval.resolve({ sessionAlias: 'alias-a', pubky: OWNER_A });
    await expect(watchPendingApproval()).resolves.toEqual({
      kind: 'adopted',
      pubky: OWNER_A,
      homeserver: ORIGIN,
      receiverPublished: true,
    });
    expect(LinkService.adoptApprovedSession).toHaveBeenCalledWith('alias-a', OWNER_A);
    expect(LinkService.provisionReceiverAfterConnect).toHaveBeenCalled();
    expect(KeyStore.setHomeserver).toHaveBeenCalledWith(ORIGIN);
    expect(KeyStore.setPubky).not.toHaveBeenCalled();
  });

  it('rejects a mismatched owner by signing out only the new alias', async () => {
    jest.mocked(KeyStore.isInitialized).mockReturnValue(true);
    jest.mocked(KeyStore.getPubky).mockReturnValue(OWNER_A);
    const { approval } = await mintFlow();
    approval.resolve({ sessionAlias: 'alias-b', pubky: OWNER_B });
    await expect(watchPendingApproval()).rejects.toBeInstanceOf(BindingMismatchError);
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalledWith('alias-b');
    expect(KeyStore.clearIfPubky).not.toHaveBeenCalled();
    expect(KeyStore.setPubky).not.toHaveBeenCalled();
    expect(LinkService.adoptApprovedSession).not.toHaveBeenCalled();
    expect(KeyStore.getPubky()).toBe(OWNER_A);
  });

  it('requires Confirm before KeyStore commit on a fresh Welcome identity', async () => {
    const { approval } = await mintFlow();
    approval.resolve({ sessionAlias: 'alias-fresh', pubky: OWNER_A });
    await expect(watchPendingApproval()).resolves.toMatchObject({
      kind: 'confirm',
      pubky: OWNER_A,
      sessionAlias: 'alias-fresh',
    });
    expect(LinkService.adoptApprovedSession).not.toHaveBeenCalled();
    await expect(confirmFreshIdentity()).resolves.toMatchObject({
      kind: 'adopted',
      pubky: OWNER_A,
    });
    expect(LinkService.adoptApprovedSession).toHaveBeenCalledWith('alias-fresh', OWNER_A);
  });

  it('rejects a session whose capability set drops hypercolor write', async () => {
    jest.mocked(PaykitLinkNative.sessionCapabilities).mockResolvedValue({
      capabilities: '/pub/paykit/:rw',
      origin: ORIGIN,
    });
    const { approval } = await mintFlow();
    approval.resolve({ sessionAlias: 'alias-narrow', pubky: OWNER_A });
    await expect(watchPendingApproval()).rejects.toBeInstanceOf(ScopesDeclinedError);
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalledWith('alias-narrow');
    expect(LinkService.adoptApprovedSession).not.toHaveBeenCalled();
  });

  it('accepts a broader /pub/:rw grant that covers both RING_GRANT trees', async () => {
    jest.mocked(KeyStore.isInitialized).mockReturnValue(true);
    jest.mocked(KeyStore.getPubky).mockReturnValue(OWNER_A);
    jest.mocked(PaykitLinkNative.sessionCapabilities).mockResolvedValue({
      capabilities: '/pub/:rw',
      origin: ORIGIN,
    });
    const { approval } = await mintFlow();
    approval.resolve({ sessionAlias: 'alias-broad', pubky: OWNER_A });
    await expect(watchPendingApproval()).resolves.toMatchObject({ kind: 'adopted' });
    expect(LinkService.adoptApprovedSession).toHaveBeenCalledWith('alias-broad', OWNER_A);
  });

  it('revokes the alias when provision returns 401', async () => {
    jest.mocked(KeyStore.isInitialized).mockReturnValue(true);
    jest.mocked(KeyStore.getPubky).mockReturnValue(OWNER_A);
    jest.mocked(LinkService.provisionReceiverAfterConnect).mockRejectedValue({
      code: 'auth',
      message: 'authentication failed',
    });
    const { approval } = await mintFlow();
    approval.resolve({ sessionAlias: 'alias-401', pubky: OWNER_A });
    await expect(watchPendingApproval()).rejects.toBeInstanceOf(ScopesDeclinedError);
    expect(LinkService.signOutSessionQuiet).toHaveBeenCalledWith('alias-401');
    expect(KeyStore.deleteLinkSessionIfAlias).toHaveBeenCalledWith('alias-401');
  });

  it('does not persist the authorization URL in KeyStore', () => {
    const source = readFileSync(join(__dirname, '../PubkyRingAuthService.ts'), 'utf8');
    expect(source).not.toMatch(/setPendingRingHandoff/);
    expect(source).not.toMatch(/authorizationUrl.*MMKV|AsyncStorage/);
  });
});
