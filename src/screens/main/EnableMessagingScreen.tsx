import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Linking,
  AppState,
  BackHandler,
  type AppStateStatus,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types';
import { AuthQr } from '../../components/AuthQr';
import { LinkService } from '../../services/link/LinkService';
import { copyText } from '../../utils/copyText';
import { COPY, RING_GRANT_SCOPE_DETAIL } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ErrorDetails } from '../../ui/ErrorDetails';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { subscribeEnableMessagingResume } from '../../ui/enableMessagingResume';
import { color, space, radius, typeRole, measure } from '../../theme';
import {
  createEnableMessagingController,
  INITIAL_ENABLE_MESSAGING_STATE,
  type EnableMessagingController,
  type EnableMessagingPhase,
  type EnableMessagingState,
} from './enableMessagingController';

type Nav = NativeStackNavigationProp<RootStackParamList, 'EnableMessaging'>;

export function enableStatusLabel(phase: EnableMessagingPhase): string {
  switch (phase) {
    case 'checking':
      return COPY.checkingMessaging;
    case 'native-missing':
      return COPY.messagingUnavailable;
    case 'needs-enable':
      return COPY.messagingNotEnabled;
    case 'session-offline':
      return COPY.sessionOffline;
    case 'authorizing':
      return COPY.waitingForRing;
    case 'expired':
      return COPY.authorizationExpired;
    case 'denied':
      return COPY.authorizationDeclined;
    case 'success':
      return COPY.encryptedMessagingEnabled;
    case 'error':
      return COPY.couldNotStartAuthorization;
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

  const handleDone = useCallback(() => {
    if (state.phase !== 'success') {
      controllerRef.current?.cancel();
    }
    nav.goBack();
  }, [nav, state.phase]);

  const handleOpenChats = useCallback(() => {
    nav.reset({
      index: 0,
      routes: [{ name: 'Main', params: { screen: 'Chats' } }],
    });
  }, [nav]);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') {
        void controllerRef.current?.onAppActive();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    const unsubResume = subscribeEnableMessagingResume(() => {
      void controllerRef.current?.onAppActive();
    });
    return () => {
      sub.remove();
      unsubResume();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleDone();
      return true;
    });
    return () => sub.remove();
  }, [handleDone]);

  const handleBeginAuth = useCallback(() => {
    void controllerRef.current?.beginAuth();
  }, []);

  const handleOpenRing = useCallback(() => {
    void controllerRef.current?.openRing();
  }, []);

  const handleRetry = useCallback(() => {
    void controllerRef.current?.retry();
  }, []);

  const handleCopyAuth = useCallback(() => {
    controllerRef.current?.copyAuthorizationUrl();
  }, []);

  const showAuthUrl = state.phase === 'authorizing' && state.authorizationUrl !== null;
  const primaryLabel =
    state.phase === 'needs-enable'
      ? COPY.enableEncryptedMessaging
      : state.phase === 'authorizing'
        ? COPY.openPubkyRing
        : state.phase === 'expired'
          ? COPY.generateNewAuthorization
          : state.phase === 'denied' || state.phase === 'error' || state.phase === 'session-offline'
            ? COPY.tryAgain
            : state.phase === 'success'
              ? COPY.openChats
              : null;
  const secondaryLabel =
    state.phase === 'native-missing'
      ? COPY.back
      : state.phase === 'needs-enable'
        ? COPY.notNow
        : state.phase === 'expired' ||
            state.phase === 'denied' ||
            state.phase === 'session-offline' ||
            state.phase === 'error'
          ? COPY.cancel
          : state.phase === 'success'
            ? COPY.done
            : null;

  return (
    <SafeAreaView style={styles.container} testID="enableMessagingScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="enableMessagingBack"
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={HIT_SLOP_44}
          onPress={handleDone}
          style={styles.backHit}
        >
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{COPY.enableEncryptedMessaging}</Text>
        <View style={styles.backHit} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{COPY.enableEncryptedMessaging}</Text>
        <Text style={styles.explanation}>{COPY.approveScopesBody}</Text>
        <Text style={styles.scopeDetail}>{RING_GRANT_SCOPE_DETAIL}</Text>

        <View
          style={styles.statusCard}
          accessibilityRole="summary"
          accessibilityLabel={enableStatusLabel(state.phase)}
        >
          <Text style={styles.statusLabel}>Status</Text>
          <Text testID="enableMessagingStatus" style={styles.statusValue}>
            {enableStatusLabel(state.phase)}
          </Text>
          {state.message ? <Text style={styles.statusMessage}>{state.message}</Text> : null}
          {state.details ? <ErrorDetails details={state.details} /> : null}
        </View>

        {state.phase === 'checking' ? (
          <ActivityIndicator size="large" color={color.brand} style={styles.spinner} />
        ) : null}

        {showAuthUrl && state.authorizationUrl ? (
          <View style={styles.urlBlock}>
            <Text testID="enableMessagingScanHint" style={styles.scanHint}>
              {COPY.waitingForRingBody}
            </Text>
            <AuthQr value={state.authorizationUrl} />
            <Text selectable style={styles.scopeDetail}>
              {state.authorizationUrl}
            </Text>
          </View>
        ) : null}

        {state.phase === 'success' ? (
          <View style={styles.successBlock} testID="enableMessagingSuccess">
            <View
              style={styles.successGlyph}
              accessibilityRole="image"
              accessibilityLabel="Enabled"
            >
              <Text style={styles.successGlyphMark}>✓</Text>
            </View>
            <Text style={styles.successTitle}>{COPY.encryptedMessagingEnabled}</Text>
            <Text style={styles.successBody}>{COPY.encryptedMessagingEnabledBody}</Text>
          </View>
        ) : null}

        {primaryLabel ? (
          <TouchableOpacity
            testID={
              state.phase === 'success'
                ? 'enableMessagingOpenChats'
                : state.phase === 'authorizing'
                  ? 'enableMessagingOpenRing'
                  : state.phase === 'needs-enable'
                    ? 'enableMessagingStart'
                    : 'enableMessagingRetry'
            }
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            accessibilityState={{
              busy: state.starting && state.phase === 'needs-enable',
              disabled: state.starting && state.phase === 'needs-enable',
            }}
            style={[
              styles.primaryButton,
              state.starting && state.phase === 'needs-enable' && styles.buttonDisabled,
            ]}
            disabled={state.starting && state.phase === 'needs-enable'}
            onPress={
              state.phase === 'success'
                ? handleOpenChats
                : state.phase === 'authorizing'
                  ? handleOpenRing
                  : state.phase === 'denied' ||
                      state.phase === 'error' ||
                      state.phase === 'session-offline'
                    ? handleRetry
                    : handleBeginAuth
            }
          >
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </TouchableOpacity>
        ) : null}

        {state.phase === 'authorizing' ? (
          <TouchableOpacity
            testID="enableMessagingCopy"
            accessibilityRole="button"
            accessibilityLabel={COPY.copyAuthorizationUrl}
            style={styles.secondaryButton}
            onPress={handleCopyAuth}
          >
            <Text style={styles.secondaryButtonText}>
              {state.copied ? COPY.copied : COPY.copyAuthorizationUrl}
            </Text>
          </TouchableOpacity>
        ) : secondaryLabel ? (
          <TouchableOpacity
            testID={state.phase === 'success' ? 'enableMessagingDone' : 'enableMessagingSecondary'}
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
            style={state.phase === 'success' ? styles.textButton : styles.secondaryButton}
            onPress={handleDone}
          >
            <Text
              style={state.phase === 'success' ? styles.textButtonText : styles.secondaryButtonText}
            >
              {secondaryLabel}
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.custodyWrap}>
          <CustodyLine />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  backHit: { minWidth: measure.hitTarget, minHeight: measure.hitTarget, justifyContent: 'center' },
  back: { color: color.brandText, fontSize: typeRole.body.fontSize },
  title: {
    flex: 1,
    fontSize: typeRole.titleStack.fontSize,
    fontWeight: '600',
    color: color.textPrimary,
    textAlign: 'center',
  },
  content: { paddingHorizontal: space.xl, paddingVertical: space.xxl, gap: space.lg, flexGrow: 1 },
  heading: { fontSize: typeRole.heading.fontSize, fontWeight: '700', color: color.textPrimary },
  explanation: { fontSize: typeRole.callout.fontSize, color: color.textSecondary, lineHeight: 22 },
  scopeDetail: {
    fontSize: typeRole.caption.fontSize,
    color: color.textSecondary,
    fontFamily: 'monospace',
  },
  statusCard: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.surfaceRaised,
  },
  statusLabel: {
    fontSize: typeRole.meta.fontSize,
    fontWeight: '600',
    color: color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statusValue: { fontSize: typeRole.body.fontSize, fontWeight: '600', color: color.textPrimary },
  statusMessage: { fontSize: typeRole.secondary.fontSize, color: color.textMuted, lineHeight: 20 },
  spinner: { marginVertical: space.sm },
  urlBlock: { gap: space.md },
  scanHint: { fontSize: typeRole.secondary.fontSize, color: color.textMuted, lineHeight: 20 },
  successBlock: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  successGlyph: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: color.surfaceBrand,
    borderWidth: 2,
    borderColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successGlyphMark: {
    color: color.success,
    fontSize: typeRole.display.fontSize,
    fontWeight: '700',
  },
  successTitle: {
    fontSize: typeRole.heading.fontSize,
    fontWeight: '700',
    color: color.textPrimary,
    textAlign: 'center',
  },
  successBody: {
    fontSize: typeRole.callout.fontSize,
    color: color.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: {
    color: color.textOnBrand,
    fontSize: typeRole.body.fontSize,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    alignItems: 'center',
  },
  secondaryButtonText: { color: color.textMuted, fontSize: typeRole.body.fontSize },
  textButton: { minHeight: measure.hitTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { color: color.brandText, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  custodyWrap: { marginTop: 'auto', paddingTop: space.xxl, paddingBottom: space.sm },
});
