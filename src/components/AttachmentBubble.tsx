import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import type { AttachmentRecord } from '../types/attachment';
import { isImageContentType } from '../types/attachment';
import { AttachmentError } from '../types/attachment';
import { AttachmentService } from '../services/attachments/AttachmentService';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';

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
    record.resolveState === 'failed'
      ? 'Could not decrypt this attachment'
      : record.resolveState === 'unavailable-from-backup'
        ? 'Unavailable from backup — ask the sender to re-share'
        : null,
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
    if (record.resolveState === 'unavailable-from-backup') return;
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
    record.resolveState,
  ]);

  const textColor = isMine ? '#fff' : '#f9fafb';
  const preview = uri ?? thumbUri;

  if (record.resolveState === 'unavailable-from-backup') {
    return (
      <View style={styles.card}>
        <Text style={[styles.fileName, { color: textColor }]}>Attachment</Text>
        <Text style={[styles.meta, { color: textColor }]}>
          Unavailable from backup — keys stay on the original device. Ask the sender to re-share.
        </Text>
      </View>
    );
  }

  if (record.deliveryState === 'failed') {
    return (
      <View
        accessibilityRole="alert"
        accessibilityLabel={`${COPY.failed}. ${fileLabel(record.contentType)}`}
        style={styles.card}
      >
        <Text style={[styles.meta, styles.error, { color: textColor }]}>{COPY.failed}</Text>
        <Text style={[styles.meta, { color: textColor }]}>{fileLabel(record.contentType)}</Text>
      </View>
    );
  }

  if (record.deliveryState === 'sending' || record.resolveState === 'uploading') {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Uploading attachment"
        style={styles.card}
      >
        <ActivityIndicator color="#c4b5fd" />
        <Text style={[styles.meta, { color: textColor }]}>Uploading…</Text>
      </View>
    );
  }

  if (isImageContentType(record.contentType)) {
    return (
      <TouchableOpacity
        onPress={() => void resolveFull()}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={
          loading ? 'Decrypting image attachment' : 'Open or decrypt image attachment'
        }
        accessibilityState={{ disabled: loading, busy: loading }}
        hitSlop={HIT_SLOP_44}
      >
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
        {error ? (
          <View accessibilityRole="alert" style={styles.errorRow}>
            <Text style={styles.errorIcon}>!</Text>
            <Text style={styles.error}>{error}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={COPY.retry}
              hitSlop={HIT_SLOP_44}
              onPress={() => void resolveFull()}
              style={styles.retry}
            >
              <Text style={styles.retryText}>{COPY.retry}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {!uri ? (
          <Text style={[styles.meta, { color: textColor }]}>
            {loading ? 'Decrypting…' : 'Tap to download'}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => void resolveFull()}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={
        loading
          ? `Decrypting file ${fileLabel(record.contentType)}`
          : `Open or decrypt file ${fileLabel(record.contentType)}`
      }
      accessibilityState={{ disabled: loading, busy: loading }}
      hitSlop={HIT_SLOP_44}
    >
      <Text style={[styles.fileName, { color: textColor }]}>{fileLabel(record.contentType)}</Text>
      <Text style={[styles.meta, { color: textColor }]}>{formatBytes(record.size)}</Text>
      {loading ? (
        <ActivityIndicator color="#c4b5fd" style={styles.spinner} />
      ) : uri ? (
        <Text style={[styles.meta, { color: textColor }]}>Saved on this device</Text>
      ) : (
        <Text style={[styles.action, { color: textColor }]}>Download</Text>
      )}
      {error ? (
        <View accessibilityRole="alert" style={styles.errorRow}>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={COPY.retry}
            hitSlop={HIT_SLOP_44}
            onPress={() => void resolveFull()}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{COPY.retry}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
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
  error: { color: '#fca5a5', fontSize: 11, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  errorIcon: { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  retryText: { color: '#c4b5fd', fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  spinner: { marginTop: 6 },
});
