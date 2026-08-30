import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types';
import { ContactsService } from '../../services/ContactsService';
import { threadRouteParams } from '../../types/link';
import { useAuthStore } from '../../stores/authStore';
import { useContactStore } from '../../stores/contactStore';
import { isValidPubky, parsePubky } from '../../utils/pubkyId';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ContactSearchScreen() {
  const nav = useNavigation<Nav>();
  const localPubky = useAuthStore(s => s.pubky);
  const upsertContact = useContactStore(s => s.upsertContact);
  const [pubkyKey, setPubkyKey] = useState('');
  const [loading, setLoading] = useState(false);
  const parsed = parsePubky(pubkyKey);
  const valid = parsed !== null;

  async function handleAdd() {
    if (!localPubky || !parsed) return;
    setLoading(true);
    try {
      const result = await ContactsService.addManualContact(localPubky, parsed);
      if (!result.ok) {
        Alert.alert(result.reason === 'not-found' ? 'Not Found' : 'Cannot add', result.message);
        return;
      }
      upsertContact(result.contact);
      Alert.alert(
        'Contact Added',
        result.contact.displayName
          ? `${result.contact.displayName} added. Open the chat to send over Encrypted Links.`
          : 'Contact added. Open the chat to send over Encrypted Links.',
        [
          {
            text: 'Chat',
            onPress: () => nav.replace('Thread', threadRouteParams(result.contact.pubky)),
          },
        ],
      );
    } catch (err) {
      Alert.alert('Error', (err as Error).message ?? 'Add failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="contactSearchScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="contactSearchCancel"
          accessibilityLabel="Cancel"
          onPress={() => nav.goBack()}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Find Contact</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <TextInput
          testID="contactSearchInput"
          accessibilityLabel="Paste Pubky key"
          style={styles.input}
          value={pubkyKey}
          onChangeText={setPubkyKey}
          placeholder="Paste Pubky key (z-base-32)…"
          placeholderTextColor="#4b5563"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {pubkyKey.trim().length > 0 && !valid ? (
          <Text style={styles.validation}>
            {isValidPubky(pubkyKey)
              ? null
              : 'Must be a 52-character z-base-32 pubky (no 0, 2, l, or v).'}
          </Text>
        ) : null}
        <TouchableOpacity
          testID="contactSearchAdd"
          accessibilityLabel="Add contact"
          style={[styles.button, (!valid || loading) && styles.buttonDisabled]}
          onPress={() => {
            void handleAdd();
          }}
          disabled={!valid || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Add contact</Text>
          )}
        </TouchableOpacity>

        <View style={styles.qrFallback}>
          <Text style={styles.qrTitle}>Scan QR</Text>
          <Text style={styles.qrBody}>
            QR scanning requires a camera module that is not installed in this build. Paste or type
            a pubky above. Adding expo-camera would need a native rebuild (no camera plugin is
            declared in app.json).
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  cancel: { color: '#7c3aed', fontSize: 16, width: 60 },
  title: { fontSize: 17, fontWeight: '600', color: '#f9fafb' },
  content: { padding: 24, gap: 16 },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    color: '#f9fafb',
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  validation: { color: '#f59e0b', fontSize: 13 },
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  qrFallback: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#111827',
    gap: 6,
  },
  qrTitle: { color: '#9ca3af', fontSize: 14, fontWeight: '600' },
  qrBody: { color: '#6b7280', fontSize: 13, lineHeight: 18 },
});
