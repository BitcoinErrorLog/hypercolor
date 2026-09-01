import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types';
import { AuthQr } from '../../components/AuthQr';
import { LinkService } from '../../services/link/LinkService';
import { copyText } from '../../utils/copyText';
import {
  createEnableMessagingController,
  INITIAL_ENABLE_MESSAGING_STATE,
  type EnableMessagingController,
  type EnableMessagingState,
} from './enableMessagingController';

type Nav = NativeStackNavigationProp<RootStackParamList, 'EnableMessaging'>;

function statusLabel(state: EnableMessagingState): string {
  switch (state.phase) {
    case 'checking':
      return 'Checking messaging status…';
    case 'native-missing':
      return 'Native module missing';
    case 'enabled':
      return 'Already enabled';
    case 'session-offline':
      return 'Session offline';
    case 'authorizing':
      return 'Waiting for Pubky Ring…';
    case 'success':
      return 'Encrypted messaging enabled';
    case 'error':
      return 'Enable failed';
  }
}

export default function EnableMessagingScreen() {
  const nav = useNavigation<Nav>();
  const controllerRef = useRef<EnableMessagingController | null>(null);
  const [state, setState] = useState<EnableMessagingState>(INITIAL_ENABLE_MESSAGING_STATE);

  useEffect(() => {
    const controller = createEnableMessagingController({
      getEnableStatus: () => LinkService.getEnableStatus(),
      enable: () => LinkService.enable(),
      openUrl: url => Linking.openURL(url),
      copyText,
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setState);
    void controller.start();
    return () => {
      unsubscribe();
      controller.cancel();
      controllerRef.current = null;
    };
  }, []);

  function handleCancel() {
    controllerRef.current?.cancel();
    nav.goBack();
  }

  const showAuthUrl = state.phase === 'authorizing' && state.authorizationUrl !== null;
  const canRetry =
    state.phase === 'error' || state.phase === 'session-offline' || state.phase === 'enabled';

  return (
    <SafeAreaView style={styles.container} testID="enableMessagingScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="enableMessagingBack"
          accessibilityLabel="Back"
          onPress={handleCancel}
        >
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Messaging</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Enable encrypted messaging</Text>
        <Text style={styles.explanation}>
          Encrypted DMs and homeserver writes share one Paykit session. Approve{' '}
          <Text style={styles.emphasis}>/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw</Text> in Pubky
          Ring. Hypercolor never holds your identity secret.
        </Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text testID="enableMessagingStatus" style={styles.statusValue}>
            {statusLabel(state)}
          </Text>
          {state.message ? <Text style={styles.statusMessage}>{state.message}</Text> : null}
          {state.pubky ? (
            <Text style={styles.mono} numberOfLines={1} ellipsizeMode="middle">
              {state.pubky}
            </Text>
          ) : null}
          {state.receiverPath ? (
            <Text style={styles.hint}>Receiver path {state.receiverPath}</Text>
          ) : null}
        </View>

        {state.phase === 'checking' || state.phase === 'authorizing' ? (
          <ActivityIndicator size="large" color="#7c3aed" style={styles.spinner} />
        ) : null}

        {showAuthUrl && state.authorizationUrl ? (
          <View style={styles.urlBlock}>
            <Text style={styles.sectionTitle}>Authorization URL</Text>
            <Text testID="enableMessagingScanHint" style={styles.scanHint}>
              Scan with Pubky Ring on this or another device.
            </Text>
            <AuthQr value={state.authorizationUrl} />
            <Text
              style={styles.authUrl}
              selectable
              onPress={() => {
                void controllerRef.current?.openRing();
              }}
            >
              {state.authorizationUrl}
            </Text>
            <TouchableOpacity
              testID="enableMessagingOpenRing"
              accessibilityLabel="Open Pubky Ring"
              style={styles.primaryButton}
              onPress={() => {
                void controllerRef.current?.openRing();
              }}
            >
              <Text style={styles.primaryButtonText}>Open Pubky Ring</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="enableMessagingCopy"
              style={styles.secondaryButton}
              onPress={() => controllerRef.current?.copyAuthorizationUrl()}
            >
              <Text style={styles.secondaryButtonText}>
                {state.copied ? 'Copied' : 'Copy authorization URL'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {state.phase === 'success' ? (
          <Text style={styles.success}>
            Ring approved the grant and this device published a receiver marker. You can leave this
            screen.
          </Text>
        ) : null}

        {canRetry ? (
          <TouchableOpacity
            testID="enableMessagingRetry"
            accessibilityLabel={state.phase === 'enabled' ? 'Authorize again' : 'Try again'}
            style={styles.primaryButton}
            onPress={() => {
              void controllerRef.current?.beginAuth();
            }}
          >
            <Text style={styles.primaryButtonText}>
              {state.phase === 'enabled' ? 'Authorize again' : 'Try again'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
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
  back: { color: '#7c3aed', fontSize: 16, width: 60 },
  title: { fontSize: 17, fontWeight: '600', color: '#f9fafb' },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: '#f9fafb' },
  explanation: { fontSize: 15, color: '#6b7280', lineHeight: 22 },
  emphasis: { color: '#7c3aed', fontWeight: '600' },
  statusCard: {
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1a1a1a',
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statusValue: { fontSize: 16, fontWeight: '600', color: '#f9fafb' },
  statusMessage: { fontSize: 14, color: '#9ca3af', lineHeight: 20 },
  mono: { fontSize: 12, color: '#6b7280', fontFamily: 'monospace' },
  hint: { fontSize: 12, color: '#4b5563' },
  spinner: { marginVertical: 8 },
  urlBlock: { gap: 12 },
  scanHint: { fontSize: 14, color: '#9ca3af', lineHeight: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
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
  success: { fontSize: 15, color: '#86efac', lineHeight: 22 },
});
