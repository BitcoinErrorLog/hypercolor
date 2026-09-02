import { COPY } from '../../copy/uxCopy';
import { LinkService } from '../../services/link/LinkService';
import { StorageService } from '../../services/StorageService';
import { useSessionStatusStore } from '../sessionStatusStore';

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

jest.mock('../../services/StorageService', () => ({
  StorageService: {
    getLinkReceiver: jest.fn(),
    countPendingMessageRequests: jest.fn(),
  },
}));

jest.mock('../authStore', () => ({
  useAuthStore: {
    getState: () => mockAuthState,
  },
}));

describe('sessionStatusStore.retryOffline', () => {
  beforeEach(() => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.pubky = 'c'.repeat(52);
    useSessionStatusStore.setState({
      kind: 'offline',
      enableStatus: 'session-offline',
      pendingRequestCount: 0,
      refreshing: false,
    });
    (LinkService.restorePersistedSession as jest.Mock).mockResolvedValue(undefined);
    (LinkService.getEnableStatus as jest.Mock).mockResolvedValue('enabled');
    (StorageService.getLinkReceiver as jest.Mock).mockResolvedValue({ markerPublished: true });
    (StorageService.countPendingMessageRequests as jest.Mock).mockResolvedValue(0);
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
});
