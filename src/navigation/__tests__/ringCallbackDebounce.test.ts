import {
  completeRingCallbackRequestId,
  consumeRingCallbackRequestId,
  resetRingCallbackDebounceForTests,
  ringCallbackRequestIdFromUrl,
} from '../ringCallbackDebounce';

describe('ringCallbackDebounce', () => {
  beforeEach(() => {
    resetRingCallbackDebounceForTests();
  });

  it('extracts request_id with the hand-rolled query parser', () => {
    expect(
      ringCallbackRequestIdFromUrl(
        'hypercolor://ring-callback?pubky=abc&request_id=req-1&mode=secure_handoff%2Bpubkyauth',
      ),
    ).toBe('req-1');
  });

  it('admits the first callback and drops a duplicate request_id inside the window', () => {
    const now = 1_700_000_000_000;
    expect(consumeRingCallbackRequestId('req-1', now)).toBe(true);
    expect(consumeRingCallbackRequestId('req-1', now + 1_000)).toBe(false);
    completeRingCallbackRequestId('req-1', true, now);
    expect(consumeRingCallbackRequestId('req-1', now + 1_000)).toBe(false);
    expect(consumeRingCallbackRequestId('req-2', now + 1_000)).toBe(true);
    expect(consumeRingCallbackRequestId('req-1', now + 31_000)).toBe(true);
  });

  it('retries the same request_id after a failed handler and debounce after success', () => {
    const now = 1_700_000_000_000;
    expect(consumeRingCallbackRequestId('req-1', now)).toBe(true);
    completeRingCallbackRequestId('req-1', false, now);
    expect(consumeRingCallbackRequestId('req-1', now + 1_000)).toBe(true);
    completeRingCallbackRequestId('req-1', true, now + 1_000);
    expect(consumeRingCallbackRequestId('req-1', now + 2_000)).toBe(false);
  });

  it('debounces a second in-flight consume of the same request_id', () => {
    const now = 1_700_000_000_000;
    expect(consumeRingCallbackRequestId('req-1', now)).toBe(true);
    expect(consumeRingCallbackRequestId('req-1', now)).toBe(false);
    completeRingCallbackRequestId('req-1', false, now);
    expect(consumeRingCallbackRequestId('req-1', now)).toBe(true);
  });
});
