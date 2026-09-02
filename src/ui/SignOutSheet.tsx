import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  findNodeHandle,
} from 'react-native';
import { COPY, lastBackupLine } from '../copy/uxCopy';
import { HIT_SLOP_44 } from './hitTarget';
import { ErrorDetails } from './ErrorDetails';
import { modalAnimationType, useReduceMotion } from './reduceMotion';

export function SignOutSheet({
  visible,
  lastBackupRelative,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  lastBackupRelative: string | null;
  busy?: boolean;
  error?: { message: string; details: string | null } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<View>(null);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const tag = findNodeHandle(cancelRef.current);
      if (tag != null) {
        AccessibilityInfo.setAccessibilityFocus(tag);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion, 'fade')}
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{COPY.signOutTitle}</Text>
          <Text style={styles.body}>{COPY.signOutBodyLocal}</Text>
          <Text style={styles.body}>{COPY.signOutBodyRing}</Text>
          <Text style={styles.body}>
            {lastBackupRelative ? lastBackupLine(lastBackupRelative) : COPY.signOutNoBackup}
          </Text>
          {error ? (
            <View accessibilityRole="alert">
              <Text style={styles.error}>{error.message}</Text>
              <ErrorDetails details={error.details} />
            </View>
          ) : null}
          <TouchableOpacity
            ref={cancelRef}
            testID="signOutCancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={HIT_SLOP_44}
            disabled={busy}
            onPress={onCancel}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>{COPY.cancel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="signOutConfirm"
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityState={{ busy, disabled: busy }}
            hitSlop={HIT_SLOP_44}
            disabled={busy}
            onPress={onConfirm}
            style={styles.destructive}
          >
            <Text style={styles.destructiveText}>{COPY.signOut}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 20,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1a1a1a',
  },
  title: { color: '#f9fafb', fontSize: 18, fontWeight: '700' },
  body: { color: '#808692', fontSize: 15, lineHeight: 22 },
  error: { color: '#fca5a5', fontSize: 14, lineHeight: 20 },
  cancel: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: '#f9fafb', fontSize: 16, fontWeight: '600' },
  destructive: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
});
