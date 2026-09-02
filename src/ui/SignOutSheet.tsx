import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COPY, lastBackupLine } from '../copy/uxCopy';
import { HIT_SLOP_44 } from './hitTarget';

export function SignOutSheet({
  visible,
  lastBackupRelative,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  lastBackupRelative: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
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
          <TouchableOpacity
            testID="signOutCancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            accessibilityState={{ selected: true }}
            hitSlop={HIT_SLOP_44}
            onPress={onCancel}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>{COPY.cancel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="signOutConfirm"
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={HIT_SLOP_44}
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
