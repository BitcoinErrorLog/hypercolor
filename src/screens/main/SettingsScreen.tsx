import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Alert,
  BackHandler,
} from 'react-native';
import {
  useNavigation,
  usePreventRemove,
  useRoute,
  type NavigationAction,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { FeatureFlags } from '../../flags';
import { useAuthStore } from '../../stores/authStore';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import type { RootStackParamList } from '../../types';
import {
  parseLiveProofTokens,
  runLinkLiveProof,
  type LiveProofReport,
} from '../../services/link/liveProof';
import { TipEndpointsSettings } from '../../components/TipEndpointsSettings';
import { BackupService } from '../../services/backup/BackupService';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ErrorDetails } from '../../ui/ErrorDetails';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { sessionUiModel } from '../../ui/sessionUi';
import { sanitizeError } from '../../ui/sanitizedError';
import { setLastBackupAt } from '../../stores/backupMetaStore';
import { shortPubky } from '../../ui/shortPubky';
import { copyText } from '../../utils/copyText';
import { useReduceMotion } from '../../ui/reduceMotion';
import { scrollSettingsToSection, focusSettingsSection } from '../../ui/settingsSectionFocus';
import { color, space, radius, typeRole, measure } from '../../theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;
type SettingsRoute = RouteProp<RootStackParamList, 'Settings'>;
type SettingsSectionFocus = 'backup' | 'payments';

export default function SettingsScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<SettingsRoute>();
  const sectionParam = route.params?.section;
  const homeserver = useAuthStore(s => s.homeserver);
  const pubky = useAuthStore(s => s.pubky);
  const sessionKind = useSessionStatusStore(s => s.kind);
  const session = sessionUiModel(sessionKind);

  const [meshEnabled, setMeshEnabled] = useState(() => FeatureFlags.get('mesh_transport'));
  const [telemetryEnabled, setTelemetryEnabled] = useState(() => FeatureFlags.get('telemetry'));
  const [backupBusy, setBackupBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [recoveryGateActive, setRecoveryGateActive] = useState(false);
  const [restoreCode, setRestoreCode] = useState('');
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const leavingRef = useRef(false);
  const alertVisibleRef = useRef(false);
  const [highlightedSection, setHighlightedSection] = useState<SettingsSectionFocus | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const backupRef = useRef<View>(null);
  const paymentsRef = useRef<View>(null);
  const backupY = useRef(0);
  const paymentsY = useRef(0);
  const reduceMotion = useReduceMotion();
  const markedSection = highlightedSection ?? sectionParam ?? null;

  const consumeSectionFocus = useCallback(
    (target: SettingsSectionFocus, y: number, node: View | null) => {
      if (recoveryGateActive) return;
      if (sectionParam !== target) return;
      scrollSettingsToSection(scrollRef.current, y, reduceMotion);
      focusSettingsSection(node);
      setHighlightedSection(target);
      nav.setParams({ section: undefined });
    },
    [nav, recoveryGateActive, reduceMotion, sectionParam],
  );

  useEffect(() => {
    if (recoveryGateActive) return;
    if (sectionParam !== 'backup' && sectionParam !== 'payments') return;
    const y = sectionParam === 'backup' ? backupY.current : paymentsY.current;
    const node = sectionParam === 'backup' ? backupRef.current : paymentsRef.current;
    const timer = setTimeout(() => {
      consumeSectionFocus(sectionParam, y, node);
    }, 50);
    return () => clearTimeout(timer);
  }, [consumeSectionFocus, recoveryGateActive, sectionParam]);

  const leaveSettings = useCallback(
    (action?: NavigationAction) => {
      if (action) {
        nav.dispatch(action);
        return;
      }
      nav.goBack();
    },
    [nav],
  );

  const requestLeave = useCallback(
    (action?: NavigationAction) => {
      if (leavingRef.current) {
        leavingRef.current = false;
        leaveSettings(action);
        return;
      }
      if (!recoveryGateActive) {
        leaveSettings(action);
        return;
      }
      if (alertVisibleRef.current) {
        return;
      }
      alertVisibleRef.current = true;
      Alert.alert(
        COPY.leaveRecoveryTitle,
        COPY.leaveRecoveryBody,
        [
          {
            text: COPY.goBack,
            style: 'cancel',
            onPress: () => {
              alertVisibleRef.current = false;
            },
          },
          {
            text: COPY.leaveAnyway,
            style: 'destructive',
            onPress: () => {
              alertVisibleRef.current = false;
              leavingRef.current = true;
              setRecoveryGateActive(false);
              setRecoveryCode(null);
              setRecoveryConfirmed(false);
              leaveSettings(action);
            },
          },
        ],
        {
          cancelable: true,
          onDismiss: () => {
            alertVisibleRef.current = false;
          },
        },
      );
    },
    [leaveSettings, recoveryGateActive],
  );

  usePreventRemove(recoveryGateActive, ({ data }) => {
    if (leavingRef.current) {
      leavingRef.current = false;
      nav.dispatch(data.action);
      return;
    }
    requestLeave(data.action);
  });

  useEffect(() => {
    nav.setOptions({ gestureEnabled: !recoveryGateActive });
  }, [nav, recoveryGateActive]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!recoveryGateActive) return false;
      requestLeave();
      return true;
    });
    return () => sub.remove();
  }, [recoveryGateActive, requestLeave]);

  function toggleMesh(val: boolean) {
    FeatureFlags.set('mesh_transport', val);
    setMeshEnabled(val);
  }

  function toggleTelemetry(val: boolean) {
    FeatureFlags.set('telemetry', val);
    setTelemetryEnabled(val);
  }

  return (
    <SafeAreaView style={styles.container} testID="settingsScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="settingsBack"
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={HIT_SLOP_44}
          onPress={() => requestLeave()}
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
              <Text style={styles.rowValue} selectable>
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
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text style={styles.rowLabel}>BLE Mesh (quarantined)</Text>
              <Text style={styles.rowHint}>
                Research-era path. Off for v1. Re-integration over Encrypted Links is future work.
              </Text>
            </View>
            <Switch
              value={meshEnabled}
              onValueChange={toggleMesh}
              trackColor={{ true: color.brand }}
              accessibilityRole="switch"
              accessibilityLabel="BLE Mesh (quarantined)"
              accessibilityState={{ checked: meshEnabled }}
            />
          </View>
        </View>

        <View
          ref={backupRef}
          testID="settingsFocusBackup"
          accessibilityState={{ selected: markedSection === 'backup' }}
          onLayout={event => {
            backupY.current = event.nativeEvent.layout.y;
            consumeSectionFocus('backup', event.nativeEvent.layout.y, backupRef.current);
          }}
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
            onPress={() => {
              setBackupBusy(true);
              setRestoreNote(null);
              setRestoreError(null);
              void BackupService.exportBackup()
                .then(result => {
                  leavingRef.current = false;
                  alertVisibleRef.current = false;
                  setRecoveryCode(result.recoveryCode);
                  setRecoveryConfirmed(false);
                  setRecoveryCopied(false);
                  setRecoveryGateActive(true);
                })
                .catch(err => {
                  const sanitized = sanitizeError(err, 'Could not create a backup.');
                  setRestoreNote(sanitized.message);
                  setRestoreError(sanitized.details);
                })
                .finally(() => setBackupBusy(false));
            }}
          >
            {backupBusy ? (
              <ActivityIndicator color={color.textOnBrand} />
            ) : (
              <Text style={styles.liveButtonText}>Backup now</Text>
            )}
          </TouchableOpacity>
          {recoveryCode ? (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{COPY.writeRecoveryCodeDown}</Text>
                <Text style={styles.recoveryCode} selectable>
                  {recoveryCode}
                </Text>
                <TouchableOpacity
                  testID="settingsRecoveryCopy"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.copyRecoveryCode}
                  style={styles.gateButton}
                  onPress={() => {
                    copyText(recoveryCode);
                    setRecoveryCopied(true);
                  }}
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
                  onPress={() => setRecoveryConfirmed(value => !value)}
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
                  onPress={() => {
                    setLastBackupAt(Date.now());
                    setRecoveryGateActive(false);
                  }}
                >
                  <Text style={styles.liveButtonText}>{COPY.done}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          <TextInput
            style={styles.liveInput}
            value={restoreCode}
            onChangeText={setRestoreCode}
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
            onPress={() => {
              setBackupBusy(true);
              setRestoreNote(null);
              setRestoreError(null);
              void BackupService.restoreBackup(restoreCode)
                .then(() => {
                  setRestoreNote(
                    'Restore complete. History is local. Enable messaging again so links re-handshake. Attachments without keys stay unavailable until re-shared.',
                  );
                })
                .catch(err => {
                  const sanitized = sanitizeError(err, 'That recovery code did not work.');
                  setRestoreNote(sanitized.message);
                  setRestoreError(sanitized.details);
                })
                .finally(() => setBackupBusy(false));
            }}
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
              onValueChange={toggleTelemetry}
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
            onPress={() => nav.navigate('EnableMessaging')}
          >
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text style={styles.rowLabel}>{session.label}</Text>
              <Text style={styles.rowHint}>{COPY.approveScopesBody}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <View
          ref={paymentsRef}
          testID="settingsFocusPayments"
          accessibilityState={{ selected: markedSection === 'payments' }}
          onLayout={event => {
            paymentsY.current = event.nativeEvent.layout.y;
            consumeSectionFocus('payments', event.nativeEvent.layout.y, paymentsRef.current);
          }}
        >
          <TipEndpointsSettings />
        </View>

        {__DEV__ ? <LiveProofSettingsPanel /> : null}
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
  liveStep: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceRaised,
  },
  liveStepOk: { fontSize: typeRole.caption.fontSize, color: color.success },
  liveStepFail: { fontSize: typeRole.caption.fontSize, color: color.danger },
  liveStepDetail: { fontSize: typeRole.meta.fontSize, color: color.textSecondary, marginTop: 2 },
});

function LiveProofSettingsPanel() {
  const [homeserverPubky, setHomeserverPubky] = useState('');
  const [tokenA, setTokenA] = useState('');
  const [tokenB, setTokenB] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<LiveProofReport | null>(null);

  async function handleRun() {
    const tokens = parseLiveProofTokens(tokenA, tokenB);
    if (!tokens || homeserverPubky.trim().length === 0) return;
    setRunning(true);
    setReport(null);
    try {
      const result = await runLinkLiveProof({
        homeserverPubky: homeserverPubky.trim(),
        signupTokenA: tokens.signupTokenA,
        signupTokenB: tokens.signupTokenB,
      });
      setReport(result);
    } finally {
      setRunning(false);
    }
  }

  const canRun = homeserverPubky.trim().length > 0 && parseLiveProofTokens(tokenA, tokenB) !== null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Live proof (dev)</Text>
      <View style={styles.row}>
        <Text style={styles.rowHint}>
          Two-party staging harness. Uses the native module only — not your signed-in session.
        </Text>
      </View>
      <TextInput
        style={styles.liveInput}
        value={homeserverPubky}
        onChangeText={setHomeserverPubky}
        placeholder="Homeserver public key"
        placeholderTextColor={color.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.liveInput}
        value={tokenA}
        onChangeText={setTokenA}
        placeholder="Signup token A (or A,B)"
        placeholderTextColor={color.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.liveInput}
        value={tokenB}
        onChangeText={setTokenB}
        placeholder="Signup token B"
        placeholderTextColor={color.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={[styles.liveButton, (!canRun || running) && styles.liveButtonDisabled]}
        onPress={() => {
          void handleRun();
        }}
        disabled={!canRun || running}
      >
        {running ? (
          <ActivityIndicator color={color.textOnBrand} />
        ) : (
          <Text style={styles.liveButtonText}>Run live proof</Text>
        )}
      </TouchableOpacity>
      {report
        ? report.steps.map((step, index) => (
            <View key={`${step.step}-${index}`} style={styles.liveStep}>
              <Text style={step.ok ? styles.liveStepOk : styles.liveStepFail}>
                {step.ok ? 'ok' : 'fail'} {step.step} ({step.elapsedMs}ms)
              </Text>
              <Text style={styles.liveStepDetail}>{step.detail}</Text>
            </View>
          ))
        : null}
    </View>
  );
}
