import { handleE2eDeepLink, linkingUrlForReactNavigation } from '../e2eDeepLinks';
import {
  applyE2eSignupContinue,
  getE2eSignupHud,
  saveE2eIdentity,
  setE2eSignupHud,
} from '../e2eSignupResult';
import { completeDebugSignup } from '../../screens/auth/debugSignupController';

jest.mock('../../screens/auth/debugSignupController', () => ({
  completeDebugSignup: jest.fn(),
}));

jest.mock('../../services/link/liveProofRun', () => ({
  runNamedLiveProofs: jest.fn(),
}));

jest.mock('../../services/link/PaykitLinkNative', () => ({
  PaykitLinkNative: {
    signupWithSecret: jest.fn(),
  },
}));

jest.mock('../../services/link/LinkService', () => ({
  LinkService: {
    signinWithSecret: jest.fn(),
    adoptHarnessSession: jest.fn(),
    provisionHarnessReceiver: jest.fn(),
    syncInbox: jest.fn(),
    ensureLinkWith: jest.fn(),
    sendDm: jest.fn(),
    acceptMessageRequest: jest.fn(),
  },
}));

jest.mock('../../services/KeyStore', () => ({
  KeyStore: {
    setHomeserver: jest.fn(),
    getPubky: jest.fn(),
  },
}));

const mockSetAuthenticated = jest.fn();

jest.mock('../../stores/authStore', () => ({
  useAuthStore: Object.assign(jest.fn(), {
    getState: () => ({
      pubky: null,
      setAuthenticated: (...args: unknown[]) => mockSetAuthenticated(...args),
    }),
  }),
}));

jest.mock('../../services/ContactsService', () => ({
  ContactsService: { addManualContact: jest.fn() },
}));

jest.mock('../../services/payments/PaymentService', () => ({
  PaymentService: { requestPayment: jest.fn() },
}));

jest.mock('../../stores/contactStore', () => {
  const upsertContact = jest.fn();
  return {
    useContactStore: Object.assign(jest.fn(), {
      getState: () => ({ upsertContact }),
    }),
  };
});

jest.mock('../../services/StorageService', () => ({
  StorageService: {
    getLinkMessagesForConversation: jest.fn(),
    listMessageRequests: jest.fn(),
  },
}));

jest.mock('../navigationRef', () => ({
  navigationRef: { isReady: () => true, navigate: jest.fn() },
  navigateRoot: jest.fn(),
}));

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Clipboard: { setString: jest.fn() },
  Linking: { openURL: jest.fn(), canOpenURL: jest.fn() },
}));

import { KeyStore } from '../../services/KeyStore';

const mockedComplete = jest.mocked(completeDebugSignup);

describe('handleE2eDeepLink debug-signup', () => {
  beforeEach(() => {
    setE2eSignupHud(null);
    mockedComplete.mockReset();
    mockSetAuthenticated.mockReset();
    jest.mocked(KeyStore.setHomeserver).mockReset();
  });

  it('is ignored outside hypercolor://e2e/', async () => {
    await expect(handleE2eDeepLink('hypercolor://welcome')).resolves.toBe(false);
  });

  it('runs completeDebugSignup and publishes the HUD result', async () => {
    mockedComplete.mockResolvedValue({
      pubky: 'a'.repeat(52),
      secretHex: 'ab'.repeat(32),
      homeserverPubky: 'hs',
      receiverPath: '/pub/paykit.app/v0/receiver',
    });

    await expect(
      handleE2eDeepLink('hypercolor://e2e/debug-signup?homeserver=hs&token=AAAA-BBBB-CCCC&secret='),
    ).resolves.toBe(true);

    expect(mockedComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        signupWithSecret: expect.any(Function),
        signinWithSecret: expect.any(Function),
      }),
      { homeserverPubky: 'hs', signupToken: 'AAAA-BBBB-CCCC', identitySecret: '' },
    );
    expect(KeyStore.setHomeserver).toHaveBeenCalledWith('hs');
    expect(mockSetAuthenticated).toHaveBeenCalledWith('a'.repeat(52), 'hs');
    expect(getE2eSignupHud()).toEqual({
      pubky: 'a'.repeat(52),
      secretHex: 'ab'.repeat(32),
      homeserverPubky: 'hs',
    });
  });

  it('accepts a packed p= query so Android intents keep all fields', async () => {
    mockedComplete.mockResolvedValue({
      pubky: 'a'.repeat(52),
      secretHex: 'ab'.repeat(32),
      homeserverPubky: 'hs',
      receiverPath: '/pub/paykit.app/v0/receiver',
    });
    await expect(
      handleE2eDeepLink(`hypercolor://e2e/debug-signup?p=hs~AAAA-BBBB-CCCC~A`),
    ).resolves.toBe(true);
    expect(mockedComplete).toHaveBeenCalledWith(expect.any(Object), {
      homeserverPubky: 'hs',
      signupToken: 'AAAA-BBBB-CCCC',
      identitySecret: '',
    });
    mockedComplete.mockClear();
    await expect(
      handleE2eDeepLink(`hypercolor://e2e/debug-signup?p=hs_AAAA-BBBB-CCCC_A`),
    ).resolves.toBe(true);
    expect(mockedComplete).toHaveBeenCalledWith(expect.any(Object), {
      homeserverPubky: 'hs',
      signupToken: 'AAAA-BBBB-CCCC',
      identitySecret: '',
    });
  });

  it('switches back to a saved slot without a signup token', async () => {
    mockedComplete.mockResolvedValue({
      pubky: 'b'.repeat(52),
      secretHex: 'cd'.repeat(32),
      homeserverPubky: 'hs',
      receiverPath: '/pub/paykit.app/v0/receiver',
    });
    await handleE2eDeepLink(
      'hypercolor://e2e/debug-signup?homeserver=hs&token=AAAA-BBBB-CCCC&slot=A&secret=',
    );
    mockedComplete.mockClear();
    mockedComplete.mockResolvedValue({
      pubky: 'b'.repeat(52),
      secretHex: 'cd'.repeat(32),
      homeserverPubky: 'hs',
      receiverPath: '/pub/paykit.app/v0/receiver',
    });
    await expect(handleE2eDeepLink('hypercolor://e2e/switch?slot=A')).resolves.toBe(true);
    expect(mockedComplete).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signupToken: '', identitySecret: 'cd'.repeat(32) }),
    );
  });

  it('adds a saved slot as a contact without a peer query param', async () => {
    saveE2eIdentity('A', {
      pubky: 'b'.repeat(52),
      secretHex: 'cd'.repeat(32),
      homeserverPubky: 'hs',
    });
    const { ContactsService } = jest.requireMock('../../services/ContactsService') as {
      ContactsService: { addManualContact: jest.Mock };
    };
    const { useContactStore } = jest.requireMock('../../stores/contactStore') as {
      useContactStore: { getState: () => { upsertContact: jest.Mock } };
    };
    jest.mocked(KeyStore.getPubky).mockReturnValue('y'.repeat(52));
    ContactsService.addManualContact.mockResolvedValue({
      ok: true,
      contact: { pubky: 'b'.repeat(52), displayName: 'B' },
    });

    await expect(handleE2eDeepLink('hypercolor://e2e/add-contact?slot=A')).resolves.toBe(true);
    expect(ContactsService.addManualContact).toHaveBeenCalledWith('y'.repeat(52), 'b'.repeat(52));
    expect(useContactStore.getState().upsertContact).toHaveBeenCalled();
  });

  it('keeps e2e URLs out of React Navigation linking', () => {
    expect(linkingUrlForReactNavigation(null)).toBeNull();
    expect(linkingUrlForReactNavigation('hypercolor://welcome')).toBe('hypercolor://welcome');
    expect(linkingUrlForReactNavigation('hypercolor://e2e/debug-signup?p=hs|tok|A')).toBeNull();
  });

  it('Continue reapplies auth from the HUD so Welcome cannot stick', () => {
    setE2eSignupHud({
      pubky: 'a'.repeat(52),
      secretHex: 'ab'.repeat(32),
      homeserverPubky: 'hs',
    });
    expect(applyE2eSignupContinue(getE2eSignupHud())).toBe(true);
    expect(KeyStore.setHomeserver).toHaveBeenCalledWith('hs');
    expect(mockSetAuthenticated).toHaveBeenCalledWith('a'.repeat(52), 'hs');
    expect(getE2eSignupHud()).toBeNull();
  });

  it('error HUD reports param lengths without secrets', async () => {
    mockedComplete.mockRejectedValue(new Error('authentication failed'));
    await expect(
      handleE2eDeepLink('hypercolor://e2e/debug-signup?p=hh_AAAA-BBBB-CCCC_Z'),
    ).resolves.toBe(true);
    const hud = getE2eSignupHud();
    expect(hud?.error).toBe(true);
    expect(hud?.pubky).toContain('authentication failed');
    expect(hud?.pubky).toContain('hs=2');
    expect(hud?.pubky).toContain('token=14');
    expect(hud?.pubky).not.toContain('AAAA-BBBB-CCCC');
  });

  it('Continue does not authenticate an error HUD', () => {
    mockSetAuthenticated.mockClear();
    setE2eSignupHud({
      pubky: 'error:signup failed',
      secretHex: 'error',
      homeserverPubky: '',
      error: true,
    });
    expect(applyE2eSignupContinue(getE2eSignupHud())).toBe(false);
    expect(mockSetAuthenticated).not.toHaveBeenCalled();
    expect(getE2eSignupHud()).toBeNull();
  });
});
