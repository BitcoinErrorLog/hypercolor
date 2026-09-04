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
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ErrorDetails } from '../../ui/ErrorDetails';
import { ConfirmSheet } from '../../ui/contacts/ConfirmSheet';
import { color, space, radius, typeRole, measure } from '../../theme';

export type WelcomeScreenContentProps = {
  loading: boolean;
  connectPending: boolean;
  error: { message: string; details: string | null } | null;
  resetAvailable: boolean;
  resetOpen: boolean;
  resetBusy: boolean;
  showDebugPanel?: boolean;
  debugPanel?: React.ReactNode;
  onConnect: () => void;
  onOpenReset: () => void;
  onConfirmReset: () => void;
  onDismissReset: () => void;
};

/** Presentational Welcome surface for the product screen and VRT catalog. */
export function WelcomeScreenContent({
  loading,
  connectPending,
  error,
  resetAvailable,
  resetOpen,
  resetBusy,
  showDebugPanel = false,
  debugPanel = null,
  onConnect,
  onOpenReset,
  onConfirmReset,
  onDismissReset,
}: WelcomeScreenContentProps): React.ReactElement {
  return (
    <SafeAreaView style={styles.container} testID="welcomeScreen">
      {__DEV__ ? <View testID="e2eClipboardChannel" /> : null}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <View
            style={styles.brandMark}
            accessibilityRole="image"
            accessibilityLabel="Hypercolor mark"
          >
            <View style={styles.brandMarkCore} />
          </View>
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
            onPress={onConnect}
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
              onPress={onOpenReset}
              disabled={resetBusy}
            >
              <Text style={styles.resetButtonText}>{COPY.resetAppData}</Text>
            </TouchableOpacity>
          ) : null}

          {showDebugPanel ? debugPanel : null}
        </View>
      </ScrollView>
      <ConfirmSheet
        visible={resetOpen}
        title={COPY.resetAppDataTitle}
        body={COPY.resetAppDataBody}
        confirmLabel={COPY.resetAppData}
        destructive
        onConfirm={onConfirmReset}
        onDismiss={onDismissReset}
      />
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
    paddingTop: space.xxxl + space.lg,
    gap: space.lg,
  },
  logo: {
    fontSize: typeRole.display.fontSize,
    fontWeight: '700',
    color: color.brand,
    letterSpacing: -1,
  },
  brandMark: {
    width: space.xxxl,
    height: space.xxxl,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkCore: {
    width: space.xl,
    height: space.xl,
    borderRadius: radius.full,
    backgroundColor: color.brand,
  },
  tagline: {
    fontSize: typeRole.title.fontSize,
    lineHeight: typeRole.title.lineHeight,
    fontWeight: typeRole.title.fontWeight,
    color: color.textPrimary,
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
  buttonDisabled: { opacity: 0.6 },
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
