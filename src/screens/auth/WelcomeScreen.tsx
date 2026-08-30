import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types';
import { PubkyRingAuthService } from '../../services/PubkyRingAuthService';
import { DebugSignupPanel } from './DebugSignupPanel';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;

export default function WelcomeScreen() {
  const nav = useNavigation<Nav>();
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setLoading(true);
    try {
      const installed = await PubkyRingAuthService.isPubkyRingInstalled();
      if (!installed) {
        Alert.alert(
          'pubky-ring Not Found',
          'Install pubky-ring to manage your identity. It acts as a secure keystore for Hypercolor.',
          [{ text: 'OK' }],
        );
        return;
      }

      // Use a stable device ID derived from the bundle ID + a random suffix per session
      const deviceId = `hypercolor-${Date.now().toString(16)}`;
      await PubkyRingAuthService.requestDelegation(deviceId);

      // Navigate to waiting screen — the deep link callback will complete auth
      nav.navigate('AwaitingRingAuth');
    } catch (err) {
      Alert.alert('Error', (err as Error).message ?? 'Failed to open pubky-ring');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="welcomeScreen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Text style={styles.logo}>hypercolor</Text>
          <Text style={styles.tagline}>Private. Decentralized. Yours.</Text>
        </View>

        <View style={styles.actions}>
          <Text style={styles.hint}>
            Your identity is managed by <Text style={styles.hintBold}>pubky-ring</Text>.{'\n'}
            Hypercolor never holds your private key.
          </Text>

          <TouchableOpacity
            testID="welcomeConnectRing"
            accessibilityLabel="Connect with pubky-ring"
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleConnect}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Connect with pubky-ring</Text>
            )}
          </TouchableOpacity>

          {__DEV__ ? <DebugSignupPanel title="Debug signup" submitLabel="Debug signup" /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  logo: {
    fontSize: 40,
    fontWeight: '700',
    color: '#7c3aed',
    letterSpacing: -1,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  actions: {
    paddingHorizontal: 32,
    paddingBottom: 48,
    gap: 20,
  },
  hint: {
    fontSize: 14,
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 20,
  },
  hintBold: {
    color: '#7c3aed',
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
