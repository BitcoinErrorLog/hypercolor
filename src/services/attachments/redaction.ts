import { KeyStore } from '../KeyStore';
import {
  AttachmentError,
  ATTACHMENT_KEY_PLACEHOLDER,
  decodePersistedAttachmentEnvelope,
  parseAttachmentKeyRef,
  type ChatAttachmentEnvelope,
} from '../../types/attachment';

/**
 * Rebuilds the real `chat.attachment.v0` wire JSON from a persisted
 * redacted copy plus KeyStore material. Retry/send paths must call this
 * immediately before native send — they must never persist the result.
 */
export async function reconstructAttachmentWireJson(
  redactedRawJson: string,
  keyRef: string,
  binding?: { peerPubky: string; conversationId: string },
): Promise<string> {
  const parsed = parseAttachmentKeyRef(keyRef);
  if (!parsed) {
    throw new AttachmentError('not-found', 'Invalid attachment keyRef');
  }
  const envelope = decodePersistedAttachmentEnvelope(redactedRawJson);
  if (!envelope) {
    throw new AttachmentError('validation', 'Cannot reconstruct attachment wire JSON');
  }
  const secret = await KeyStore.getAttachmentSecret(
    parsed.ownerPubky,
    parsed.senderPubky,
    parsed.eventId,
    binding,
  );
  if (!secret) {
    throw new AttachmentError('not-found', 'Attachment key material is not in KeyStore');
  }
  const live: ChatAttachmentEnvelope = {
    ...envelope,
    key: secret.key,
    nonce: secret.nonce,
    algorithm: secret.algorithm || envelope.algorithm,
  };
  if (envelope.thumbnail) {
    if (!secret.thumbnail) {
      throw new AttachmentError('not-found', 'Thumbnail key material is not in KeyStore');
    }
    live.thumbnail = {
      ...envelope.thumbnail,
      key: secret.thumbnail.key,
      nonce: secret.thumbnail.nonce,
    };
  }
  return JSON.stringify(live);
}

export function attachmentRawJsonHasLiveSecrets(
  rawJson: string,
  secrets: readonly string[],
): boolean {
  return secrets.some(
    value => value.length > 0 && value !== ATTACHMENT_KEY_PLACEHOLDER && rawJson.includes(value),
  );
}
