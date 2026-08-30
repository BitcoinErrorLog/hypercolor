import React, { useCallback, useState } from 'react';
import { Alert, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { AttachmentSendTarget } from '../services/attachments/AttachmentService';
import { AttachmentService } from '../services/attachments/AttachmentService';
import { AttachmentError } from '../types/attachment';

export function ComposerAttachButton({
  target,
  disabled,
  onSent,
}: {
  target: AttachmentSendTarget;
  disabled?: boolean;
  onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (uri: string, contentType: string) => {
      setBusy(true);
      try {
        await AttachmentService.sendAttachment(target, uri, contentType);
        onSent();
      } catch (err) {
        const message =
          err instanceof AttachmentError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        Alert.alert('Attachment failed', message);
      } finally {
        setBusy(false);
      }
    },
    [onSent, target],
  );

  const pick = useCallback(() => {
    if (busy || disabled) return;
    Alert.alert('Attach', 'Choose a source', [
      {
        text: 'Photo',
        onPress: () => {
          void (async () => {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
              Alert.alert('Permission needed', 'Photo library access is required to send images.');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.9,
            });
            if (result.canceled || !result.assets[0]) return;
            const asset = result.assets[0];
            await send(asset.uri, asset.mimeType ?? 'image/jpeg');
          })();
        },
      },
      {
        text: 'File',
        onPress: () => {
          void (async () => {
            const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
            if (result.canceled || !result.assets[0]) return;
            const asset = result.assets[0];
            await send(asset.uri, asset.mimeType ?? 'application/octet-stream');
          })();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [busy, disabled, send]);

  return (
    <TouchableOpacity
      style={[styles.btn, (busy || disabled) && styles.disabled]}
      onPress={pick}
      disabled={busy || disabled}
      accessibilityLabel="Attach file"
    >
      {busy ? (
        <ActivityIndicator color="#c4b5fd" size="small" />
      ) : (
        <Text style={styles.icon}>+</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1f1f1f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: { opacity: 0.4 },
  icon: { color: '#c4b5fd', fontSize: 22, fontWeight: '700', marginTop: -2 },
});
