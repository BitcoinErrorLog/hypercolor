/**
 * Design ruling (M4 security review): per-attachment content keys MAY transit
 * JS memory transiently. The JS runtime already renders decrypted plaintext,
 * so keeping those short-lived keys out of JS adds no effective protection
 * against that adversary. They MUST NEVER be persisted anywhere except the
 * platform keychain (KeyStore). Long-term keys (Noise receiver secret,
 * homeserver bearer, device snapshot key) remain native-only.
 */
import { v4 as uuidv4 } from 'uuid';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  ATTACHMENT_CIPHERTEXT_MAX_CHARS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_THUMBNAIL_CIPHERTEXT_MAX_CHARS,
  ATTACHMENT_THUMBNAIL_MAX_BYTES,
} from '../../flags/config';
import type { PubkyKey } from '../../types';
import {
  ATTACHMENT_ALGORITHM,
  AttachmentError,
  attachmentKeyRef,
  buildAttachmentEnvelope,
  buildAttachmentLocation,
  buildAttachmentThumbLocation,
  CHAT_ATTACHMENT_KIND,
  decodeAttachmentEnvelope,
  isAttachmentLocationBoundToSender,
  isImageContentType,
  parseAttachmentLocation,
  type AttachmentRecord,
  type ChatAttachmentEnvelope,
} from '../../types/attachment';
import {
  buildDmConversationId,
  parseDmConversationId,
  type LinkDeliveryState,
} from '../../types/link';
import { attachmentKeyBinding } from './attachmentKeyBinding';
import { KeyStore } from '../KeyStore';
import { StorageService } from '../StorageService';
import { PubkyService } from '../PubkyService';
import { PaykitLinkNative, isLinkNativeError } from '../link/PaykitLinkNative';
import { LinkService } from '../link/LinkService';
import { GroupService } from '../group/GroupService';
import { attachmentPreviewBody } from './applyAttachmentInbound';
import {
  attachmentCachePath,
  attachmentThumbCachePath,
  cacheFileExists,
  decodedBase64Bytes,
  fromBase64Url,
  readFileAsStandardBase64,
  toBase64Url,
  writeFileFromStandardBase64,
} from './fileIo';

export type AttachmentSendTarget =
  | { type: 'conversation'; peerPubky: PubkyKey }
  | { type: 'channel'; channelId: string };

function attachmentDeliveryFromLink(state: LinkDeliveryState): AttachmentRecord['deliveryState'] {
  if (state === 'sending' || state === 'failed' || state === 'sent') return state;
  return 'delivered';
}

export const AttachmentService = {
  /**
   * Encrypt, upload, and send a `chat.attachment.v0` access PAM.
   * Rejects files larger than {@link ATTACHMENT_MAX_BYTES} (8 MiB).
   * Public channels are rejected — there is no Encrypted Link for the key.
   */
  async sendAttachment(
    target: AttachmentSendTarget,
    fileUri: string,
    contentType: string,
  ): Promise<AttachmentRecord> {
    const owner = requireOwner();
    const mime = contentType.trim();
    if (mime.length === 0) {
      throw new AttachmentError('validation', 'contentType is required');
    }
    if (!PaykitLinkNative.isAvailable()) {
      throw new AttachmentError('unavailable', 'PaykitLinkModule native module is not available');
    }

    if (target.type === 'channel') {
      const channel = await StorageService.getGroupChannel(owner, target.channelId);
      if (!channel) throw new AttachmentError('not-found', 'Channel not found');
      if (channel.isPublic) {
        throw new AttachmentError(
          'unsupported-target',
          'Encrypted attachments require a private Encrypted Link (DM or private group). Public channels cannot carry attachment keys privately.',
        );
      }
    }

    const { base64, size } = await readFileAsStandardBase64(fileUri);
    if (size > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentError(
        'too-large',
        `Attachment is ${size} bytes; v1 limit is ${ATTACHMENT_MAX_BYTES} bytes (8 MiB). Chunking for larger media is not implemented.`,
      );
    }

    const attachmentId = uuidv4();
    const eventId = uuidv4();
    const sentAt = Date.now();
    const location = buildAttachmentLocation(owner, attachmentId);
    const plaintextB64 = toBase64Url(base64);

    const key = await PaykitLinkNative.generateAttachmentKey();
    const sealed = await PaykitLinkNative.attachmentEncrypt(plaintextB64, key, location);
    await PubkyService.put(location, sealed.ciphertextB64);

    const thumbnail = isImageContentType(mime)
      ? await encryptAndUploadThumbnail(owner, attachmentId, fileUri)
      : null;

    // Custody: KeyStore first, then any JSON that might be persisted.
    const boundPeer = target.type === 'conversation' ? target.peerPubky : owner;
    const boundConversation =
      target.type === 'conversation' ? buildDmConversationId(target.peerPubky) : target.channelId;
    await KeyStore.setAttachmentSecret(
      owner,
      owner,
      eventId,
      {
        key,
        nonce: sealed.nonceB64,
        algorithm: sealed.algorithm || ATTACHMENT_ALGORITHM,
        ...(thumbnail ? { thumbnail: { key: thumbnail.key, nonce: thumbnail.nonce } } : {}),
      },
      { peerPubky: boundPeer, conversationId: boundConversation },
    );

    const built = buildAttachmentEnvelope({
      eventId,
      sentAt,
      location,
      key,
      nonce: sealed.nonceB64,
      algorithm: sealed.algorithm || ATTACHMENT_ALGORITHM,
      contentType: mime,
      size,
      ...(target.type === 'channel' ? { channelId: target.channelId } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    });

    const conversationId =
      target.type === 'conversation' ? buildDmConversationId(target.peerPubky) : null;
    const channelId = target.type === 'channel' ? target.channelId : null;
    const cachePath = attachmentCachePath(owner, owner, eventId);
    await writeFileFromStandardBase64(cachePath, base64);

    const record: AttachmentRecord = {
      ownerPubky: owner,
      eventId,
      conversationId,
      channelId,
      senderPubky: owner,
      direction: 'sent',
      location,
      keyRef: attachmentKeyRef(owner, owner, eventId),
      contentType: mime,
      size,
      thumbnailLocation: built.envelope.thumbnail?.location ?? null,
      localCachePath: cachePath,
      createdAt: sentAt,
      updatedAt: sentAt,
      deliveryState: 'sending',
      resolveState: 'ready',
    };
    await StorageService.saveAttachment(record);

    try {
      if (target.type === 'conversation') {
        const sent = await LinkService.sendPreparedMessage({
          peerPubky: target.peerPubky,
          kind: CHAT_ATTACHMENT_KIND,
          eventId,
          rawJson: built.json,
          body: attachmentPreviewBody(built.envelope),
          sentAt,
        });
        const deliveryState = attachmentDeliveryFromLink(sent.deliveryState);
        await StorageService.updateAttachmentDelivery(owner, owner, eventId, deliveryState);
        return { ...record, deliveryState, updatedAt: Date.now() };
      }
      const sent = await GroupService.sendPreparedFanout({
        channelId: target.channelId,
        kind: CHAT_ATTACHMENT_KIND,
        eventId,
        sentAt,
        body: attachmentPreviewBody(built.envelope),
        rawJson: built.json,
      });
      const deliveryState = attachmentDeliveryFromLink(sent.deliveryState);
      await StorageService.updateAttachmentDelivery(owner, owner, eventId, deliveryState);
      return { ...record, deliveryState, updatedAt: Date.now() };
    } catch (err) {
      await StorageService.updateAttachmentDelivery(owner, owner, eventId, 'failed');
      if (err instanceof AttachmentError) throw err;
      if (isLinkNativeError(err)) {
        throw new AttachmentError(
          err.code === 'unavailable' ? 'unavailable' : 'network',
          err.message,
        );
      }
      throw new AttachmentError('network', err instanceof Error ? err.message : String(err));
    }
  },

  async receiveAttachment(accessMessage: string | ChatAttachmentEnvelope): Promise<string> {
    const envelope =
      typeof accessMessage === 'string' ? decodeAttachmentEnvelope(accessMessage) : accessMessage;
    if (!envelope) {
      throw new AttachmentError('validation', 'Not a valid chat.attachment.v0 access message');
    }
    const owner = requireOwner();
    const parsed = parseAttachmentLocation(envelope.location);
    if (!parsed || !isAttachmentLocationBoundToSender(envelope.location, parsed.ownerPubky)) {
      throw new AttachmentError('validation', 'Attachment location is not sender-bound');
    }
    return AttachmentService.resolveAttachment(owner, parsed.ownerPubky, envelope.event_id);
  },

  /**
   * Download + decrypt + cache. Cached by (sender, event_id); does not
   * re-download when a local cache file already exists.
   */
  async resolveAttachment(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<string> {
    const row = await StorageService.getAttachment(ownerPubky, senderPubky, eventId);
    if (!row) {
      throw new AttachmentError('not-found', 'No attachment metadata for this event');
    }
    if (row.localCachePath && (await cacheFileExists(row.localCachePath))) {
      return row.localCachePath;
    }

    // Receive-side cap BEFORE any download: the declared size was validated
    // at envelope decode, so an over-limit row means tampered/legacy state —
    // refuse before touching the network.
    if (row.size > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentError(
        'too-large',
        `Attachment declares ${row.size} bytes; v1 limit is ${ATTACHMENT_MAX_BYTES} bytes (8 MiB)`,
      );
    }

    const secret = await KeyStore.getAttachmentSecret(
      ownerPubky,
      senderPubky,
      eventId,
      attachmentKeyBinding(row),
    );
    if (!secret) {
      throw new AttachmentError('not-found', 'Attachment key material is not in KeyStore');
    }

    await StorageService.updateAttachmentResolve(ownerPubky, senderPubky, eventId, {
      resolveState: 'resolving',
    });
    try {
      const ciphertext = await PubkyService.get(row.location);
      if (!ciphertext) {
        throw new AttachmentError(
          'network',
          'Attachment ciphertext was not found on the homeserver',
        );
      }
      if (ciphertext.length > ATTACHMENT_CIPHERTEXT_MAX_CHARS) {
        throw new AttachmentError(
          'too-large',
          `Attachment ciphertext exceeds the receive-side budget (${ciphertext.length} chars)`,
        );
      }
      const plaintextB64 = await PaykitLinkNative.attachmentDecrypt(
        ciphertext,
        secret.key,
        secret.nonce,
        row.location,
      );
      const decryptedBytes = decodedBase64Bytes(fromBase64Url(plaintextB64));
      if (decryptedBytes !== row.size) {
        throw new AttachmentError(
          'protocol',
          `Decrypted attachment is ${decryptedBytes} bytes; envelope claimed ${row.size}`,
        );
      }
      const cachePath = attachmentCachePath(ownerPubky, senderPubky, eventId);
      await writeFileFromStandardBase64(cachePath, fromBase64Url(plaintextB64));
      await StorageService.updateAttachmentResolve(ownerPubky, senderPubky, eventId, {
        resolveState: 'ready',
        localCachePath: cachePath,
      });
      return cachePath;
    } catch (err) {
      await StorageService.updateAttachmentResolve(ownerPubky, senderPubky, eventId, {
        resolveState: 'failed',
      });
      if (err instanceof AttachmentError) throw err;
      if (isLinkNativeError(err) && err.code === 'protocol') {
        throw new AttachmentError('decrypt-failed', err.message);
      }
      throw new AttachmentError('protocol', err instanceof Error ? err.message : String(err));
    }
  },

  async resolveThumbnail(
    ownerPubky: PubkyKey,
    senderPubky: PubkyKey,
    eventId: string,
  ): Promise<string | null> {
    const row = await StorageService.getAttachment(ownerPubky, senderPubky, eventId);
    if (!row?.thumbnailLocation) return null;
    const secret = await KeyStore.getAttachmentSecret(
      ownerPubky,
      senderPubky,
      eventId,
      attachmentKeyBinding(row),
    );
    if (!secret?.thumbnail) return null;
    const ciphertext = await PubkyService.get(row.thumbnailLocation);
    if (!ciphertext) return null;
    if (ciphertext.length > ATTACHMENT_THUMBNAIL_CIPHERTEXT_MAX_CHARS) {
      return null;
    }
    try {
      const plaintextB64 = await PaykitLinkNative.attachmentDecrypt(
        ciphertext,
        secret.thumbnail.key,
        secret.thumbnail.nonce,
        row.thumbnailLocation,
      );
      const decryptedBytes = decodedBase64Bytes(fromBase64Url(plaintextB64));
      if (decryptedBytes > ATTACHMENT_THUMBNAIL_MAX_BYTES) {
        return null;
      }
      const path = attachmentThumbCachePath(ownerPubky, senderPubky, eventId);
      await writeFileFromStandardBase64(path, fromBase64Url(plaintextB64));
      return path;
    } catch {
      return null;
    }
  },
};

async function encryptAndUploadThumbnail(
  owner: PubkyKey,
  attachmentId: string,
  fileUri: string,
): Promise<{ location: string; key: string; nonce: string; size: number } | null> {
  try {
    const resized = await manipulateAsync(fileUri, [{ resize: { width: 96 } }], {
      compress: 0.55,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!resized.base64) return null;
    const size = decodedBase64Bytes(resized.base64);
    if (size <= 0 || size > ATTACHMENT_THUMBNAIL_MAX_BYTES) return null;
    const location = buildAttachmentThumbLocation(owner, attachmentId);
    const key = await PaykitLinkNative.generateAttachmentKey();
    const sealed = await PaykitLinkNative.attachmentEncrypt(
      toBase64Url(resized.base64),
      key,
      location,
    );
    await PubkyService.put(location, sealed.ciphertextB64);
    return { location, key, nonce: sealed.nonceB64, size };
  } catch {
    return null;
  }
}

function requireOwner(): PubkyKey {
  const owner = KeyStore.getPubky();
  if (!owner) throw new AttachmentError('validation', 'No local pubky');
  return owner;
}

export function conversationPeerFromTarget(conversationId: string): PubkyKey | null {
  return parseDmConversationId(conversationId)?.counterpartyPubky ?? null;
}
