import { isVerifiedHashUniqueError } from '../verifiedHashUniqueError';

function uniqueError(message: string, code?: string): Error & { code?: string } {
  const err = new Error(message) as Error & { code?: string };
  if (code) err.code = code;
  return err;
}

describe('isVerifiedHashUniqueError', () => {
  it('matches the current index-name and two-column SQLite forms', () => {
    expect(
      isVerifiedHashUniqueError(
        uniqueError('UNIQUE constraint failed: idx_payment_requests_owner_verified_hash'),
      ),
    ).toBe(true);
    expect(
      isVerifiedHashUniqueError(
        uniqueError(
          'UNIQUE constraint failed: payment_requests.owner_pubky, payment_requests.displayed_payment_hash',
        ),
      ),
    ).toBe(true);
    expect(
      isVerifiedHashUniqueError(uniqueError('constraint failed', 'SQLITE_CONSTRAINT_UNIQUE')),
    ).toBe(false);
  });

  it('does not treat an unrelated UNIQUE violation as verified-hash replay', () => {
    expect(
      isVerifiedHashUniqueError(uniqueError('UNIQUE constraint failed: payment_requests.reason')),
    ).toBe(false);
    expect(
      isVerifiedHashUniqueError(
        uniqueError(
          'UNIQUE constraint failed: payment_requests.owner_pubky, payment_requests.peer_pubky, payment_requests.payment_request_id',
        ),
      ),
    ).toBe(false);
    expect(
      isVerifiedHashUniqueError(
        uniqueError(
          'UNIQUE constraint failed: payment_requests.owner_pubky, payment_requests.displayed_payment_hash, payment_requests.peer_pubky',
        ),
      ),
    ).toBe(false);
  });
});
