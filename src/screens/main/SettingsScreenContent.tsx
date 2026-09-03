import React from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ErrorDetails } from '../../ui/ErrorDetails';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { shortPubky } from '../../ui/shortPubky';
import type { SessionUiModel } from '../../ui/sessionUi';
import { color, space, radius, typeRole, measure } from '../../theme';

export type SettingsScreenContentProps = {
  pubky: string | null;
  homeserver: string | null;
  session: SessionUiModel;
  meshEnabled: boolean;
  telemetryEnabled: boolean;
  backupBusy: boolean;
  recoveryCode: string | null;
  recoveryConfirmed: boolean;
  recoveryCopied: boolean;
  restoreCode: string;
  restoreNote: string | null;
  restoreError: string | null;
  markedSection: 'backup' | 'payments' | null;
  liveProofSlot?: React.ReactNode;
  paymentsSlot?: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  backupSectionRef?: React.Ref<View>;
  paymentsSectionRef?: React.Ref<View>;
  onBack: () => void;
  onToggleMesh: (value: boolean) => void;
  onToggleTelemetry: (value: boolean) => void;
  onBackup: () => void;
  onCopyRecovery: () => void;
  onToggleRecoveryConfirmed: () => void;
  onRecoveryDone: () => void;
  onChangeRestoreCode: (value: string) => void;
  onRestore: () => void;
  onEnableMessaging: () => void;
  onBackupLayout?: (y: number) => void;
  onPaymentsLayout?: (y: number) => void;
};

export function SettingsScreenContent({
  pubky,
  homeserver,
  session,
  meshEnabled,
  telemetryEnabled,
  backupBusy,
  recoveryCode,
  recoveryConfirmed,
  recoveryCopied,
  restoreCode,
  restoreNote,
  restoreError,
  markedSection,
  liveProofSlot = null,
  paymentsSlot = null,
  scrollRef,
  backupSectionRef,
  paymentsSectionRef,
  onBack,
  onToggleMesh,
  onToggleTelemetry,
  onBackup,
  onCopyRecovery,
  onToggleRecoveryConfirmed,
  onRecoveryDone,
  onChangeRestoreCode,
  onRestore,
  onEnableMessaging,
  onBackupLayout,
  onPaymentsLayout,
}: SettingsScreenContentProps): React.ReactElement {
  return (
    <SafeAreaView style={styles.container} testID="settingsScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="settingsBack"
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={HIT_SLOP_44}
          onPress={onBack}
          style={styles.backHit}
        >
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.backHit} />
      </View>

      <ScrollView ref={scrollRef} testID="settingsScroll" contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Identity</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{pubky ? shortPubky(pubky) : COPY.notConnected}</Text>
          </View>
          {pubky ? (
            <View style={styles.row}>
              <Text style={styles.rowValue} selectable testID="mask-pubky">
                {pubky}
              </Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <CustodyLine />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Homeserver</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Current</Text>
            <Text style={styles.rowValue} numberOfLines={1} ellipsizeMode="middle">
              {homeserver ?? 'Not connected'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transport</Text>
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>BLE Mesh (quarantined)</Text>
              <Text style={styles.rowHint}>
                Research-era path. Off for v1. Re-integration over Encrypted Links is future work.
              </Text>
            </View>
            <Switch
              value={meshEnabled}
              onValueChange={onToggleMesh}
              trackColor={{ true: color.brand }}
              accessibilityRole="switch"
              accessibilityLabel="BLE Mesh (quarantined)"
              accessibilityState={{ checked: meshEnabled }}
            />
          </View>
        </View>

        <View
          ref={backupSectionRef}
          testID="settingsFocusBackup"
          accessibilityState={{ selected: markedSection === 'backup' }}
          onLayout={event => onBackupLayout?.(event.nativeEvent.layout.y)}
          style={styles.section}
        >
          <Text style={styles.sectionTitle}>Encrypted backup</Text>
          <View style={styles.row}>
            <Text style={styles.rowHint}>{COPY.backupExplanation}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowHint}>{COPY.backupCustodyLine}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Backup now"
            style={[styles.liveButton, backupBusy && styles.liveButtonDisabled]}
            disabled={backupBusy}
            onPress={onBackup}
          >
            {backupBusy ? (
              <ActivityIndicator color={color.textOnBrand} />
            ) : (
              <Text style={styles.liveButtonText}>Backup now</Text>
            )}
          </TouchableOpacity>
          {recoveryCode ? (
            <View style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel}>{COPY.writeRecoveryCodeDown}</Text>
                <Text style={styles.recoveryCode} selectable testID="mask-recovery">
                  {recoveryCode}
                </Text>
                <TouchableOpacity
                  testID="settingsRecoveryCopy"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.copyRecoveryCode}
                  style={styles.gateButton}
                  onPress={onCopyRecovery}
                >
                  <Text style={styles.gateButtonText}>
                    {recoveryCopied ? COPY.copied : COPY.copyRecoveryCode}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="settingsRecoveryConfirm"
                  accessibilityRole="checkbox"
                  accessibilityLabel={COPY.writtenRecoveryCode}
                  accessibilityState={{ checked: recoveryConfirmed }}
                  style={styles.checkRow}
                  onPress={onToggleRecoveryConfirmed}
                >
                  <Text style={styles.checkMark}>{recoveryConfirmed ? '☑' : '☐'}</Text>
                  <Text style={styles.checkLabel}>{COPY.writtenRecoveryCode}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="settingsRecoveryDone"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.done}
                  accessibilityState={{ disabled: !recoveryConfirmed }}
                  disabled={!recoveryConfirmed}
                  style={[styles.liveButton, !recoveryConfirmed && styles.liveButtonDisabled]}
                  onPress={onRecoveryDone}
                >
                  <Text style={styles.liveButtonText}>{COPY.done}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          <TextInput
            style={styles.liveInput}
            value={restoreCode}
            onChangeText={onChangeRestoreCode}
            placeholder="Paste recovery code to restore"
            placeholderTextColor={color.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Restore from backup"
            style={[
              styles.liveButton,
              (backupBusy || restoreCode.trim().length === 0) && styles.liveButtonDisabled,
            ]}
            disabled={backupBusy || restoreCode.trim().length === 0}
            onPress={onRestore}
          >
            <Text style={styles.liveButtonText}>Restore from backup</Text>
          </TouchableOpacity>
          {restoreNote ? (
            <View style={styles.row}>
              <View>
                <Text style={styles.rowHint}>{restoreNote}</Text>
                <ErrorDetails details={restoreError} />
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          <View style={styles.row}>
            <View>
              <Text style={styles.rowLabel}>Telemetry</Text>
              <Text style={styles.rowHint}>Anonymous delivery counters only</Text>
            </View>
            <Switch
              value={telemetryEnabled}
              onValueChange={onToggleTelemetry}
              trackColor={{ true: color.brand }}
              accessibilityRole="switch"
              accessibilityLabel="Telemetry"
              accessibilityState={{ checked: telemetryEnabled }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Messaging</Text>
          <TouchableOpacity
            testID="settingsEnableMessaging"
            accessibilityRole="button"
            accessibilityLabel={COPY.enableEncryptedMessaging}
            style={styles.row}
            onPress={onEnableMessaging}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>{session.label}</Text>
              <Text style={styles.rowHint}>{COPY.approveScopesBody}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <View
          ref={paymentsSectionRef}
          testID="settingsFocusPayments"
          accessibilityState={{ selected: markedSection === 'payments' }}
          onLayout={event => onPaymentsLayout?.(event.nativeEvent.layout.y)}
        >
          {paymentsSlot}
        </View>

        {liveProofSlot}
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
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  backHit: { minWidth: measure.hitTarget, minHeight: measure.hitTarget, justifyContent: 'center' },
  back: { color: color.brandText, fontSize: typeRole.body.fontSize },
  title: { fontSize: typeRole.titleStack.fontSize, fontWeight: '600', color: color.textPrimary },
  content: { paddingVertical: space.xxl },
  section: { marginBottom: space.xxxl },
  sectionTitle: {
    fontSize: typeRole.meta.fontSize,
    fontWeight: '600',
    color: color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: space.xl,
    marginBottom: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceRaised,
  },
  rowCopy: { flex: 1, paddingRight: space.md },
  rowLabel: { fontSize: typeRole.body.fontSize, color: color.textPrimary },
  rowValue: { fontSize: typeRole.caption.fontSize, color: color.textSecondary, maxWidth: 200 },
  rowHint: {
    fontSize: typeRole.meta.fontSize,
    color: color.textSecondary,
    marginTop: 2,
    flexShrink: 1,
  },
  chevron: { fontSize: typeRole.heading.fontSize, color: color.textSecondary },
  recoveryCode: {
    fontSize: typeRole.caption.fontSize,
    color: color.brandMuted,
    fontFamily: 'monospace',
    marginTop: space.sm,
  },
  liveInput: {
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    color: color.textPrimary,
    fontSize: typeRole.caption.fontSize,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: space.xl,
    marginBottom: space.md,
    fontFamily: 'monospace',
  },
  liveButton: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    marginHorizontal: space.xl,
    marginTop: space.xs,
  },
  liveButtonDisabled: { opacity: 0.4 },
  liveButtonText: { color: color.textOnBrand, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  gateButton: {
    minHeight: measure.hitTarget,
    justifyContent: 'center',
    marginTop: space.sm,
  },
  gateButtonText: {
    color: color.brandText,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
  checkRow: {
    minHeight: measure.hitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
  },
  checkMark: { color: color.textPrimary, fontSize: typeRole.numeric.fontSize, width: 24 },
  checkLabel: { color: color.textPrimary, fontSize: typeRole.callout.fontSize, flex: 1 },
});
