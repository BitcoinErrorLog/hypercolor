/**
 * In-memory sign-out-incomplete marker for suites that mock KeyStore /
 * StorageService. Production persist+verify reads these back before wipe.
 */
export function wireSignOutMarkerMocks(
  keyStore: {
    markSignOutIncomplete: jest.Mock;
    isSignOutIncomplete: jest.Mock;
    getSignOutIncompleteOwner: jest.Mock;
    markSignOutIncompleteAlias?: jest.Mock;
    getSignOutIncompleteAlias?: jest.Mock;
    clearSignOutIncomplete: jest.Mock;
    setSignOutWipeFailureCount?: jest.Mock;
    getSignOutWipeFailureCount?: jest.Mock;
    clearSignOutWipeFailures?: jest.Mock;
  },
  storage?: {
    persistSignOutIncompleteJournal: jest.Mock;
    getSignOutIncompleteJournalOwner: jest.Mock;
    getSignOutIncompleteJournalAlias?: jest.Mock;
    hasSignOutIncompleteJournal: jest.Mock;
    clearSignOutIncompleteJournal: jest.Mock;
    persistSignOutWipeFailureCount?: jest.Mock;
    getSignOutWipeFailureCount?: jest.Mock;
    clearSignOutWipeFailureCount?: jest.Mock;
  },
): void {
  let mmkvOwner: string | null = null;
  let mmkvAlias: string | null = null;
  let mmkvFailures: { owner: string; count: number } | null = null;
  let journalOwner: string | null = null;
  let journalAlias: string | null = null;
  let journalFailures: { owner: string; count: number } | null = null;
  keyStore.markSignOutIncomplete.mockImplementation((owner: string) => {
    mmkvOwner = owner;
  });
  keyStore.isSignOutIncomplete.mockImplementation(
    () => typeof mmkvOwner === 'string' && mmkvOwner.length > 0,
  );
  keyStore.getSignOutIncompleteOwner.mockImplementation(() => mmkvOwner);
  keyStore.clearSignOutIncomplete.mockImplementation(() => {
    mmkvOwner = null;
    mmkvAlias = null;
  });
  keyStore.markSignOutIncompleteAlias?.mockImplementation((alias: string) => {
    mmkvAlias = alias;
  });
  keyStore.getSignOutIncompleteAlias?.mockImplementation(() => mmkvAlias);
  keyStore.setSignOutWipeFailureCount?.mockImplementation((owner: string, count: number) => {
    mmkvFailures = { owner, count };
  });
  keyStore.getSignOutWipeFailureCount?.mockImplementation((owner: string) => {
    return mmkvFailures?.owner === owner ? mmkvFailures.count : 0;
  });
  keyStore.clearSignOutWipeFailures?.mockImplementation((owner: string) => {
    if (mmkvFailures?.owner === owner) mmkvFailures = null;
  });
  if (!storage) return;
  storage.persistSignOutIncompleteJournal.mockImplementation(
    async (owner: string, alias?: string | null) => {
      journalOwner = owner;
      journalAlias = typeof alias === 'string' && alias.length > 0 ? alias : null;
    },
  );
  storage.getSignOutIncompleteJournalOwner.mockImplementation(async (expected?: string) => {
    if (expected) return journalOwner === expected ? journalOwner : null;
    return journalOwner;
  });
  storage.getSignOutIncompleteJournalAlias?.mockImplementation(async (owner: string) => {
    return journalOwner === owner ? journalAlias : null;
  });
  storage.hasSignOutIncompleteJournal.mockImplementation(async () => journalOwner != null);
  storage.clearSignOutIncompleteJournal.mockImplementation(async () => {
    journalOwner = null;
    journalAlias = null;
  });
  storage.persistSignOutWipeFailureCount?.mockImplementation(
    async (owner: string, count: number) => {
      journalFailures = { owner, count };
    },
  );
  storage.getSignOutWipeFailureCount?.mockImplementation(async (owner: string) => {
    return journalFailures?.owner === owner ? journalFailures.count : 0;
  });
  storage.clearSignOutWipeFailureCount?.mockImplementation(async (owner: string) => {
    if (journalFailures?.owner === owner) journalFailures = null;
  });
}
