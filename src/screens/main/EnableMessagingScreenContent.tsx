import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthQr } from '../../components/AuthQr';
import { COPY, RING_GRANT_SCOPE_DETAIL } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ErrorDetails } from '../../ui/ErrorDetails';
import { color, space, radius, typeRole } from '../../theme';
import { Button, ErrorState, LoadingState, PageHeader, StatusBanner } from '../../ui/primitives';
import { type EnableMessagingPhase, type EnableMessagingState } from './enableMessagingController';

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

export function formatEnableRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(clamped / 60)).padStart(2, '0');
  const ss = String(clamped % 60).padStart(2, '0');
  return `Remaining: ${mm}:${ss}`;
}

export type EnableMessagingScreenContentProps = {
  state: EnableMessagingState;
  remainingLabel?: string | null;
  onBack: () => void;
  onPrimary: () => void;
  onSecondary: () => void;
  onCopyAuth: () => void;
};

export function EnableMessagingScreenContent({
  state,
  remainingLabel = null,
  onBack,
  onPrimary,
  onSecondary,
  onCopyAuth,
}: EnableMessagingScreenContentProps): React.ReactElement {
  const insets = useSafeAreaInsets();
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

  const countdown = state.phase === 'authorizing' && remainingLabel ? remainingLabel : null;
  const isFailure =
    state.phase === 'expired' ||
    state.phase === 'denied' ||
    state.phase === 'error' ||
    state.phase === 'native-missing' ||
    state.phase === 'session-offline';
  const showStatusCard = !isFailure;

  return (
    <SafeAreaView style={styles.container} testID="enableMessagingScreen">
      <PageHeader title={COPY.enableEncryptedMessaging} onBack={onBack} testID="enableMessaging" />

      <ScrollView
        testID="enableMessagingScroll"
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom:
              space.xl + Math.max(insets.bottom, 0) + (countdown ? space.xxxl + space.xl : 0),
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>{COPY.enableEncryptedMessaging}</Text>
        <Text style={styles.explanation}>{COPY.approveScopesBody}</Text>
        <Text style={styles.scopeDetail}>{RING_GRANT_SCOPE_DETAIL}</Text>

        {showStatusCard ? (
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
        ) : null}

        {state.phase === 'checking' ? (
          <LoadingState label={COPY.checkingMessaging} testID="enableMessagingLoading" />
        ) : null}

        {isFailure ? (
          <ErrorState
            title={enableStatusLabel(state.phase)}
            body={state.message ?? COPY.couldNotStartAuthorization}
            details={state.details}
            testID="enableMessagingError"
          />
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
          <StatusBanner
            label={COPY.encryptedMessagingEnabledBody}
            tone="success"
            testID="enableMessagingSuccess"
          />
        ) : null}

        {primaryLabel ? (
          <Button
            testID={
              state.phase === 'success'
                ? 'enableMessagingOpenChats'
                : state.phase === 'authorizing'
                  ? 'enableMessagingOpenRing'
                  : state.phase === 'needs-enable'
                    ? 'enableMessagingStart'
                    : 'enableMessagingRetry'
            }
            accessibilityLabel={primaryLabel}
            accessibilityState={{
              busy: state.starting && state.phase === 'needs-enable',
              disabled: state.starting && state.phase === 'needs-enable',
            }}
            disabled={state.starting && state.phase === 'needs-enable'}
            busy={state.starting && state.phase === 'needs-enable'}
            onPress={onPrimary}
            label={primaryLabel}
          />
        ) : null}

        {state.phase === 'authorizing' ? (
          <Button
            testID="enableMessagingCopy"
            accessibilityLabel={COPY.copyAuthorizationUrl}
            label={state.copied ? COPY.copied : COPY.copyAuthorizationUrl}
            variant="secondary"
            onPress={onCopyAuth}
          />
        ) : secondaryLabel ? (
          <Button
            testID={state.phase === 'success' ? 'enableMessagingDone' : 'enableMessagingSecondary'}
            accessibilityLabel={secondaryLabel}
            label={secondaryLabel}
            variant="secondary"
            onPress={onSecondary}
          />
        ) : null}

        <View style={styles.custodyWrap}>
          <CustodyLine />
        </View>
        {countdown ? (
          <View
            testID="enableMessagingCountdown"
            accessibilityRole="text"
            accessibilityLabel={countdown}
            style={styles.countdownBar}
          >
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.canvas },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingVertical: space.xxl, gap: space.lg },
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
  urlBlock: { gap: space.md },
  scanHint: { fontSize: typeRole.secondary.fontSize, color: color.textMuted, lineHeight: 20 },
  custodyWrap: { paddingTop: space.xxl, paddingBottom: space.sm },
  countdownBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceRaised,
    backgroundColor: color.surface,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    alignItems: 'center',
  },
  countdownText: {
    color: color.textSecondary,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
