import { hasWatchedDuplicateKeys, scanWatchedDuplicateKeys } from '../jsonDuplicateKeys';

describe('watched duplicate-key scan', () => {
  it('rejects duplicate security-relevant keys in root, request, proof, and amount', () => {
    expect(
      hasWatchedDuplicateKeys('{"kind":"paykit.payment_request","kind":"paykit.payment_proof"}'),
    ).toBe(true);
    expect(
      hasWatchedDuplicateKeys('{"request":{"amount":{"value":"1","value":"9","asset":"btc"}}}'),
    ).toBe(true);
    expect(hasWatchedDuplicateKeys('{"proof":{"type":"a","type":"b"}}')).toBe(true);
    expect(
      hasWatchedDuplicateKeys(
        '{"payment_endpoints":{"btc-lightning-bolt11":"a","btc-lightning-bolt11":"b"}}',
      ),
    ).toBe(true);
  });

  it('does not scan metadata and fail-opens when it cannot tokenize', () => {
    expect(hasWatchedDuplicateKeys('{"metadata":{"note":"a","note":"b"},"kind":"x"}')).toBe(false);
    const failed = scanWatchedDuplicateKeys('{not-json');
    expect(failed.scanned).toBe(false);
    expect(failed.hasDuplicate).toBe(false);
  });
});
