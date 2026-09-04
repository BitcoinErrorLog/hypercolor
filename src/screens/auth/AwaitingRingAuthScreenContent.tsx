import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthQr } from '../../components/AuthQr';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { color, space, typeRole } from '../../theme';
import { Button, ErrorState, LoadingState, PageHeader } from '../../ui/primitives';

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
  const insets = useSafeAreaInsets();
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
              <Text style={styles.sectionTitle}>Paykit-connect link</Text>
              <AuthQr value={ringAuthUrl} />
              <Text
                selectable
                style={styles.hint}
                testID="mask-auth-url"
                accessibilityLabel={COPY.waitingForRingBody}
              >
                {ringAuthUrl}
              </Text>
              <Button
                testID="awaitingRingAuthOpenRing"
                label={COPY.openPubkyRing}
                onPress={onOpenRing}
              />
              <Button
                testID="awaitingRingAuthCopy"
                label={copied ? COPY.copied : COPY.copyPaykitConnectUrl}
                variant="secondary"
                onPress={onCopy}
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
  hint: { fontSize: typeRole.caption.fontSize, color: color.textMuted, lineHeight: 20 },
});
