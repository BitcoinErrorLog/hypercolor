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
            <ActivityIndicator color="#fff" />
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CONTACTS_HAIRLINE,
    flexWrap: 'wrap',
  },
  headerBtn: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, justifyContent: 'center' },
  cancel: { color: '#8f57f0', fontSize: 16 },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: CONTACTS_BODY,
    flexShrink: 1,
    textAlign: 'center',
  },
  content: { padding: 24, gap: 16 },
  input: {
    minHeight: MIN_TARGET,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    color: CONTACTS_BODY,
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  inputInvalid: { borderColor: CONTACTS_ERROR },
  validationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  validationMark: { color: CONTACTS_ERROR, fontWeight: '700', fontSize: 16 },
  validation: { color: CONTACTS_ERROR, fontSize: 14, flex: 1, flexShrink: 1 },
  button: {
    minHeight: MIN_TARGET,
    backgroundColor: CONTACTS_BRAND,
    borderRadius: CONTACTS_RADIUS,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
