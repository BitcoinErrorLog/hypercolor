const mockPutOwnerDocument = jest.fn();
const mockDeleteOwnerDocument = jest.fn();
const mockIsAppCertValid = jest.fn();
const mockGetAppKeypair = jest.fn();
const mockRnPut = jest.fn();

jest.mock('../resetAfterFailedWipe', () => ({
  shouldOfferResetAfterFailedWipe: jest.fn(),
  resetAppDataAfterFailedWipe: jest.fn(),
  recordBootWipeFailure: jest.fn(),
}));

jest.mock('../link/LinkService', () => ({
  LinkService: {
    putOwnerDocument: (...args: unknown[]) => mockPutOwnerDocument(...args),
    deleteOwnerDocument: (...args: unknown[]) => mockDeleteOwnerDocument(...args),
    clearSession: jest.fn(),
  },
}));

jest.mock('../KeyStore', () => ({
  KeyStore: {
    isAppCertValid: (...args: unknown[]) => mockIsAppCertValid(...args),
    getAppKeypair: (...args: unknown[]) => mockGetAppKeypair(...args),
    getSessionSecret: jest.fn(),
    markSignOutIncomplete: jest.fn(),
    isSignOutIncomplete: jest.fn(() => false),
    getSignOutIncompleteOwner: jest.fn(() => null),
    clearSignOutIncomplete: jest.fn(),
    clearIfPubky: jest.fn(),
  },
}));

jest.mock('../StorageService', () => ({
  StorageService: {
    persistSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
    hasSignOutIncompleteJournal: jest.fn().mockResolvedValue(false),
    getSignOutIncompleteJournalOwner: jest.fn().mockResolvedValue(null),
    clearSignOutIncompleteJournal: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@synonymdev/react-native-pubky', () => ({
  signOut: jest.fn(),
  put: (...args: unknown[]) => mockRnPut(...args),
  get: jest.fn(),
  deleteFile: jest.fn(),
  list: jest.fn(),
  getHomeserver: jest.fn(),
}));

jest.mock('../../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ clearSession: jest.fn() }),
  },
}));

import {
  INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE,
  INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE_CODE,
  INTERRUPTED_SIGN_OUT_OWNER_MISSING,
  INTERRUPTED_SIGN_OUT_OWNER_MISSING_CODE,
  InterruptedSignOutMarkerUnreadableError,
  InterruptedSignOutOwnerMissingError,
  PubkyService,
} from '../PubkyService';

describe('PubkyService owner writes', () => {
  beforeEach(() => {
    mockPutOwnerDocument.mockReset();
    mockDeleteOwnerDocument.mockReset();
    mockIsAppCertValid.mockReset();
    mockGetAppKeypair.mockReset();
    mockRnPut.mockReset();
  });

  it('routes put through the Paykit session, not AppKey / rnPut', async () => {
    mockPutOwnerDocument.mockResolvedValue(undefined);
    const url = 'pubky://owner/pub/hypercolor.app/v1/backup/latest';
    await PubkyService.put(url, 'blob');
    expect(mockPutOwnerDocument).toHaveBeenCalledWith(url, 'blob');
    expect(mockRnPut).not.toHaveBeenCalled();
    expect(mockIsAppCertValid).not.toHaveBeenCalled();
    expect(mockGetAppKeypair).not.toHaveBeenCalled();
  });

  it('routes delete through the Paykit session', async () => {
    mockDeleteOwnerDocument.mockResolvedValue(undefined);
    const url = 'pubky://owner/pub/hypercolor.app/v1/attachments/abc';
    await PubkyService.delete(url);
    expect(mockDeleteOwnerDocument).toHaveBeenCalledWith(url);
    expect(mockIsAppCertValid).not.toHaveBeenCalled();
  });
});

describe('PubkyService.isTypedSignInRestoreError', () => {
  it('treats KeyStore, wipe-wait, owner, and marker errors as typed', () => {
    expect(PubkyService.isTypedSignInRestoreError({ code: 'KeyStoreNotReady' })).toBe(true);
    expect(PubkyService.isTypedSignInRestoreError({ code: 'wipe-wait-timeout' })).toBe(true);
    expect(PubkyService.isTypedSignInRestoreError({ code: 'owner-changed' })).toBe(true);
    expect(PubkyService.isTypedSignInRestoreError({ code: 'reset-app-data-failed' })).toBe(true);
    expect(
      PubkyService.isTypedSignInRestoreError(new InterruptedSignOutMarkerUnreadableError()),
    ).toBe(true);
    expect(PubkyService.isTypedSignInRestoreError(new InterruptedSignOutOwnerMissingError())).toBe(
      true,
    );
    expect(
      PubkyService.isTypedSignInRestoreError({
        code: INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE_CODE,
        message: 'wrapped',
      }),
    ).toBe(true);
    expect(
      PubkyService.isTypedSignInRestoreError({
        code: INTERRUPTED_SIGN_OUT_OWNER_MISSING_CODE,
        message: 'wrapped',
      }),
    ).toBe(true);
    expect(
      PubkyService.isTypedSignInRestoreError(new Error(INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE)),
    ).toBe(true);
    expect(
      PubkyService.isTypedSignInRestoreError(new Error(INTERRUPTED_SIGN_OUT_OWNER_MISSING)),
    ).toBe(true);
  });

  it('treats untyped fail-closed rejections as hatch-steering', () => {
    expect(PubkyService.isTypedSignInRestoreError(new Error('sqlite disk I/O error'))).toBe(false);
    expect(PubkyService.isTypedSignInRestoreError({ message: 'sealed' })).toBe(false);
  });
});
