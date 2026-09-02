import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CONTACTS_BODY,
  CONTACTS_BRAND,
  CONTACTS_BRAND_TEXT,
  CONTACTS_HAIRLINE,
  CONTACTS_MUTED,
  CONTACTS_RADIUS,
  CONTACTS_SURFACE,
  MIN_TARGET,
} from './tokens';

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const insets = useSafeAreaInsets();
  const windowHeight = Dimensions.get('window').height;
  const sheetMaxHeight = Math.max(280, Math.min(windowHeight * 0.92, windowHeight - 24));
  const scrollMaxHeight = Math.max(120, sheetMaxHeight - 140);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <Pressable
          testID="confirmSheetBackdrop"
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
        />
        <View
          testID="confirmSheet"
          style={[
            styles.sheet,
            { maxHeight: sheetMaxHeight, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          accessibilityRole="summary"
        >
          <ScrollView
            testID="confirmSheetScroll"
            style={{ maxHeight: scrollMaxHeight }}
            contentContainerStyle={styles.scrollContent}
          >
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              testID="confirmSheetConfirm"
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              onPress={onConfirm}
              style={[styles.primary, destructive && styles.destructive]}
            >
              <Text style={styles.primaryLabel}>{confirmLabel}</Text>
            </Pressable>
            <Pressable
              testID="confirmSheetCancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={onDismiss}
              style={styles.secondary}
            >
              <Text style={styles.secondaryLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CONTACTS_SURFACE,
    borderTopLeftRadius: CONTACTS_RADIUS,
    borderTopRightRadius: CONTACTS_RADIUS,
    borderColor: CONTACTS_HAIRLINE,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 14,
  },
  scrollContent: { gap: 14, paddingBottom: 8 },
  title: { color: CONTACTS_BODY, fontSize: 20, fontWeight: '700' },
  body: { color: CONTACTS_MUTED, fontSize: 15, lineHeight: 22 },
  actions: { gap: 8 },
  primary: {
    minHeight: MIN_TARGET,
    borderRadius: CONTACTS_RADIUS,
    backgroundColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructive: { backgroundColor: '#7f1d1d' },
  primaryLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { color: CONTACTS_BRAND_TEXT, fontSize: 16, fontWeight: '600' },
});
