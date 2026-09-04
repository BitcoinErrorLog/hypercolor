jest.mock('../../db', () => ({
  closeAndDeleteSqliteDatabase: jest.fn(),
}));

jest.mock('../link/PaykitLinkNative', () => ({
  PaykitLinkNative: {
    signOutSession: jest.fn(),
    clearAllNativeSecrets: jest.fn(),
  },
}));

const mockIsSignOutIncomplete = jest.fn();
const mockGetSignOutIncompleteOwner = jest.fn();
const mockGetSignOutIncompleteAlias = jest.fn();
const mockGetSignOutWipeFailureCount = jest.fn();
const mockSetSignOutWipeFailureCount = jest.fn();
const mockGetPubky = jest.fn();
const mockClearSignOutIncomplete = jest.fn();
const mockClearSignOutWipeFailures = jest.fn();
const mockClearIfPubky = jest.fn();

jest.mock('../KeyStore', () => ({
  KeyStore: {
    isSignOutIncomplete: (...args: unknown[]) => mockIsSignOutIncomplete(...args),
    getSignOutIncompleteOwner: (...args: unknown[]) => mockGetSignOutIncompleteOwner(...args),
    getSignOutIncompleteAlias: (...args: unknown[]) => mockGetSignOutIncompleteAlias(...args),
    getSignOutWipeFailureCount: (...args: unknown[]) => mockGetSignOutWipeFailureCount(...args),
    setSignOutWipeFailureCount: (...args: unknown[]) => mockSetSignOutWipeFailureCount(...args),
    getPubky: (...args: unknown[]) => mockGetPubky(...args),
    clearSignOutIncomplete: (...args: unknown[]) => mockClearSignOutIncomplete(...args),
    clearSignOutWipeFailures: (...args: unknown[]) => mockClearSignOutWipeFailures(...args),
    clearIfPubky: (...args: unknown[]) => mockClearIfPubky(...args),
  },
}));

const mockHasSignOutIncompleteJournal = jest.fn();
const mockGetSignOutWipeFailureCountSql = jest.fn();
const mockPersistSignOutWipeFailureCount = jest.fn();
const mockGetSignOutIncompleteJournalOwner = jest.fn();
const mockGetSignOutIncompleteJournalAlias = jest.fn();

jest.mock('../StorageService', () => ({
  StorageService: {
    hasSignOutIncompleteJournal: (...args: unknown[]) => mockHasSignOutIncompleteJournal(...args),
    getSignOutWipeFailureCount: (...args: unknown[]) => mockGetSignOutWipeFailureCountSql(...args),
    persistSignOutWipeFailureCount: (...args: unknown[]) =>
      mockPersistSignOutWipeFailureCount(...args),
    getSignOutIncompleteJournalOwner: (...args: unknown[]) =>
      mockGetSignOutIncompleteJournalOwner(...args),
    getSignOutIncompleteJournalAlias: (...args: unknown[]) =>
      mockGetSignOutIncompleteJournalAlias(...args),
  },
}));

import { closeAndDeleteSqliteDatabase } from '../../db';
import { PaykitLinkNative } from '../link/PaykitLinkNative';
import { claimWipeInFlight, paintOwner, resetPaintedOwnerModuleForTests } from '../paintedOwner';
import {
  BOOT_WIPE_FAILURES_BEFORE_RESET,
  recordBootWipeFailure,
  resetAppDataAfterFailedWipe,
  shouldOfferResetAfterFailedWipe,
  UNKNOWN_MARKER_OWNER,
} from '../resetAfterFailedWipe';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const OTHER = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';

describe('resetAfterFailedWipe unreadable-marker counting', () => {
  let journalCounts: Record<string, number>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetPaintedOwnerModuleForTests();
    journalCounts = {};
    mockIsSignOutIncomplete.mockImplementation(() => {
      throw new Error('mmkv sealed');
    });
    mockGetSignOutIncompleteOwner.mockImplementation(() => {
      throw new Error('mmkv sealed');
    });
    mockGetSignOutWipeFailureCount.mockReturnValue(0);
    mockSetSignOutWipeFailureCount.mockImplementation(() => {
      throw new Error('not a valid pubky');
    });
    mockGetSignOutWipeFailureCountSql.mockImplementation(async (owner: string) => {
      return journalCounts[owner] ?? 0;
    });
    mockPersistSignOutWipeFailureCount.mockImplementation(async (owner: string, count: number) => {
      journalCounts[owner] = count;
    });
    mockGetPubky.mockReturnValue(null);
  });

  it('does not offer reset after fewer than the threshold unreadable boots', async () => {
    for (let i = 0; i < BOOT_WIPE_FAILURES_BEFORE_RESET - 1; i += 1) {
      await recordBootWipeFailure();
    }
    await expect(shouldOfferResetAfterFailedWipe()).resolves.toBe(false);
    expect(journalCounts[UNKNOWN_MARKER_OWNER]).toBe(BOOT_WIPE_FAILURES_BEFORE_RESET - 1);
  });

  it('offers reset after N unreadable boots (hatch on boot N+1 / at threshold)', async () => {
    for (let i = 0; i < BOOT_WIPE_FAILURES_BEFORE_RESET; i += 1) {
      await recordBootWipeFailure();
    }
    await expect(shouldOfferResetAfterFailedWipe()).resolves.toBe(true);
    expect(journalCounts[UNKNOWN_MARKER_OWNER]).toBe(BOOT_WIPE_FAILURES_BEFORE_RESET);
  });
});

describe('resetAppDataAfterFailedWipe TOCTOU claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPaintedOwnerModuleForTests();
    mockIsSignOutIncomplete.mockReturnValue(true);
    mockGetSignOutIncompleteOwner.mockReturnValue(OWNER);
    mockGetSignOutIncompleteAlias.mockReturnValue(null);
    mockGetSignOutWipeFailureCount.mockReturnValue(BOOT_WIPE_FAILURES_BEFORE_RESET);
    mockGetSignOutWipeFailureCountSql.mockResolvedValue(BOOT_WIPE_FAILURES_BEFORE_RESET);
    mockHasSignOutIncompleteJournal.mockResolvedValue(true);
    mockGetSignOutIncompleteJournalOwner.mockResolvedValue(OWNER);
    mockGetPubky.mockReturnValue(OWNER);
    mockGetSignOutIncompleteJournalAlias.mockResolvedValue('alias-a');
    mockClearIfPubky.mockResolvedValue(true);
    jest.mocked(PaykitLinkNative.signOutSession).mockResolvedValue(undefined);
    jest.mocked(PaykitLinkNative.clearAllNativeSecrets).mockResolvedValue(undefined);
  });

  it('throws and deletes nothing when a foreign owner is painted after the first check', async () => {
    mockGetSignOutIncompleteJournalAlias.mockImplementation(async () => {
      paintOwner(OTHER);
      mockGetPubky.mockReturnValue(OTHER);
      return 'alias-a';
    });
    await expect(resetAppDataAfterFailedWipe()).rejects.toMatchObject({
      code: 'reset-app-data-failed',
    });
    expect(closeAndDeleteSqliteDatabase).not.toHaveBeenCalled();
    expect(PaykitLinkNative.signOutSession).not.toHaveBeenCalled();
    expect(PaykitLinkNative.clearAllNativeSecrets).not.toHaveBeenCalled();
    expect(mockClearIfPubky).not.toHaveBeenCalled();
  });

  it('fails immediately when a wipe is already in flight without waiting', async () => {
    const release = claimWipeInFlight();
    try {
      await expect(resetAppDataAfterFailedWipe()).rejects.toMatchObject({
        code: 'reset-app-data-failed',
      });
      expect(closeAndDeleteSqliteDatabase).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
});
