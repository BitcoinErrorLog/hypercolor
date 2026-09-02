import { COPY } from '../../copy/uxCopy';
import { classifyError, sanitizeError } from '../sanitizedError';

const SAMPLE_PUBKY = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';

describe('sanitizeError', () => {
  it('maps allowlisted categories to canonical copy', () => {
    expect(sanitizeError(new Error('network request failed')).category).toBe('network');
    expect(sanitizeError(new Error('you are offline')).category).toBe('offline');
    expect(sanitizeError(new Error('ring denied')).category).toBe('denied');
    expect(sanitizeError(new Error('authorization expired')).category).toBe('expired');
    expect(
      sanitizeError(new Error('Invalid callback URL — missing required params.')).category,
    ).toBe('invalid-callback');
    expect(sanitizeError(new Error('Handoff not found.')).category).toBe('handoff');
    expect(sanitizeError(new Error('Handoff SB2 signature verification failed')).category).toBe(
      'verification',
    );
  });

  it('never surfaces raw Error.message, callback URLs, or full pubkys', () => {
    const err = new Error(
      `Failed hypercolor://ring-callback?pubky=${SAMPLE_PUBKY}&secret=leak https://evil.example/x`,
    );
    const sanitized = sanitizeError(err);
    expect(sanitized.message).toBe(COPY.couldNotStartAuthorization);
    expect(sanitized.message).not.toContain('hypercolor://');
    expect(sanitized.message).not.toContain('https://');
    expect(sanitized.details).not.toContain('hypercolor://');
    expect(sanitized.details).not.toContain('https://evil.example');
    expect(sanitized.details).not.toContain(SAMPLE_PUBKY);
    expect(classifyError(err)).toBe('unknown');
  });
});
