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
import { PubkyService } from '../../services/PubkyService';
import { StorageService } from '../../services/StorageService';
import { SSESubscriptionManager } from '../../services/SSESubscriptionManager';
import { useAuthStore } from '../../stores/authStore';
import { useContactStore } from '../../stores/contactStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ContactSearchScreen() {
  const nav = useNavigation<Nav>();
  const localPubky = useAuthStore(s => s.pubky);
  const upsertContact = useContactStore(s => s.upsertContact);
  const [pubkyKey, setPubkyKey] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    const key = pubkyKey.trim();
    if (!key) return;
    setLoading(true);
    try {
      const homeserver = await PubkyService.getHomeserver(key);
      if (!homeserver) {
        Alert.alert(
          'Not Found',
          'No homeserver found for that pubky key. Make sure the key is correct.',
        );
        return;
      }

      const profile = await PubkyService.getProfile(key);

      const contact = {
        pubky: key,
        ...(profile?.displayName !== undefined ? { displayName: profile.displayName } : {}),
        ...(profile?.avatarHash !== undefined ? { avatarHash: profile.avatarHash } : {}),
        homeserver,
        trustScore: 0.0,
        firstSeenAt: Date.now(),
      };

      await StorageService.upsertContact(contact);
      upsertContact(contact);

      if (localPubky) {
        await SSESubscriptionManager.subscribeToContact(localPubky, key);
      }

      Alert.alert(
        'Contact Added',
        profile?.displayName ? `${profile.displayName} added to contacts.` : 'Contact added.',
        [{ text: 'OK', onPress: () => nav.goBack() }],
      );
    } catch (err) {
      Alert.alert('Error', (err as Error).message ?? 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Find Contact</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <TextInput
          style={styles.input}
          value={pubkyKey}
          onChangeText={setPubkyKey}
          placeholder="Paste Pubky key (z-base-32)…"
          placeholderTextColor="#4b5563"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        <TouchableOpacity
          style={[styles.button, (!pubkyKey.trim() || loading) && styles.buttonDisabled]}
          onPress={handleSearch}
          disabled={!pubkyKey.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Search</Text>
          )}
        </TouchableOpacity>
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
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
