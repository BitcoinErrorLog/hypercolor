import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../stores/authStore';
import { PubkyService } from '../../services/PubkyService';
import { MessageRouter } from '../../services/MessageRouter';
import type { RootStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProfileScreen() {
  const nav = useNavigation<Nav>();
  const { profile, pubky, clearSession } = useAuthStore();

  async function handleSignOut() {
    Alert.alert(
      'Disconnect from pubky-ring',
      "This removes Hypercolor's delegated access. You will need to re-authorize with pubky-ring to use the app.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await MessageRouter.stop();
            await PubkyService.signOut();
            clearSession();
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity onPress={() => nav.navigate('Settings')}>
          <Text style={styles.settings}>Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.displayName?.charAt(0).toUpperCase() ?? '?'}
          </Text>
        </View>

        <Text style={styles.displayName}>{profile?.displayName ?? 'Unnamed'}</Text>

        {pubky ? (
          <Text style={styles.pubkyKey} numberOfLines={1} ellipsizeMode="middle">
            {pubky}
          </Text>
        ) : null}

        <Text style={styles.keystoreNote}>Keys managed by pubky-ring</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.dangerButton} onPress={handleSignOut}>
          <Text style={styles.dangerButtonText}>Disconnect pubky-ring</Text>
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
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#f9fafb' },
  settings: { fontSize: 16, color: '#7c3aed', fontWeight: '600' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  displayName: { fontSize: 20, fontWeight: '600', color: '#f9fafb' },
  pubkyKey: {
    fontSize: 12,
    color: '#4b5563',
    fontFamily: 'monospace',
    maxWidth: 280,
  },
  keystoreNote: {
    fontSize: 13,
    color: '#7c3aed',
    marginTop: 4,
  },
  actions: { paddingHorizontal: 32, paddingBottom: 48 },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  dangerButtonText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
});
