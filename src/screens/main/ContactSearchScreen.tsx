import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types';
import { ContactsService } from '../../services/ContactsService';
import { useAuthStore } from '../../stores/authStore';
import { useContactStore } from '../../stores/contactStore';
import { sanitizeError, stripSensitive } from '../../ui/sanitizedError';
import { afterManualContactAdded, submitManualContact } from './contacts/contactsActions';
import { ContactSearchView } from './contacts/ContactSearchView';
import { ConfirmSheet } from '../../ui/contacts/ConfirmSheet';
import { CONTACTS_COPY } from '../../ui/contacts/contactsCopy';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ContactSearchScreen() {
  const nav = useNavigation<Nav>();
  const localPubky = useAuthStore(s => s.pubky);
  const upsertContact = useContactStore(s => s.upsertContact);
  const openContactDetail = useContactStore(s => s.openContactDetail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [unblockAndAddPubky, setUnblockAndAddPubky] = useState<string | null>(null);

  async function handleAdd(parsed: string, confirmUnblock = false) {
    if (!localPubky) return;
    setLoading(true);
    setError(null);
    setErrorDetails(null);
    try {
      const result = await submitManualContact({
        ownerPubky: localPubky,
        pubky: parsed,
        confirmUnblock,
        addManualContact: (owner, pubky, options) =>
          ContactsService.addManualContact(owner, pubky, options),
      });
      if (!result.ok) {
        if (result.reason === 'blocked') {
          setUnblockAndAddPubky(parsed);
          return;
        }
        setError(result.message);
        setErrorDetails(result.details ? stripSensitive(result.details) : null);
        return;
      }
      upsertContact(result.contact);
      const landing = afterManualContactAdded(result.contact.pubky);
      openContactDetail(landing.detailPubky);
      nav.navigate(...landing.navigateArgs);
    } catch (err) {
      const sanitized = sanitizeError(err, 'Could not add that contact.');
      setError(sanitized.message);
      setErrorDetails(sanitized.details);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ContactSearchView
        loading={loading}
        error={error}
        errorDetails={errorDetails}
        onCancel={() => nav.goBack()}
        onInputChange={() => {
          setError(null);
          setErrorDetails(null);
          setUnblockAndAddPubky(null);
        }}
        onAdd={pubky => {
          void handleAdd(pubky);
        }}
      />
      <ConfirmSheet
        visible={unblockAndAddPubky !== null}
        title={CONTACTS_COPY.unblockAndAddTitle}
        body={CONTACTS_COPY.unblockBody}
        confirmLabel={CONTACTS_COPY.unblockAndAddConfirm}
        onDismiss={() => setUnblockAndAddPubky(null)}
        onConfirm={() => {
          const target = unblockAndAddPubky;
          setUnblockAndAddPubky(null);
          if (target) void handleAdd(target, true);
        }}
      />
    </View>
  );
}
