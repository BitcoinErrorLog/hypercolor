import React from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'AwaitingRingAuth'>;

/**
 * Shown after Hypercolor opens pubky-ring.
 * The actual auth completion happens via the deep link callback handled in RootNavigator.
 * This screen just shows a waiting state and lets the user cancel.
 */
export default function AwaitingRingAuthScreen() {
  const nav = useNavigation<Nav>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color="#7c3aed" style={styles.spinner} />
        <Text style={styles.title}>Waiting for pubky-ring</Text>
        <Text style={styles.description}>
          Approve the authorization in pubky-ring to continue.{'\n'}
          You&apos;ll be redirected back here automatically.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelButton} onPress={() => nav.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 20,
  },
  spinner: { marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#f9fafb', textAlign: 'center' },
  description: { fontSize: 15, color: '#6b7280', lineHeight: 22, textAlign: 'center' },
  actions: { paddingHorizontal: 32, paddingBottom: 48 },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { color: '#9ca3af', fontSize: 16 },
});
