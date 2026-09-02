import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { modalAnimationType, useReduceMotion } from '../ui/reduceMotion';
import type { ComposerActionItem } from '../ui/composerActions';

export function ComposerActionMenu({
  visible,
  actions,
  onSelect,
  onClose,
}: {
  visible: boolean;
  actions: readonly ComposerActionItem[];
  onSelect: (id: ComposerActionItem['id']) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion) === 'none' ? 'none' : 'fade'}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <Pressable
          testID="composerActionBackdrop"
          accessibilityRole="button"
          accessibilityLabel={COPY.cancel}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View testID="composerActionMenu" style={styles.sheet} accessibilityRole="menu">
          <Text style={styles.title}>{COPY.composerAttach}</Text>
          {actions.map(action => (
            <TouchableOpacity
              key={action.id}
              testID={`composerAction-${action.id}`}
              accessibilityRole="button"
              accessibilityLabel={
                action.disabled && action.reason
                  ? `${action.label}, ${action.reason}`
                  : action.label
              }
              accessibilityState={{ disabled: action.disabled }}
              hitSlop={HIT_SLOP_44}
              disabled={action.disabled}
              onPress={() => onSelect(action.id)}
              style={[styles.row, action.disabled && styles.rowDisabled]}
            >
              <Text style={[styles.label, action.disabled && styles.labelDisabled]}>
                {action.label}
              </Text>
              {action.disabled && action.reason ? (
                <Text style={styles.reason}>{action.reason}</Text>
              ) : null}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            testID="composerActionCancel"
            accessibilityRole="button"
            accessibilityLabel={COPY.cancel}
            hitSlop={HIT_SLOP_44}
            onPress={onClose}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>{COPY.cancel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 4,
  },
  title: { color: '#f9fafb', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  row: {
    minHeight: 44,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    gap: 4,
  },
  rowDisabled: { opacity: 0.55 },
  label: { color: '#f9fafb', fontSize: 16, fontWeight: '600' },
  labelDisabled: { color: '#808692' },
  reason: { color: '#808692', fontSize: 13 },
  cancel: {
    minHeight: 44,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: '#f9fafb', fontSize: 16, fontWeight: '600' },
});
