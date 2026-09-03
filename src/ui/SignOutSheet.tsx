import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Modal, View, Text, StyleSheet, findNodeHandle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COPY, lastBackupLine } from '../copy/uxCopy';
import { ErrorDetails } from './ErrorDetails';
import { modalAnimationType, useReduceMotion } from './reduceMotion';
import { color, space, radius, typeRole } from '../theme';
import { Button } from './primitives';

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
  const insets = useSafeAreaInsets();

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
        <View
          style={[styles.card, { paddingBottom: space.lg + insets.bottom }]}
          accessibilityRole="alert"
        >
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
          <View ref={cancelRef}>
            <Button
              testID="signOutCancel"
              accessibilityLabel="Cancel"
              disabled={busy}
              label={COPY.cancel}
              variant="secondary"
              onPress={onCancel}
            />
          </View>
          <Button
            testID="signOutConfirm"
            accessibilityLabel="Sign out"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            busy={busy}
            label={COPY.signOut}
            variant="destructive"
            onPress={onConfirm}
          />
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
});
