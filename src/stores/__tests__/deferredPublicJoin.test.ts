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
  forgetDeferredPublicJoinMemoryForTests,
  peekDeferredPublicJoin,
  resetDeferredPublicJoinForTests,
  setDeferredPublicJoin,
  takeDeferredPublicJoin,
} from '../deferredPublicJoin';

const REF = `hypercolor://join-public?channel=11111111-1111-4111-8111-111111111111&host=${'h'.repeat(52)}`;

describe('deferredPublicJoin', () => {
  beforeEach(() => {
    mockBags.clear();
    resetDeferredPublicJoinForTests();
  });

  it('stores, peeks, and consumes a pending public join', () => {
    setDeferredPublicJoin(REF);
    expect(peekDeferredPublicJoin()).toBe(REF);
    expect(takeDeferredPublicJoin()).toBe(REF);
    expect(peekDeferredPublicJoin()).toBeNull();
    expect(takeDeferredPublicJoin()).toBeNull();
  });

  it('rehydrates the pending join after a simulated restart', () => {
    setDeferredPublicJoin(REF);
    forgetDeferredPublicJoinMemoryForTests();
    expect(peekDeferredPublicJoin()).toBe(REF);
  });
});
