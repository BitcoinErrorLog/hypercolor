const mockBags = new Map<string, Map<string, string>>();

jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn(({ id }: { id: string }) => {
    let data = mockBags.get(id);
    if (!data) {
      data = new Map();
      mockBags.set(id, data);
    }
    return {
      set: (key: string, value: string) => {
        data.set(key, value);
      },
      getString: (key: string) => data.get(key),
      remove: (key: string) => {
        data.delete(key);
      },
    };
  }),
}));

import {
  DEFERRED_PUBLIC_JOIN_TTL_MS,
  bindDeferredPublicJoinToOwner,
  clearDeferredPublicJoin,
  consumeDeferredPublicJoinRedirect,
  dismissDeferredPublicJoin,
  forgetDeferredPublicJoinMemoryForTests,
  peekDeferredPublicInvite,
  peekDeferredPublicJoin,
  resetDeferredPublicJoinForTests,
  setDeferredPublicJoin,
  takeDeferredPublicJoin,
} from '../deferredPublicJoin';

const OWNER_A = 'a'.repeat(52);
const OWNER_B = 'b'.repeat(52);
const REF = `hypercolor://join-public?channel=11111111-1111-4111-8111-111111111111&host=${'h'.repeat(52)}`;
const REF_B = `hypercolor://join-public?channel=22222222-2222-4222-8222-222222222222&host=${'h'.repeat(52)}`;

describe('deferredPublicJoin', () => {
  beforeEach(() => {
    mockBags.clear();
    resetDeferredPublicJoinForTests();
    jest.restoreAllMocks();
  });

  it('stores, peeks, and consumes a pending public join for an owner', () => {
    setDeferredPublicJoin(REF, OWNER_A);
    expect(peekDeferredPublicJoin(OWNER_A)).toBe(REF);
    expect(takeDeferredPublicJoin(OWNER_A)).toBe(REF);
    expect(peekDeferredPublicJoin(OWNER_A)).toBeNull();
    expect(takeDeferredPublicJoin(OWNER_A)).toBeNull();
  });

  it('rehydrates the pending join after a simulated restart', () => {
    setDeferredPublicJoin(REF, OWNER_A);
    forgetDeferredPublicJoinMemoryForTests();
    expect(peekDeferredPublicJoin(OWNER_A)).toBe(REF);
  });

  it('never fires owner A’s ref under owner B', () => {
    setDeferredPublicJoin(REF, OWNER_A);
    expect(peekDeferredPublicJoin(OWNER_B)).toBeNull();
    expect(peekDeferredPublicInvite(OWNER_B)).toBeNull();
    expect(consumeDeferredPublicJoinRedirect(OWNER_B)).toBe(false);
    expect(takeDeferredPublicJoin(OWNER_B)).toBeNull();
    expect(peekDeferredPublicJoin(OWNER_A)).toBe(REF);
  });

  it('holds an unsigned tap in memory and does not persist it under the next owner', () => {
    setDeferredPublicJoin(REF);
    expect(peekDeferredPublicJoin()).toBe(REF);
    forgetDeferredPublicJoinMemoryForTests();
    expect(peekDeferredPublicJoin()).toBeNull();

    resetDeferredPublicJoinForTests();
    mockBags.clear();
    setDeferredPublicJoin(REF);
    bindDeferredPublicJoinToOwner(OWNER_A);
    expect(peekDeferredPublicInvite(OWNER_A)).toBe(REF);
    expect(consumeDeferredPublicJoinRedirect(OWNER_A)).toBe(false);
    forgetDeferredPublicJoinMemoryForTests();
    expect(peekDeferredPublicJoin(OWNER_A)).toBeNull();
    expect(peekDeferredPublicInvite(OWNER_A)).toBeNull();
  });

  it('clears the owner record on sign-out', () => {
    setDeferredPublicJoin(REF, OWNER_A);
    setDeferredPublicJoin(REF_B, OWNER_B);
    clearDeferredPublicJoin(OWNER_A);
    expect(peekDeferredPublicJoin(OWNER_A)).toBeNull();
    expect(peekDeferredPublicJoin(OWNER_B)).toBe(REF_B);
  });

  it('discards an expired ref', () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    setDeferredPublicJoin(REF, OWNER_A);
    jest.spyOn(Date, 'now').mockReturnValue(now + DEFERRED_PUBLIC_JOIN_TTL_MS + 1);
    expect(peekDeferredPublicJoin(OWNER_A)).toBeNull();
    expect(peekDeferredPublicInvite(OWNER_A)).toBeNull();
  });

  it('redirects at most once per stored ref', () => {
    setDeferredPublicJoin(REF, OWNER_A);
    expect(consumeDeferredPublicJoinRedirect(OWNER_A)).toBe(true);
    expect(consumeDeferredPublicJoinRedirect(OWNER_A)).toBe(false);
    forgetDeferredPublicJoinMemoryForTests();
    expect(consumeDeferredPublicJoinRedirect(OWNER_A)).toBe(false);
    expect(peekDeferredPublicInvite(OWNER_A)).toBe(REF);
  });

  it('persists dismissal across restart', () => {
    setDeferredPublicJoin(REF, OWNER_A);
    consumeDeferredPublicJoinRedirect(OWNER_A);
    dismissDeferredPublicJoin(OWNER_A);
    expect(peekDeferredPublicInvite(OWNER_A)).toBeNull();
    forgetDeferredPublicJoinMemoryForTests();
    expect(peekDeferredPublicInvite(OWNER_A)).toBeNull();
    expect(consumeDeferredPublicJoinRedirect(OWNER_A)).toBe(false);
  });

  it('discards an invite when the clock jumps backward', () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    setDeferredPublicJoin(REF, OWNER_A);
    jest.spyOn(Date, 'now').mockReturnValue(now - 1);
    expect(peekDeferredPublicJoin(OWNER_A)).toBeNull();
    expect(peekDeferredPublicInvite(OWNER_A)).toBeNull();
  });

  it('lets Join consume an unsigned invite after auth without persisting it first', () => {
    setDeferredPublicJoin(REF);
    bindDeferredPublicJoinToOwner(OWNER_A);
    expect(peekDeferredPublicInvite(OWNER_A)).toBe(REF);
    expect(takeDeferredPublicJoin(OWNER_A)).toBe(REF);
    expect(peekDeferredPublicInvite(OWNER_A)).toBeNull();
    forgetDeferredPublicJoinMemoryForTests();
    expect(peekDeferredPublicInvite(OWNER_A)).toBeNull();
  });
});
