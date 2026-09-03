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
import { color, space, radius, typeRole } from '../../theme';
import {
  CONTACTS_BODY,
  CONTACTS_BRAND,
  CONTACTS_BRAND_TEXT,
  CONTACTS_CANVAS,
  CONTACTS_HAIRLINE,
  CONTACTS_MUTED,
  CONTACTS_RADIUS,
  CONTACTS_SURFACE,
  MIN_TARGET,
} from './tokens';

export const CONSENT_TITLE = 'Use your pubky.app follows';

const CONSENT_BODY = [
  'Your follows at `/pub/pubky.app/follows/` are already world-readable. Hypercolor only reads what anyone can already see, and never writes a follow.',
  'Imported follows become suggestions, not contacts, and they never auto-accept a message — every new inbound chat still waits in Message requests.',
  'While this is on, opening Contacts re-reads that listing from your homeserver. If the homeserver listing is unavailable, the public index (Nexus) is asked for your following list and each name is re-checked against your homeserver. Hypercolor never asks Nexus who follows you.',
].join('\n\n');

const CONSENT_CHECKBOX_LABEL =
  'I understand my follows are public, that importing does not hide them, and that messaging someone may reveal I use Hypercolor.';

const CONSENT_CONFIRM_LABEL = 'Use my follows';
const CONSENT_NOT_NOW_LABEL = 'Not now';

export function FollowsConsentSheet({
  visible,
  busy,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const insets = useSafeAreaInsets();
  const windowHeight = Dimensions.get('window').height;
  const sheetMaxHeight = Math.max(320, Math.min(windowHeight * 0.92, windowHeight - 24));
  const scrollMaxHeight = Math.max(160, sheetMaxHeight - 160);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const confirmDisabled = !checked || busy;
  const dismiss = () => {
    setChecked(false);
    onDismiss();
  };
  const confirm = () => {
    setChecked(false);
    onConfirm();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={dismiss}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <Pressable
          testID="followsConsentBackdrop"
          accessibilityRole="button"
          accessibilityLabel="Dismiss follows consent"
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
        />
        <View
          testID="followsConsentSheet"
          style={[
            styles.sheet,
            { maxHeight: sheetMaxHeight, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          accessibilityRole="summary"
          accessibilityLabel={CONSENT_TITLE}
        >
          <ScrollView
            testID="followsConsentScroll"
            style={{ maxHeight: scrollMaxHeight }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>{CONSENT_TITLE}</Text>
            <Text style={styles.body}>{CONSENT_BODY}</Text>
            <Pressable
              testID="followsConsentCheckbox"
              accessibilityRole="checkbox"
              accessibilityLabel={CONSENT_CHECKBOX_LABEL}
              accessibilityState={{ checked, busy }}
              onPress={() => setChecked(v => !v)}
              style={styles.checkRow}
            >
              <View style={[styles.box, checked && styles.boxOn]}>
                {checked ? <Text style={styles.tick}>✓</Text> : null}
              </View>
              <Text style={styles.checkLabel}>{CONSENT_CHECKBOX_LABEL}</Text>
            </Pressable>
          </ScrollView>
          <View testID="followsConsentActions" style={styles.actions}>
            <Pressable
              testID="followsConsentConfirm"
              accessibilityRole="button"
              accessibilityLabel={CONSENT_CONFIRM_LABEL}
              accessibilityState={{ disabled: confirmDisabled, busy }}
              disabled={confirmDisabled}
              onPress={confirm}
              style={[styles.primary, confirmDisabled && styles.disabled]}
            >
              <Text style={styles.primaryLabel}>{busy ? 'Reading…' : CONSENT_CONFIRM_LABEL}</Text>
            </Pressable>
            <Pressable
              testID="followsConsentNotNow"
              accessibilityRole="button"
              accessibilityLabel={CONSENT_NOT_NOW_LABEL}
              onPress={dismiss}
              style={styles.secondary}
            >
              <Text style={styles.secondaryLabel}>{CONSENT_NOT_NOW_LABEL}</Text>
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
    backgroundColor: color.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CONTACTS_SURFACE,
    borderTopLeftRadius: CONTACTS_RADIUS,
    borderTopRightRadius: CONTACTS_RADIUS,
    borderColor: CONTACTS_HAIRLINE,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.lg,
  },
  scrollContent: { gap: space.lg, paddingBottom: space.sm },
  title: { color: CONTACTS_BODY, fontSize: typeRole.heading.fontSize, fontWeight: '700' },
  body: { color: CONTACTS_MUTED, fontSize: typeRole.callout.fontSize, lineHeight: 22 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    minHeight: MIN_TARGET,
    paddingVertical: space.sm,
  },
  box: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: radius.bubbleTail,
    borderWidth: 2,
    borderColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CONTACTS_CANVAS,
  },
  boxOn: { backgroundColor: CONTACTS_BRAND },
  tick: { color: color.textOnBrand, fontSize: typeRole.secondary.fontSize, fontWeight: '700' },
  checkLabel: {
    color: CONTACTS_BODY,
    fontSize: typeRole.callout.fontSize,
    flex: 1,
    flexShrink: 1,
    lineHeight: 22,
  },
  actions: { gap: space.sm },
  primary: {
    minHeight: MIN_TARGET,
    borderRadius: CONTACTS_RADIUS,
    backgroundColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primaryLabel: { color: color.textOnBrand, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  secondary: {
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    color: CONTACTS_BRAND_TEXT,
    fontSize: typeRole.body.fontSize,
    fontWeight: '600',
  },
});
