import { COPY } from '../../copy/uxCopy';
import { LinkSendError } from '../../services/link/LinkSendError';
import { CONTACTS_COPY } from '../contacts/contactsCopy';
import { classifyError, sanitizeError, stripSensitive } from '../sanitizedError';

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

  it('maps a denied send to the blocked-contact contract copy', () => {
    const err = new LinkSendError('denied', CONTACTS_COPY.deniedSendMessage);
    const sanitized = sanitizeError(err);
    expect(sanitized.category).toBe('blocked-send');
    expect(sanitized.message).toBe(CONTACTS_COPY.deniedSendMessage);
    expect(sanitized.details).toBeNull();
  });

  it('does not surface owner-changed, deny-unavailable, or not-sendable internals', () => {
    for (const code of ['owner-changed', 'deny-unavailable', 'not-sendable'] as const) {
      const sanitized = sanitizeError(
        new LinkSendError(code, `LinkService.sendDm ${code} ${SAMPLE_PUBKY}`),
        CONTACTS_COPY.couldNotSendMessage,
      );
      expect(sanitized.category).toBe('unknown');
      expect(sanitized.message).toBe(CONTACTS_COPY.couldNotSendMessage);
      expect(sanitized.details).toBeNull();
    }
  });

  it('never surfaces an internal sendDm template or a raw pubky', () => {
    const err = new Error(
      `LinkService.sendDm: cannot send to ${SAMPLE_PUBKY} — link status is 'queued'`,
    );
    const sanitized = sanitizeError(err, CONTACTS_COPY.couldNotSendMessage);
    expect(sanitized.category).toBe('unknown');
    expect(sanitized.message).toBe(CONTACTS_COPY.couldNotSendMessage);
    expect(sanitized.message).not.toContain('LinkService.sendDm');
    expect(sanitized.message).not.toContain(SAMPLE_PUBKY);
    expect(sanitized.details).not.toContain(SAMPLE_PUBKY);
    expect(sanitized.details).toContain('[pubky]');
  });
});

describe('stripSensitive', () => {
  it('redacts bare hosts, query secrets, request ids, capabilities, and auth payload keys', () => {
    const raw =
      'homeserver.staging.pubky.app refused secret=abc token=def session=ghi code=jkl ' +
      'request_id=req-handoff-1 /pub/paykit/:rw ephemeralPk=aabb caps=/pub/hypercolor.app/v1/:rw ' +
      'paykit-connect=pubkyring://x';
    const stripped = stripSensitive(raw);
    expect(stripped).not.toMatch(/homeserver\.staging\.pubky\.app/);
    expect(stripped).toContain('[host]');
    expect(stripped).not.toContain('secret=abc');
    expect(stripped).not.toContain('token=def');
    expect(stripped).not.toContain('session=ghi');
    expect(stripped).not.toContain('code=jkl');
    expect(stripped).toContain('[redacted]');
    expect(stripped).not.toContain('req-handoff-1');
    expect(stripped).toContain('request_id=[redacted]');
    expect(stripped).not.toContain('/pub/paykit/:rw');
    expect(stripped).toContain('[capability]');
    expect(stripped).not.toContain('ephemeralPk=aabb');
    expect(stripped).toContain('[auth]');
  });
});
