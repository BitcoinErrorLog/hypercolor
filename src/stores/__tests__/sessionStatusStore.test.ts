import { COPY } from '../../copy/uxCopy';
import { KeyStore } from '../../services/KeyStore';
import { LinkService } from '../../services/link/LinkService';
import { StorageService } from '../../services/StorageService';
import { resetSessionStatusReceiverEvidence, useSessionStatusStore } from '../sessionStatusStore';

const mockAuthState = {
  isAuthenticated: true,
  pubky: 'c'.repeat(52),
};

jest.mock('../../services/link/LinkService', () => ({
  LinkService: {
    getEnableStatus: jest.fn(),
    restorePersistedSession: jest.fn(),
  },
}));

jest.mock('../../services/KeyStore', () => ({
  KeyStore: {
    isInitialized: jest.fn(() => true),
  },
}));

jest.mock('../../services/StorageService', () => ({
  StorageService: {
    getLinkReceiver: jest.fn(),
    countPendingMessageRequests: jest.fn(),
    countUnreadGroupMessages: jest.fn(),
  },
}));

jest.mock('../authStore', () => ({
  useAuthStore: {
    getState: () => mockAuthState,
  },
}));

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

function resetStore(): void {
  useSessionStatusStore.setState({
    kind: 'offline',
    enableStatus: 'session-offline',
    pendingRequestCount: 0,
    groupUnreadCount: 0,
    refreshing: false,
    lastError: null,
  });
}

describe('sessionStatusStore', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.pubky = 'c'.repeat(52);
    resetSessionStatusReceiverEvidence();
    resetStore();
    (LinkService.restorePersistedSession as jest.Mock).mockResolvedValue(undefined);
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('enabled');
    (StorageService.getLinkReceiver as jest.Mock).mockResolvedValue({ markerPublished: true });
    (StorageService.countPendingMessageRequests as jest.Mock).mockResolvedValue(0);
    (StorageService.countUnreadGroupMessages as jest.Mock).mockResolvedValue(0);
    (KeyStore.isInitialized as jest.Mock).mockReturnValue(true);
  });

  it('retries restore instead of routing to Enable', async () => {
    await useSessionStatusStore.getState().retryOffline();
    expect(LinkService.restorePersistedSession).toHaveBeenCalled();
    expect(LinkService.getEnableStatus).toHaveBeenCalled();
    expect(useSessionStatusStore.getState().kind).toBe('enabled');
    expect(useSessionStatusStore.getState().kind).not.toBe('needs-enable');
  });

  it('labels offline with the canonical banner copy', () => {
    expect(COPY.sessionOfflineBanner).toBe(
      'You are offline. Messages will send when you reconnect.',
    );
    expect(COPY.tryAgain).toBe('Try again');
  });

  it('ignores a stale getEnableStatus result when a newer refresh wins', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    (LinkService.getEnableStatus as jest.Mock).mockImplementation(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    (StorageService.getLinkReceiver as jest.Mock).mockResolvedValue({ markerPublished: false });
    const stale = useSessionStatusStore.getState().refresh();
    const latest = useSessionStatusStore.getState().refresh();
    second.resolve('needs-enable');
    await latest;
    expect(useSessionStatusStore.getState().kind).toBe('needs-enable');
    first.resolve('enabled');
    await stale;
    expect(useSessionStatusStore.getState().kind).toBe('needs-enable');
    expect(useSessionStatusStore.getState().enableStatus).toBe('needs-enable');
  });

  it('does not keep a stale enabled kind when status is offline and optional reads fail', async () => {
    useSessionStatusStore.setState({
      kind: 'enabled',
      enableStatus: 'enabled',
      pendingRequestCount: 4,
      groupUnreadCount: 2,
      refreshing: false,
      lastError: null,
    });
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('session-offline');
    (StorageService.getLinkReceiver as jest.Mock).mockRejectedValue(new Error('disk'));
    (StorageService.countPendingMessageRequests as jest.Mock).mockRejectedValue(new Error('disk'));
    (StorageService.countUnreadGroupMessages as jest.Mock).mockRejectedValue(new Error('disk'));
    await useSessionStatusStore.getState().refresh();
    expect(useSessionStatusStore.getState().kind).toBe('offline');
    expect(useSessionStatusStore.getState().enableStatus).toBe('session-offline');
    expect(useSessionStatusStore.getState().pendingRequestCount).toBe(4);
    expect(useSessionStatusStore.getState().lastError).toBeNull();
  });

  it('marks network failures on status as offline without dropping identity', async () => {
    (LinkService.getEnableStatus as jest.Mock).mockRejectedValue(
      new Error('network request failed https://relay.example'),
    );
    await useSessionStatusStore.getState().refresh();
    const state = useSessionStatusStore.getState();
    expect(state.kind).toBe('offline');
    expect(state.lastError).not.toBeNull();
    expect(state.lastError?.details).not.toContain('https://relay.example');
    expect(state.refreshing).toBe(false);
  });

  it('lets overlapping retryOffline calls settle without sticking on refreshing', async () => {
    await Promise.all([
      useSessionStatusStore.getState().retryOffline(),
      useSessionStatusStore.getState().retryOffline(),
    ]);
    expect(useSessionStatusStore.getState().kind).toBe('enabled');
    expect(useSessionStatusStore.getState().refreshing).toBe(false);
    expect(useSessionStatusStore.getState().lastError).toBeNull();
  });

  it('keeps revoked when the receiver is published and a count query rejects', async () => {
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('needs-enable');
    (StorageService.getLinkReceiver as jest.Mock).mockResolvedValue({ markerPublished: true });
    (StorageService.countPendingMessageRequests as jest.Mock).mockRejectedValue(new Error('disk'));
    (StorageService.countUnreadGroupMessages as jest.Mock).mockResolvedValue(2);
    await useSessionStatusStore.getState().refresh();
    expect(useSessionStatusStore.getState().kind).toBe('revoked');
    expect(useSessionStatusStore.getState().kind).not.toBe('needs-enable');
    expect(useSessionStatusStore.getState().enableStatus).toBe('needs-enable');
    expect(useSessionStatusStore.getState().groupUnreadCount).toBe(2);
  });

  it('does not let owner B inherit owner A receiver evidence', async () => {
    mockAuthState.pubky = 'a'.repeat(52);
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('needs-enable');
    (StorageService.getLinkReceiver as jest.Mock).mockResolvedValue({ markerPublished: true });
    await useSessionStatusStore.getState().refresh();
    expect(useSessionStatusStore.getState().kind).toBe('revoked');

    mockAuthState.pubky = 'b'.repeat(52);
    (StorageService.getLinkReceiver as jest.Mock).mockRejectedValue(new Error('disk'));
    await useSessionStatusStore.getState().refresh();
    expect(useSessionStatusStore.getState().kind).toBe('needs-enable');
    expect(useSessionStatusStore.getState().kind).not.toBe('revoked');
    expect(useSessionStatusStore.getState().enableStatus).toBe('needs-enable');
  });

  it('surfaces keystore-unavailable without reading enable status', async () => {
    (KeyStore.isInitialized as jest.Mock).mockReturnValue(false);
    await useSessionStatusStore.getState().refresh();
    expect(useSessionStatusStore.getState().kind).toBe('keystore-unavailable');
    expect(LinkService.getEnableStatus).not.toHaveBeenCalled();
    useSessionStatusStore.getState().markKeystoreUnavailable();
    expect(useSessionStatusStore.getState().kind).toBe('keystore-unavailable');
  });

  it('retryOffline is a no-op when the keystore is not ready', async () => {
    (KeyStore.isInitialized as jest.Mock).mockReturnValue(false);
    await useSessionStatusStore.getState().retryOffline();
    expect(LinkService.restorePersistedSession).not.toHaveBeenCalled();
    expect(LinkService.getEnableStatus).not.toHaveBeenCalled();
    expect(useSessionStatusStore.getState().kind).toBe('keystore-unavailable');
  });
});
