import React from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AuthQr } from '../../components/AuthQr';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { color, space, radius, typeRole, measure } from '../../theme';

export type AwaitPhase = 'waiting' | 'expired' | 'denied' | 'offline';

export type AwaitingRingAuthScreenContentProps = {
  phase: AwaitPhase;
  ringAuthUrl: string;
  copied: boolean;
  delegationBusy: boolean;
  onCancel: () => void;
  onOpenRing: () => void;
  onCopy: () => void;
  onGenerateNew: () => void;
  onTryAgain: () => void;
};

export function AwaitingRingAuthScreenContent({
  phase,
  ringAuthUrl,
  copied,
  delegationBusy,
  onCancel,
  onOpenRing,
  onCopy,
  onGenerateNew,
  onTryAgain,
}: AwaitingRingAuthScreenContentProps): React.ReactElement {
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
            onPress={onCancel}
            style={styles.backHit}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.content}>
          {phase === 'waiting' ? (
            <ActivityIndicator size="large" color={color.brand} style={styles.spinner} />
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
              <Text selectable style={styles.hint} testID="mask-auth-url">
                {ringAuthUrl}
              </Text>
              <TouchableOpacity
                testID="awaitingRingAuthOpenRing"
                accessibilityRole="button"
                accessibilityLabel={COPY.openPubkyRing}
                style={styles.primaryButton}
                onPress={onOpenRing}
              >
                <Text style={styles.primaryButtonText}>{COPY.openPubkyRing}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="awaitingRingAuthCopy"
                accessibilityRole="button"
                accessibilityLabel={COPY.copyPaykitConnectUrl}
                style={styles.secondaryButton}
                onPress={onCopy}
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
              accessibilityState={{ busy: delegationBusy, disabled: delegationBusy }}
              disabled={delegationBusy}
              style={[styles.primaryButton, delegationBusy && styles.buttonDisabled]}
              onPress={onGenerateNew}
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
                accessibilityState={{ busy: delegationBusy, disabled: delegationBusy }}
                disabled={delegationBusy}
                style={[styles.primaryButton, delegationBusy && styles.buttonDisabled]}
                onPress={onTryAgain}
              >
                {delegationBusy ? (
                  <ActivityIndicator color={color.textOnBrand} />
                ) : (
                  <Text style={styles.primaryButtonText}>{COPY.tryAgain}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                testID="awaitingRingAuthSecondaryCancel"
                accessibilityRole="button"
                accessibilityLabel={COPY.cancel}
                style={styles.secondaryButton}
                onPress={onCancel}
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
  container: { flex: 1, backgroundColor: color.canvas },
  scroll: { flexGrow: 1, paddingBottom: space.xxl },
  header: { paddingHorizontal: space.lg, paddingTop: space.sm },
  backHit: { minWidth: measure.hitTarget, minHeight: measure.hitTarget, justifyContent: 'center' },
  backText: { color: color.brandText, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xxxl,
    paddingTop: space.lg,
    gap: space.lg,
  },
  spinner: { marginBottom: space.sm },
  title: {
    fontSize: typeRole.heading.fontSize,
    fontWeight: '700',
    color: color.textPrimary,
    textAlign: 'center',
  },
  description: {
    fontSize: typeRole.callout.fontSize,
    color: color.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
  },
  urlBlock: { width: '100%', gap: space.md, marginTop: space.sm },
  sectionTitle: {
    fontSize: typeRole.meta.fontSize,
    fontWeight: '600',
    color: color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hint: { fontSize: typeRole.caption.fontSize, color: color.textMuted, lineHeight: 20 },
  primaryButton: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    color: color.textOnBrand,
    fontSize: typeRole.body.fontSize,
    fontWeight: '600',
  },
  buttonDisabled: { opacity: 0.6 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  secondaryButtonText: { color: color.textMuted, fontSize: typeRole.body.fontSize },
});
