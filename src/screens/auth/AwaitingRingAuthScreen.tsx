import React, { useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Linking,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { AuthStackParamList } from '../../types';
import { AuthQr } from '../../components/AuthQr';
import { copyText } from '../../utils/copyText';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'AwaitingRingAuth'>;
type Route = RouteProp<AuthStackParamList, 'AwaitingRingAuth'>;

/**
 * Shown after Welcome starts paykit-connect.
 * Completion still arrives via `hypercolor://ring-callback` in RootNavigator.
 */
export default function AwaitingRingAuthScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const ringAuthUrl = route.params?.ringAuthUrl ?? '';
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!ringAuthUrl) return;
    copyText(ringAuthUrl);
    setCopied(true);
  }

  return (
    <SafeAreaView style={styles.container} testID="awaitingRingAuthScreen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color="#7c3aed" style={styles.spinner} />
          <Text style={styles.title}>Waiting for pubky-ring</Text>
          <Text style={styles.description}>
            Approve the authorization in pubky-ring to continue.{'\n'}
            You&apos;ll be redirected back here automatically.
          </Text>
          {ringAuthUrl ? (
            <View style={styles.urlBlock}>
              <Text style={styles.sectionTitle}>Paykit-connect link</Text>
              <Text testID="awaitingRingAuthScanHint" style={styles.hint}>
                Scan with Bitkit or Pubky Ring on this or another device.
              </Text>
              <AuthQr value={ringAuthUrl} />
              <Text style={styles.authUrl} selectable>
                {ringAuthUrl}
              </Text>
              <TouchableOpacity
                testID="awaitingRingAuthOpenRing"
                accessibilityLabel="Open Pubky Ring"
                style={styles.primaryButton}
                onPress={() => {
                  void Linking.openURL(ringAuthUrl);
                }}
              >
                <Text style={styles.primaryButtonText}>Open Pubky Ring</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="awaitingRingAuthCopy"
                accessibilityLabel="Copy paykit-connect URL"
                style={styles.secondaryButton}
                onPress={handleCopy}
              >
                <Text style={styles.secondaryButtonText}>{copied ? 'Copied' : 'Copy URL'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            testID="awaitingRingAuthCancel"
            style={styles.cancelButton}
            onPress={() => nav.goBack()}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { flexGrow: 1, paddingBottom: 24 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 32,
    gap: 16,
  },
  spinner: { marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#f9fafb', textAlign: 'center' },
  description: { fontSize: 15, color: '#6b7280', lineHeight: 22, textAlign: 'center' },
  urlBlock: { width: '100%', gap: 12, marginTop: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hint: { fontSize: 13, color: '#9ca3af', lineHeight: 20 },
  authUrl: { fontSize: 13, color: '#7c3aed', lineHeight: 20 },
  primaryButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#9ca3af', fontSize: 16 },
  actions: { paddingHorizontal: 32, paddingTop: 16 },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { color: '#9ca3af', fontSize: 16 },
});
