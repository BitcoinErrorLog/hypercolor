import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { AttachmentRecord } from '../types/attachment';
import { isImageContentType } from '../types/attachment';
import { AttachmentError } from '../types/attachment';
import { AttachmentService } from '../services/attachments/AttachmentService';

export function AttachmentBubble({
  record,
  isMine,
}: {
  record: AttachmentRecord;
  isMine: boolean;
}) {
  const [uri, setUri] = useState<string | null>(record.localCachePath);
  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    record.resolveState === 'failed' ? 'Could not decrypt this attachment' : null,
  );

  const resolveFull = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const path = await AttachmentService.resolveAttachment(
        record.ownerPubky,
        record.senderPubky,
        record.eventId,
      );
      setUri(path);
    } catch (err) {
      const message =
        err instanceof AttachmentError && err.code === 'decrypt-failed'
          ? 'Decrypt failed — the file may be corrupt or the key does not match'
          : err instanceof Error
            ? err.message
            : 'Download failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loading, record.eventId, record.ownerPubky, record.senderPubky]);

  useEffect(() => {
    if (record.localCachePath) {
      setUri(record.localCachePath);
      return;
    }
    if (!isImageContentType(record.contentType) || !record.thumbnailLocation) return;
    let cancelled = false;
    void AttachmentService.resolveThumbnail(
      record.ownerPubky,
      record.senderPubky,
      record.eventId,
    ).then(path => {
      if (!cancelled && path) setThumbUri(path);
    });
    return () => {
      cancelled = true;
    };
  }, [
    record.contentType,
    record.eventId,
    record.localCachePath,
    record.ownerPubky,
    record.senderPubky,
    record.thumbnailLocation,
  ]);

  const textColor = isMine ? '#fff' : '#f9fafb';
  const preview = uri ?? thumbUri;

  if (record.deliveryState === 'sending' || record.resolveState === 'uploading') {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#c4b5fd" />
        <Text style={[styles.meta, { color: textColor }]}>Uploading…</Text>
      </View>
    );
  }

  if (isImageContentType(record.contentType)) {
    return (
      <TouchableOpacity onPress={() => void resolveFull()} disabled={loading}>
        {preview ? (
          <Image source={{ uri: preview }} style={styles.image} resizeMode="cover" />
        ) : (
          <View
            style={[styles.placeholder, isMine ? styles.placeholderMine : styles.placeholderTheirs]}
          >
            {loading ? (
              <ActivityIndicator color="#c4b5fd" />
            ) : (
              <Text style={styles.placeholderText}>Image</Text>
            )}
          </View>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!uri ? (
          <Text style={[styles.meta, { color: textColor }]}>
            {loading ? 'Decrypting…' : 'Tap to download'}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.card} onPress={() => void resolveFull()} disabled={loading}>
      <Text style={[styles.fileName, { color: textColor }]}>{fileLabel(record.contentType)}</Text>
      <Text style={[styles.meta, { color: textColor }]}>{formatBytes(record.size)}</Text>
      {loading ? (
        <ActivityIndicator color="#c4b5fd" style={styles.spinner} />
      ) : uri ? (
        <Text style={[styles.meta, { color: textColor }]}>Saved on this device</Text>
      ) : (
        <Text style={[styles.action, { color: textColor }]}>Download</Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </TouchableOpacity>
  );
}

function fileLabel(contentType: string): string {
  const slash = contentType.indexOf('/');
  if (slash === -1) return contentType;
  return contentType.slice(slash + 1).toUpperCase() || contentType;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  card: { minWidth: 140, gap: 4 },
  image: { width: 220, height: 160, borderRadius: 12, backgroundColor: '#111' },
  placeholder: {
    width: 220,
    height: 120,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderMine: { backgroundColor: 'rgba(255,255,255,0.12)' },
  placeholderTheirs: { backgroundColor: '#111' },
  placeholderText: { color: '#9ca3af', fontWeight: '600' },
  fileName: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 11, opacity: 0.7 },
  action: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  error: { color: '#fca5a5', fontSize: 11, marginTop: 4 },
  spinner: { marginTop: 6 },
});
