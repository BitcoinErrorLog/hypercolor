/**
 * In-memory sign-out-incomplete marker for suites that mock KeyStore /
 * StorageService. Production persist+verify reads these back before wipe.
 */
export function wireSignOutMarkerMocks(
  keyStore: {
    markSignOutIncomplete: jest.Mock;
    isSignOutIncomplete: jest.Mock;
    getSignOutIncompleteOwner: jest.Mock;
    clearSignOutIncomplete: jest.Mock;
  },
  storage?: {
    persistSignOutIncompleteJournal: jest.Mock;
    getSignOutIncompleteJournalOwner: jest.Mock;
    hasSignOutIncompleteJournal: jest.Mock;
    clearSignOutIncompleteJournal: jest.Mock;
  },
): void {
  let mmkvOwner: string | null = null;
  let journalOwner: string | null = null;
  keyStore.markSignOutIncomplete.mockImplementation((owner: string) => {
    mmkvOwner = owner;
  });
  keyStore.isSignOutIncomplete.mockImplementation(
    () => typeof mmkvOwner === 'string' && mmkvOwner.length > 0,
  );
  keyStore.getSignOutIncompleteOwner.mockImplementation(() => mmkvOwner);
  keyStore.clearSignOutIncomplete.mockImplementation(() => {
    mmkvOwner = null;
  });
  if (!storage) return;
  storage.persistSignOutIncompleteJournal.mockImplementation(async (owner: string) => {
    journalOwner = owner;
  });
  storage.getSignOutIncompleteJournalOwner.mockImplementation(async () => journalOwner);
  storage.hasSignOutIncompleteJournal.mockImplementation(async () => journalOwner != null);
  storage.clearSignOutIncompleteJournal.mockImplementation(async () => {
    journalOwner = null;
  });
}
