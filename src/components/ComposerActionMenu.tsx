import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  AccessibilityInfo,
  findNodeHandle,
} from 'react-native';
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
  const titleRef = useRef<Text>(null);
  const firstEnabledRef = useRef<View>(null);
  const firstEnabledId = actions.find(action => !action.disabled)?.id ?? null;

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const node = firstEnabledRef.current ?? titleRef.current;
      const tag = findNodeHandle(node);
      if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
    }, 50);
    return () => clearTimeout(timer);
  }, [visible, firstEnabledId]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion, 'fade')}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View testID="composerActionMenu" style={styles.sheet} accessibilityRole="menu">
          <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
            {COPY.composerAttach}
          </Text>
          {actions.map(action => (
            <TouchableOpacity
              key={action.id}
              ref={action.id === firstEnabledId ? firstEnabledRef : undefined}
              testID={`composerAction-${action.id}`}
              accessibilityRole="menuitem"
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
              <Text style={[styles.icon, action.disabled && styles.labelDisabled]}>
                {action.icon}
              </Text>
              <View style={styles.rowCopy}>
                <Text style={[styles.label, action.disabled && styles.labelDisabled]}>
                  {action.label}
                </Text>
                {action.disabled && action.reason ? (
                  <Text style={styles.reason}>{action.reason}</Text>
                ) : null}
              </View>
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
        <Pressable
          testID="composerActionBackdrop"
          accessible={false}
          style={styles.backdropHit}
          onPress={onClose}
        />
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
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 4,
    zIndex: 1,
  },
  title: { color: '#f9fafb', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  row: {
    minHeight: 44,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowDisabled: { opacity: 0.55 },
  rowCopy: { flex: 1, gap: 4 },
  icon: { color: '#c4b5fd', fontSize: 18, width: 24, textAlign: 'center' },
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
