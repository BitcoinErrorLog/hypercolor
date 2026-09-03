jest.mock('../KeyStore', () => ({
  KeyStore: {
    getPubky: jest.fn(() => null),
  },
}));

import {
  claimWipeInFlight,
  pendingWipeInFlight,
  resetPaintedOwnerModuleForTests,
  waitForWipeInFlight,
  WipeWaitTimeoutError,
  WIPE_WAIT_TIMEOUT_MS,
} from '../paintedOwner';

describe('wipe gate', () => {
  beforeEach(() => {
    resetPaintedOwnerModuleForTests();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('claimWipeInFlight assigns the gate synchronously before any await', () => {
    expect(pendingWipeInFlight()).toBeNull();
    const release = claimWipeInFlight();
    expect(pendingWipeInFlight()).not.toBeNull();
    release();
    expect(pendingWipeInFlight()).toBeNull();
  });

  it('waitForWipeInFlight rejects retryable on timeout without clearing the gate', async () => {
    const release = claimWipeInFlight();
    const pendingPromise = waitForWipeInFlight();
    const expectation = expect(pendingPromise).rejects.toBeInstanceOf(WipeWaitTimeoutError);
    await jest.advanceTimersByTimeAsync(WIPE_WAIT_TIMEOUT_MS);
    await expectation;
    expect(pendingWipeInFlight()).not.toBeNull();
    release();
    await expect(waitForWipeInFlight()).resolves.toBeUndefined();
  });
});
