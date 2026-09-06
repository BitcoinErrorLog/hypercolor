import { Buffer } from 'buffer';
import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { v4 as uuidv4 } from 'uuid';
import type { AttachmentSendTarget } from '../services/attachments/AttachmentService';
import { AttachmentService } from '../services/attachments/AttachmentService';
import { writeFileFromStandardBase64 } from '../services/attachments/fileIo';
import { fetchGifBytes } from '../services/gif/GifProxyClient';
import { AttachmentError } from '../types/attachment';
import { COPY } from '../copy/uxCopy';

export type ComposerAttachNotice = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type ComposerAttachResult =
  | { ok: true }
  | { ok: false; notice: ComposerAttachNotice }
  | { ok: false; cancelled: true };

async function sendAttachment(
  target: AttachmentSendTarget,
  uri: string,
  contentType: string,
): Promise<ComposerAttachResult> {
  try {
    await AttachmentService.sendAttachment(target, uri, contentType);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof AttachmentError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not send the attachment.';
    return { ok: false, notice: { message } };
  }
}

export async function pickAndSendPhoto(
  target: AttachmentSendTarget,
): Promise<ComposerAttachResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      ok: false,
      notice: {
        message: COPY.photoPermissionNotice,
        actionLabel: COPY.openSettings,
        onAction: () => {
          void Linking.openSettings();
        },
      },
    };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  if (result.canceled || !result.assets[0]) return { ok: false, cancelled: true };
  const asset = result.assets[0];
  return sendAttachment(target, asset.uri, asset.mimeType ?? 'image/jpeg');
}

export async function pickAndSendFile(target: AttachmentSendTarget): Promise<ComposerAttachResult> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]) return { ok: false, cancelled: true };
  const asset = result.assets[0];
  return sendAttachment(target, asset.uri, asset.mimeType ?? 'application/octet-stream');
}

export async function sendGifAttachment(
  target: AttachmentSendTarget,
  gifId: string,
): Promise<ComposerAttachResult> {
  const fetched = await fetchGifBytes(gifId);
  if (!fetched.ok) {
    if (fetched.reason === 'not-configured') {
      return { ok: false, notice: { message: COPY.gifNotConfigured } };
    }
    if (fetched.reason === 'too-large') {
      return { ok: false, notice: { message: COPY.gifTooLarge } };
    }
    return { ok: false, notice: { message: fetched.message } };
  }
  const b64 = Buffer.from(fetched.bytes).toString('base64');
  const uri = `file:///tmp/hypercolor-gif-${uuidv4()}.gif`;
  await writeFileFromStandardBase64(uri, b64);
  return sendAttachment(target, uri, fetched.contentType);
}
