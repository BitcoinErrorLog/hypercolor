import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types';
import { PubkyRingAuthService } from '../../services/PubkyRingAuthService';
import { DebugSignupPanel } from './DebugSignupPanel';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ErrorDetails } from '../../ui/ErrorDetails';
import { sanitizeError } from '../../ui/sanitizedError';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;

export default function WelcomeScreen() {
  const nav = useNavigation<Nav>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; details: string | null } | null>(null);
  const inFlight = useRef(false);
  const startedRef = useRef(false);

  async function handleConnect() {
    if (inFlight.current || loading || startedRef.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const existing = PubkyRingAuthService.getPendingDelegationUrl();
      if (existing) {
        startedRef.current = true;
        nav.navigate('AwaitingRingAuth', { ringAuthUrl: existing });
        return;
      }
      const deviceId = `hypercolor-${Date.now().toString(16)}`;
      const { url } = await PubkyRingAuthService.requestDelegation(deviceId);
      startedRef.current = true;
      nav.navigate('AwaitingRingAuth', { ringAuthUrl: url });
    } catch (err) {
      const sanitized = sanitizeError(err, COPY.couldNotStartAuthorization);
      setError({ message: sanitized.message, details: sanitized.details });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="welcomeScreen">
      {__DEV__ ? <View testID="e2eClipboardChannel" /> : null}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Text style={styles.logo}>hypercolor</Text>
          <Text style={styles.tagline}>Private. Decentralized. Yours.</Text>
          <CustodyLine />
          <Text style={styles.hint}>{COPY.connectExplanation}</Text>
        </View>

        <View style={styles.actions}>
          {error ? (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <Text style={styles.errorText}>{error.message}</Text>
              <ErrorDetails details={error.details} />
            </View>
          ) : null}

          <TouchableOpacity
            testID="welcomeConnectRing"
            accessibilityRole="button"
            accessibilityLabel={COPY.connectWithPubkyRing}
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={() => {
              void handleConnect();
            }}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>{COPY.connectWithPubkyRing}</Text>
            )}
          </TouchableOpacity>

          {__DEV__ ? (
            <DebugSignupPanel title="Debug signup" submitLabel="Debug signup" e2eSlot="a" />
          ) : null}
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
    gap: 16,
  },
  logo: {
    fontSize: 40,
    fontWeight: '700',
    color: '#7c3aed',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    color: '#808692',
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: '#808692',
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    paddingHorizontal: 32,
    paddingBottom: 48,
    gap: 20,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorText: { color: '#fca5a5', fontSize: 14, lineHeight: 20 },
  primaryButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 16,
    minHeight: 44,
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
