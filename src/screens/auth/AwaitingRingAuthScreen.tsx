import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Linking,
  BackHandler,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { AuthStackParamList } from '../../types';
import { AuthQr } from '../../components/AuthQr';
import { copyText } from '../../utils/copyText';
import { COPY, ENABLE_AUTH_TTL_MS } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { PubkyRingAuthService } from '../../services/PubkyRingAuthService';
import { subscribeConnectAuthFeedback } from '../../ui/connectAuthFeedback';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'AwaitingRingAuth'>;
type Route = RouteProp<AuthStackParamList, 'AwaitingRingAuth'>;

type AwaitPhase = 'waiting' | 'expired' | 'denied' | 'offline';

/**
 * Shown after Welcome starts paykit-connect.
 * Completion still arrives via `hypercolor://ring-callback` in RootNavigator.
 */
export default function AwaitingRingAuthScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const initialUrl = route.params?.ringAuthUrl ?? '';
  const [ringAuthUrl, setRingAuthUrl] = useState(initialUrl);
  const [expiresAt, setExpiresAt] = useState(() => {
    return (
      route.params?.expiresAt ??
      PubkyRingAuthService.getPendingDelegationExpiresAt() ??
      Date.now() + ENABLE_AUTH_TTL_MS
    );
  });
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState<AwaitPhase>(() => {
    const expires =
      route.params?.expiresAt ??
      PubkyRingAuthService.getPendingDelegationExpiresAt() ??
      Date.now() + ENABLE_AUTH_TTL_MS;
    return Date.now() >= expires ? 'expired' : 'waiting';
  });

  function handleCopy() {
    if (!ringAuthUrl) return;
    copyText(ringAuthUrl);
    setCopied(true);
  }

  const handleCancel = useCallback(async () => {
    await PubkyRingAuthService.cancelPendingDelegation();
    nav.goBack();
  }, [nav]);

  const startNewDelegation = useCallback(async () => {
    await PubkyRingAuthService.cancelPendingDelegation();
    const deviceId = `hypercolor-${Date.now().toString(16)}`;
    const next = await PubkyRingAuthService.requestDelegation(deviceId);
    setRingAuthUrl(next.url);
    setExpiresAt(next.expiresAt);
    setCopied(false);
    setPhase(Date.now() >= next.expiresAt ? 'expired' : 'waiting');
  }, []);

  const handleGenerateNew = useCallback(async () => {
    await PubkyRingAuthService.cancelPendingDelegation();
    nav.goBack();
  }, [nav]);

  const handleTryAgain = useCallback(async () => {
    if (phase === 'offline' || phase === 'denied' || phase === 'expired') {
      try {
        await startNewDelegation();
      } catch {
        setPhase('offline');
      }
    }
  }, [phase, startNewDelegation]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void handleCancel();
      return true;
    });
    return () => sub.remove();
  }, [handleCancel]);

  useEffect(() => {
    return subscribeConnectAuthFeedback(next => {
      setPhase(next);
    });
  }, []);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const remaining = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
      setPhase('expired');
    }, remaining);
    return () => clearTimeout(timer);
  }, [phase, expiresAt]);

  const title =
    phase === 'expired'
      ? COPY.authorizationExpired
      : phase === 'denied'
        ? COPY.authorizationDeclined
        : phase === 'offline'
          ? COPY.sessionOffline
          : COPY.waitingForRing;
  const body =
    phase === 'expired'
      ? COPY.welcomeExpiredBody
      : phase === 'denied'
        ? COPY.authorizationDeclinedBody
        : phase === 'offline'
          ? COPY.welcomeOffline
          : COPY.waitingForRingBody;

  return (
    <SafeAreaView style={styles.container} testID="awaitingRingAuthScreen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity
            testID="awaitingRingAuthCancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel Pubky Ring connection"
            hitSlop={HIT_SLOP_44}
            onPress={() => {
              void handleCancel();
            }}
            style={styles.backHit}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.content}>
          {phase === 'waiting' ? (
            <ActivityIndicator size="large" color="#7c3aed" style={styles.spinner} />
          ) : null}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{body}</Text>
          {phase === 'waiting' && ringAuthUrl ? (
            <View style={styles.urlBlock}>
              <Text style={styles.sectionTitle}>Paykit-connect link</Text>
              <Text testID="awaitingRingAuthScanHint" style={styles.hint}>
                {COPY.waitingForRingBody}
              </Text>
              <AuthQr value={ringAuthUrl} />
              <Text selectable style={styles.hint}>
                {ringAuthUrl}
              </Text>
              <TouchableOpacity
                testID="awaitingRingAuthOpenRing"
                accessibilityRole="button"
                accessibilityLabel={COPY.openPubkyRing}
                style={styles.primaryButton}
                onPress={() => {
                  void Linking.openURL(ringAuthUrl).catch(() => {
                    setPhase('offline');
                  });
                }}
              >
                <Text style={styles.primaryButtonText}>{COPY.openPubkyRing}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="awaitingRingAuthCopy"
                accessibilityRole="button"
                accessibilityLabel={COPY.copyPaykitConnectUrl}
                style={styles.secondaryButton}
                onPress={handleCopy}
              >
                <Text style={styles.secondaryButtonText}>
                  {copied ? COPY.copied : COPY.copyPaykitConnectUrl}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {phase === 'expired' ? (
            <TouchableOpacity
              testID="awaitingRingAuthGenerateNew"
              accessibilityRole="button"
              accessibilityLabel={COPY.generateNewLink}
              style={styles.primaryButton}
              onPress={() => {
                void handleGenerateNew();
              }}
            >
              <Text style={styles.primaryButtonText}>{COPY.generateNewLink}</Text>
            </TouchableOpacity>
          ) : null}
          {phase === 'denied' || phase === 'offline' ? (
            <>
              <TouchableOpacity
                testID="awaitingRingAuthTryAgain"
                accessibilityRole="button"
                accessibilityLabel={COPY.tryAgain}
                style={styles.primaryButton}
                onPress={() => {
                  void handleTryAgain();
                }}
              >
                <Text style={styles.primaryButtonText}>{COPY.tryAgain}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="awaitingRingAuthSecondaryCancel"
                accessibilityRole="button"
                accessibilityLabel={COPY.cancel}
                style={styles.secondaryButton}
                onPress={() => {
                  void handleCancel();
                }}
              >
                <Text style={styles.secondaryButtonText}>{COPY.cancel}</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <CustodyLine />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { flexGrow: 1, paddingBottom: 24 },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  backHit: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  backText: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 16,
    gap: 16,
  },
  spinner: { marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#f9fafb', textAlign: 'center' },
  description: { fontSize: 15, color: '#808692', lineHeight: 22, textAlign: 'center' },
  urlBlock: { width: '100%', gap: 12, marginTop: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#808692',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hint: { fontSize: 13, color: '#9ca3af', lineHeight: 20 },
  primaryButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 16,
    minHeight: 44,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  secondaryButtonText: { color: '#9ca3af', fontSize: 16 },
});
