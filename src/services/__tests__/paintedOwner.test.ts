jest.mock('../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(() => null),
  },
}));

import {
  paintOwner,
  pendingWipeInFlight,
  registerOnOwnerPainted,
  resetPaintedOwnerModuleForTests,
  trackWipeInFlight,
  waitForWipeInFlight,
  WIPE_WAIT_TIMEOUT_MS,
} from '../paintedOwner';

const OWNER = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';

describe('paintedOwner wipe wait and drain hook', () => {
  afterEach(() => {
    registerOnOwnerPainted(null);
    resetPaintedOwnerModuleForTests();
    jest.useRealTimers();
  });

  it('rejects waitForWipeInFlight after 30s without clearing the in-flight gate', async () => {
    jest.useFakeTimers();
    const hung = new Promise<void>(() => undefined);
    void trackWipeInFlight(hung);
    const pending = waitForWipeInFlight();
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'WipeWaitTimeoutError',
      code: 'wipe-wait-timeout',
      retryable: true,
    });
    await jest.advanceTimersByTimeAsync(WIPE_WAIT_TIMEOUT_MS);
    await assertion;
    expect(pendingWipeInFlight()).not.toBeNull();
  });

  it('starts the owner-painted listener after a successful paintOwner', () => {
    const listener = jest.fn();
    registerOnOwnerPainted(listener);
    paintOwner(OWNER);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
