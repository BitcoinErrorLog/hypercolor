import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthQr } from '../../components/AuthQr';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { color, space, typeRole } from '../../theme';
import { Button, ErrorState, LoadingState, PageHeader } from '../../ui/primitives';
import { copyText } from '../../utils/copyText';

export type AwaitPhase = 'waiting' | 'expired' | 'denied' | 'offline' | 'confirm';

export type AwaitingRingAuthScreenContentProps = {
  phase: AwaitPhase;
  ringAuthUrl: string;
  confirmPubky?: string | null;
  ringInstalled?: boolean;
  delegationBusy: boolean;
  onCancel: () => void;
  onOpenRing: () => void;
  onInstallRing?: () => void;
  onGenerateNew: () => void;
  onTryAgain: () => void;
  onConfirmIdentity?: () => void;
};

export function AwaitingRingAuthScreenContent({
  phase,
  ringAuthUrl,
  confirmPubky,
  ringInstalled = true,
  delegationBusy,
  onCancel,
  onOpenRing,
  onInstallRing,
  onGenerateNew,
  onTryAgain,
  onConfirmIdentity,
}: AwaitingRingAuthScreenContentProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const title =
    phase === 'expired'
      ? COPY.authorizationExpired
      : phase === 'denied'
        ? COPY.authorizationDeclined
        : phase === 'offline'
          ? COPY.sessionOffline
          : phase === 'confirm'
            ? COPY.confirmThisIdentity
            : COPY.waitingForRing;
  const body =
    phase === 'expired'
      ? COPY.welcomeExpiredBody
      : phase === 'denied'
        ? COPY.authorizationDeclinedBody
        : phase === 'offline'
          ? COPY.welcomeOffline
          : phase === 'confirm'
            ? COPY.confirmThisIdentityBody
            : COPY.waitingForRingBody;

  return (
    <SafeAreaView style={styles.container} testID="awaitingRingAuthScreen">
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: space.xl + insets.bottom }]}
      >
        <PageHeader
          title={COPY.connectWithPubkyRing}
          onBack={onCancel}
          backLabel={COPY.back}
          backAccessibilityLabel="Cancel Pubky Ring connection"
          backTestID="awaitingRingAuthCancel"
          testID="awaitingRingAuth"
        />
        <View style={styles.content}>
          {phase === 'waiting' ? (
            <LoadingState label={COPY.waitingForRing} testID="awaitingRingAuthWaiting" />
          ) : phase === 'confirm' ? (
            <Text testID="awaitingRingAuthConfirmTitle" style={styles.title}>
              {title}
            </Text>
          ) : (
            <ErrorState title={title} body={body} testID="awaitingRingAuthError" />
          )}
          {phase === 'waiting' ? (
            <Text testID="awaitingRingAuthScanHint" style={styles.description}>
              {body}
            </Text>
          ) : null}
          {phase === 'waiting' && ringAuthUrl ? (
            <View style={styles.urlBlock}>
              <Text style={styles.sectionTitle}>{COPY.authorizationUrlLabel}</Text>
              <AuthQr value={ringAuthUrl} accessibilityLabel={COPY.waitingForRingBody} />
              <Button
                testID="awaitingRingAuthOpenRing"
                label={COPY.openPubkyRing}
                onPress={onOpenRing}
              />
              <Button
                testID="awaitingRingAuthCopyAuthorization"
                label={copied ? COPY.copied : COPY.copyAuthorizationUrl}
                variant="secondary"
                onPress={() => {
                  copyText(ringAuthUrl);
                  setCopied(true);
                }}
              />
              {!ringInstalled && onInstallRing ? (
                <Button
                  testID="awaitingRingAuthInstallRing"
                  label={COPY.installPubkyRing}
                  variant="secondary"
                  onPress={onInstallRing}
                />
              ) : null}
            </View>
          ) : null}
          {phase === 'confirm' && confirmPubky ? (
            <View style={styles.urlBlock}>
              <Text testID="awaitingRingAuthConfirmPubky" selectable style={styles.pubky}>
                {confirmPubky}
              </Text>
              <Button
                testID="awaitingRingAuthCopyPubky"
                label={COPY.copyPubky}
                variant="secondary"
                onPress={() => copyText(confirmPubky)}
              />
              <Button
                testID="awaitingRingAuthConfirm"
                label={COPY.confirmThisIdentity}
                onPress={() => {
                  onConfirmIdentity?.();
                }}
              />
            </View>
          ) : null}
          {phase === 'expired' ? (
            <Button
              testID="awaitingRingAuthGenerateNew"
              accessibilityLabel={COPY.generateNewLink}
              accessibilityState={{ busy: delegationBusy, disabled: delegationBusy }}
              disabled={delegationBusy}
              busy={delegationBusy}
              label={COPY.generateNewLink}
              onPress={onGenerateNew}
            />
          ) : null}
          {phase === 'denied' || phase === 'offline' ? (
            <>
              <Button
                testID="awaitingRingAuthTryAgain"
                accessibilityLabel={COPY.tryAgain}
                accessibilityState={{ busy: delegationBusy, disabled: delegationBusy }}
                disabled={delegationBusy}
                busy={delegationBusy}
                label={COPY.tryAgain}
                onPress={onTryAgain}
              />
              <Button
                testID="awaitingRingAuthSecondaryCancel"
                accessibilityLabel={COPY.cancel}
                label={COPY.cancel}
                variant="secondary"
                onPress={onCancel}
              />
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
  scroll: { flexGrow: 1 },
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
  pubky: {
    fontSize: typeRole.callout.fontSize,
    color: color.textPrimary,
    fontFamily: 'Menlo',
    textAlign: 'center',
  },
});
