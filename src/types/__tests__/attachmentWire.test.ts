import { ATTACHMENT_MAX_BYTES } from '../../flags/config';
import { LINK_MESSAGE_MAX_BYTES } from '../link';
import {
  ATTACHMENT_ALGORITHM,
  CHAT_ATTACHMENT_KIND,
  AttachmentError,
  attachmentKeyRef,
  buildAttachmentEnvelope,
  buildAttachmentLocation,
  buildAttachmentThumbLocation,
  decodeAttachmentEnvelope,
  isAttachmentKind,
  isImageContentType,
  serializedEnvelopeBytes,
} from '../attachment';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const ATTACHMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SENT_AT = 1_700_000_000_000;
const OWNER = 'a'.repeat(52);
const KEY_B64URL = 'A'.repeat(43);
const NONCE_B64URL = 'B'.repeat(32);

function representativeInput(
  overrides: Partial<Parameters<typeof buildAttachmentEnvelope>[0]> = {},
) {
  return {
    eventId: EVENT_ID,
    sentAt: SENT_AT,
    location: buildAttachmentLocation(OWNER, ATTACHMENT_ID),
    key: KEY_B64URL,
    nonce: NONCE_B64URL,
    algorithm: ATTACHMENT_ALGORITHM,
    contentType: 'image/jpeg',
    size: 1_234_567,
    ...overrides,
  };
}

describe('attachment wire contracts', () => {
  it('locks the kind, algorithm, and v1 size cap', () => {
    expect(CHAT_ATTACHMENT_KIND).toBe('chat.attachment.v0');
    expect(ATTACHMENT_ALGORITHM).toBe('XChaCha20Poly1305');
    expect(ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(isAttachmentKind(CHAT_ATTACHMENT_KIND)).toBe(true);
    expect(isAttachmentKind('chat.message.v0')).toBe(false);
    expect(isImageContentType('image/png')).toBe(true);
    expect(isImageContentType('application/pdf')).toBe(false);
  });

  it('binds location to the canonical homeserver path used as AEAD AAD', () => {
    const location = buildAttachmentLocation(OWNER, ATTACHMENT_ID);
    expect(location).toBe(`pubky://${OWNER}/pub/hypercolor.app/v1/attachments/${ATTACHMENT_ID}`);
    expect(buildAttachmentThumbLocation(OWNER, ATTACHMENT_ID)).toBe(`${location}.thumb`);
    expect(attachmentKeyRef(OWNER, EVENT_ID)).toBe(`att:${OWNER}:${EVENT_ID}`);
  });

  it('builds a representative chat.attachment.v0 envelope within the 1000-byte link budget', () => {
    const thumb = {
      location: buildAttachmentThumbLocation(OWNER, ATTACHMENT_ID),
      key: 'C'.repeat(43),
      nonce: 'D'.repeat(32),
    };
    const { envelope, json, byteSize, thumbnailIncluded } = buildAttachmentEnvelope(
      representativeInput({ thumbnail: thumb }),
    );

    expect(envelope.kind).toBe(CHAT_ATTACHMENT_KIND);
    expect(envelope.version).toBe(1);
    expect(envelope.location).toBe(buildAttachmentLocation(OWNER, ATTACHMENT_ID));
    expect(envelope.key).toHaveLength(43);
    expect(envelope.nonce).toHaveLength(32);
    expect(thumbnailIncluded).toBe(true);
    expect(envelope.thumbnail).toEqual(thumb);
    expect(byteSize).toBeLessThanOrEqual(LINK_MESSAGE_MAX_BYTES);
    expect(serializedEnvelopeBytes(envelope)).toBe(byteSize);
    expect(decodeAttachmentEnvelope(json)).toEqual(envelope);
  });

  it('drops the thumbnail when it would push the envelope over 1000 bytes', () => {
    const longType = `application/x-test+${'z'.repeat(400)}`;
    const thumb = {
      location: buildAttachmentThumbLocation(OWNER, ATTACHMENT_ID),
      key: 'C'.repeat(43),
      nonce: 'D'.repeat(32),
    };
    const { envelope, byteSize, thumbnailIncluded } = buildAttachmentEnvelope(
      representativeInput({ contentType: longType, thumbnail: thumb, channelId: EVENT_ID }),
    );

    expect(thumbnailIncluded).toBe(false);
    expect(envelope.thumbnail).toBeUndefined();
    expect(envelope.channel_id).toBe(EVENT_ID);
    expect(byteSize).toBeLessThanOrEqual(LINK_MESSAGE_MAX_BYTES);
    expect(serializedEnvelopeBytes({ ...envelope, thumbnail: thumb })).toBeGreaterThan(
      LINK_MESSAGE_MAX_BYTES,
    );
  });

  it('throws when the envelope exceeds the budget even without a thumbnail', () => {
    expect(() =>
      buildAttachmentEnvelope(
        representativeInput({ contentType: `application/x-test+${'z'.repeat(900)}` }),
      ),
    ).toThrow(/too long/);
  });

  it('rejects malformed access messages on decode', () => {
    expect(decodeAttachmentEnvelope('not-json')).toBeNull();
    expect(decodeAttachmentEnvelope(JSON.stringify({ kind: 'other.v0' }))).toBeNull();
    const valid = buildAttachmentEnvelope(representativeInput()).envelope;
    expect(
      decodeAttachmentEnvelope(JSON.stringify({ ...valid, kind: 'chat.message.v0' })),
    ).toBeNull();
    expect(
      decodeAttachmentEnvelope(JSON.stringify({ ...valid, event_id: 'not-a-uuid' })),
    ).toBeNull();
    expect(decodeAttachmentEnvelope(JSON.stringify({ ...valid, size: 0 }))).toBeNull();
  });

  it('exposes typed AttachmentError codes', () => {
    const err = new AttachmentError('too-large', 'too big');
    expect(err.code).toBe('too-large');
    expect(err.name).toBe('AttachmentError');
  });
});
