import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types';
import { PubkyRingAuthService } from '../../services/PubkyRingAuthService';
import { DebugSignupPanel } from './DebugSignupPanel';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ErrorDetails } from '../../ui/ErrorDetails';
import { sanitizeError } from '../../ui/sanitizedError';
import { ConfirmSheet } from '../../ui/contacts/ConfirmSheet';
import { PubkyService } from '../../services/PubkyService';
import { color, space, radius, typeRole, measure } from '../../theme';
import {
  finishConnectDelegation,
  subscribeConnectDelegationIdle,
  tryBeginConnectDelegation,
} from '../../ui/connectDelegationStart';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;

export default function WelcomeScreen() {
  const nav = useNavigation<Nav>();
  const [loading, setLoading] = useState(false);
  const [connectPending, setConnectPending] = useState(false);
  const [error, setError] = useState<{ message: string; details: string | null } | null>(null);
  const [resetAvailable, setResetAvailable] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const connectTokenRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      setLoading(false);
      setConnectPending(false);
      let cancelled = false;
      void PubkyService.shouldOfferResetAfterFailedWipe().then(offer => {
        if (!cancelled) setResetAvailable(offer);
      });
      return () => {
        cancelled = true;
        const token = connectTokenRef.current;
        if (token != null) {
          finishConnectDelegation(token);
        }
      };
    }, []),
  );

  useEffect(() => {
    return subscribeConnectDelegationIdle(() => {
      setConnectPending(false);
    });
  }, []);

  async function handleConnect() {
    if (loading) return;
    const token = tryBeginConnectDelegation();
    if (token == null) {
      setConnectPending(true);
      return;
    }
    connectTokenRef.current = token;
    setConnectPending(false);
    setLoading(true);
    setError(null);
    try {
      await PubkyService.awaitSignOutWipe();
      const deviceId = `hypercolor-${Date.now().toString(16)}`;
      const { url, expiresAt, generation } = await PubkyRingAuthService.requestDelegation(deviceId);
      nav.navigate('AwaitingRingAuth', { ringAuthUrl: url, expiresAt, generation });
    } catch (err) {
      if (!PubkyRingAuthService.isStaleDelegationRequestError(err)) {
        const sanitized = sanitizeError(err, COPY.couldNotStartAuthorization);
        setError({ message: sanitized.message, details: sanitized.details });
      }
    } finally {
      finishConnectDelegation(token);
      if (connectTokenRef.current === token) {
        connectTokenRef.current = null;
      }
      setLoading(false);
    }
  }

  async function handleResetConfirm() {
    if (resetBusy) return;
    setResetBusy(true);
    setError(null);
    try {
      await PubkyService.resetAppDataAfterFailedWipe();
      setResetOpen(false);
      setResetAvailable(false);
    } catch (err) {
      const sanitized = sanitizeError(err, COPY.resetAppDataFailed);
      setError({ message: sanitized.message, details: sanitized.details });
    } finally {
      setResetBusy(false);
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
            accessibilityState={{ busy: loading || connectPending, disabled: loading }}
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={() => {
              void handleConnect();
            }}
            disabled={loading}
          >
            <View style={styles.primaryButtonInner}>
              {loading || connectPending ? <ActivityIndicator color={color.textOnBrand} /> : null}
              <Text style={styles.primaryButtonText}>{COPY.connectWithPubkyRing}</Text>
            </View>
          </TouchableOpacity>

          {resetAvailable ? (
            <TouchableOpacity
              testID="welcomeResetAppData"
              accessibilityRole="button"
              accessibilityLabel={COPY.resetAppData}
              accessibilityState={{ busy: resetBusy, disabled: resetBusy }}
              style={styles.resetButton}
              onPress={() => {
                setResetOpen(true);
              }}
              disabled={resetBusy}
            >
              <Text style={styles.resetButtonText}>{COPY.resetAppData}</Text>
            </TouchableOpacity>
          ) : null}

          {__DEV__ ? (
            <DebugSignupPanel title="Debug signup" submitLabel="Debug signup" e2eSlot="a" />
          ) : null}
        </View>
      </ScrollView>
      <ConfirmSheet
        visible={resetOpen}
        title={COPY.resetAppDataTitle}
        body={COPY.resetAppDataBody}
        confirmLabel={COPY.resetAppData}
        destructive
        onConfirm={() => {
          void handleResetConfirm();
        }}
        onDismiss={() => {
          if (!resetBusy) setResetOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  scroll: {
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xxxl,
    paddingTop: space.xxxl + space.lg,
    gap: space.lg,
  },
  logo: {
    fontSize: typeRole.display.fontSize,
    fontWeight: '700',
    color: color.brand,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: typeRole.body.fontSize,
    color: color.textSecondary,
    textAlign: 'center',
  },
  hint: {
    fontSize: typeRole.secondary.fontSize,
    color: color.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    paddingHorizontal: space.xxxl,
    paddingBottom: space.xxxl + space.lg,
    gap: space.xl,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: color.danger,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  errorText: { color: color.danger, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
  primaryButton: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    alignItems: 'center',
  },
  primaryButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: color.textOnBrand,
    fontSize: typeRole.body.fontSize,
    fontWeight: '600',
  },
  resetButton: {
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
  },
  resetButtonText: {
    color: color.danger,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
