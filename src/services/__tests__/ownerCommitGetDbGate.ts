/** Test-only gate for stalling `getDb` in owner-commit integration tests. */
export const ownerCommitGetDbGate: { current: (() => Promise<void>) | null } = {
  current: null,
};
