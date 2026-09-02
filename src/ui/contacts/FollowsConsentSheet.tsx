import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CONTACTS_BODY,
  CONTACTS_BRAND,
  CONTACTS_CANVAS,
  CONTACTS_HAIRLINE,
  CONTACTS_MUTED,
  CONTACTS_RADIUS,
  CONTACTS_SURFACE,
  MIN_TARGET,
} from './tokens';

export const CONSENT_TITLE = 'Use your pubky.app follows';

export const CONSENT_BODY = [
  'Your follows at `/pub/pubky.app/follows/` are already world-readable. Hypercolor only reads what anyone can already see, and never writes a follow.',
  'Imported follows become suggestions, not contacts, and they never auto-accept a message — every new inbound chat still waits in Message requests.',
  'While this is on, opening Contacts re-reads that listing from your homeserver. If the homeserver listing is unavailable, the public index (Nexus) is asked for your following list and each name is re-checked against your homeserver. Hypercolor never asks Nexus who follows you.',
].join('\n\n');

export const CONSENT_CHECKBOX_LABEL =
  'I understand my follows are public, that importing does not hide them, and that messaging someone may reveal I use Hypercolor.';

export const CONSENT_CONFIRM_LABEL = 'Use my follows';
export const CONSENT_NOT_NOW_LABEL = 'Not now';

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
          style={styles.sheet}
          accessibilityRole="summary"
          accessibilityLabel={CONSENT_TITLE}
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
    paddingBottom: 28,
    gap: 14,
  },
  title: { color: CONTACTS_BODY, fontSize: 20, fontWeight: '700' },
  body: { color: CONTACTS_MUTED, fontSize: 15, lineHeight: 22 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: MIN_TARGET,
    paddingVertical: 8,
  },
  box: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CONTACTS_CANVAS,
  },
  boxOn: { backgroundColor: CONTACTS_BRAND },
  tick: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkLabel: { color: CONTACTS_BODY, fontSize: 15, flex: 1, flexShrink: 1, lineHeight: 22 },
  primary: {
    minHeight: MIN_TARGET,
    borderRadius: CONTACTS_RADIUS,
    backgroundColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  secondary: {
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
});
