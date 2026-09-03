import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parsePubky } from '../../../utils/pubkyId';
import { ContactErrorBlock } from '../../../ui/contacts/ContactErrorBlock';
import { color, space, radius, typeRole } from '../../../theme';
import {
  CONTACTS_BODY,
  CONTACTS_BRAND,
  CONTACTS_CANVAS,
  CONTACTS_ERROR,
  CONTACTS_HAIRLINE,
  CONTACTS_MUTED,
  CONTACTS_RADIUS,
  MIN_TARGET,
} from '../../../ui/contacts/tokens';

const CONTACT_SEARCH_VALIDATION = 'Must be a 52-character z-base-32 pubky (no 0, 2, l, or v).';

export function ContactSearchView({
  loading,
  error,
  errorDetails,
  onCancel,
  onAdd,
  onInputChange,
}: {
  loading: boolean;
  error: string | null;
  errorDetails: string | null;
  onCancel: () => void;
  onAdd: (pubky: string) => void;
  onInputChange?: () => void;
}) {
  const [pubkyKey, setPubkyKey] = useState('');
  const parsed = parsePubky(pubkyKey);
  const valid = parsed !== null;
  const showValidation = pubkyKey.trim().length > 0 && !valid;

  return (
    <SafeAreaView style={styles.container} testID="contactSearchScreen">
      <View style={styles.header}>
        <Pressable
          testID="contactSearchCancel"
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={onCancel}
          style={styles.headerBtn}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Add someone by pubky
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.content}>
        <TextInput
          testID="contactSearchInput"
          accessibilityLabel="Paste Pubky key"
          accessibilityState={{ disabled: loading }}
          style={[styles.input, showValidation && styles.inputInvalid]}
          value={pubkyKey}
          onChangeText={text => {
            setPubkyKey(text);
            onInputChange?.();
          }}
          placeholder="Paste Pubky key (z-base-32)…"
          placeholderTextColor={CONTACTS_MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {showValidation ? (
          <View
            testID="contactSearchValidation"
            accessibilityRole="alert"
            accessibilityLabel={CONTACT_SEARCH_VALIDATION}
            style={styles.validationRow}
          >
            <Text style={styles.validationMark} importantForAccessibility="no">
              !
            </Text>
            <Text style={styles.validation}>{CONTACT_SEARCH_VALIDATION}</Text>
          </View>
        ) : null}
        {error ? <ContactErrorBlock message={error} details={errorDetails} /> : null}
        <Pressable
          testID="contactSearchAdd"
          accessibilityRole="button"
          accessibilityLabel="Add contact"
          accessibilityState={{ disabled: !valid || loading, busy: loading }}
          style={[styles.button, (!valid || loading) && styles.buttonDisabled]}
          onPress={() => {
            if (parsed) onAdd(parsed);
          }}
          disabled={!valid || loading}
        >
          {loading ? (
            <ActivityIndicator color={color.textOnBrand} />
          ) : (
            <Text style={styles.buttonText}>Add contact</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CONTACTS_CANVAS },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CONTACTS_HAIRLINE,
    flexWrap: 'wrap',
  },
  headerBtn: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, justifyContent: 'center' },
  cancel: { color: color.brandText, fontSize: typeRole.body.fontSize },
  title: {
    fontSize: typeRole.titleStack.fontSize,
    fontWeight: '600',
    color: CONTACTS_BODY,
    flexShrink: 1,
    textAlign: 'center',
  },
  content: { padding: space.xxl, gap: space.lg },
  input: {
    minHeight: MIN_TARGET,
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    color: CONTACTS_BODY,
    fontSize: typeRole.secondary.fontSize,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  inputInvalid: { borderColor: CONTACTS_ERROR },
  validationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  validationMark: { color: CONTACTS_ERROR, fontWeight: '700', fontSize: typeRole.body.fontSize },
  validation: {
    color: CONTACTS_ERROR,
    fontSize: typeRole.secondary.fontSize,
    flex: 1,
    flexShrink: 1,
  },
  button: {
    minHeight: MIN_TARGET,
    backgroundColor: CONTACTS_BRAND,
    borderRadius: CONTACTS_RADIUS,
    paddingVertical: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: color.textOnBrand, fontSize: typeRole.body.fontSize, fontWeight: '600' },
});
