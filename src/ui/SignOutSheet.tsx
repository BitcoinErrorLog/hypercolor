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
import { color, space, radius, typeRole, measure } from '../theme';

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
    backgroundColor: color.overlayDeep,
    justifyContent: 'center',
    padding: space.xxl,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.xl,
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.surfaceRaised,
  },
  title: { color: color.textPrimary, fontSize: typeRole.numeric.fontSize, fontWeight: '700' },
  body: { color: color.textSecondary, fontSize: typeRole.callout.fontSize, lineHeight: 22 },
  error: { color: color.danger, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
  cancel: {
    minHeight: measure.hitTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: color.textPrimary, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  destructive: {
    minHeight: measure.hitTarget,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.dangerSurface,
    backgroundColor: color.dangerSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveText: {
    color: color.onDanger,
    fontSize: typeRole.body.fontSize,
    fontWeight: '600',
  },
});
