import React, { useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FeatureFlags } from '../../flags';
import { useAuthStore } from '../../stores/authStore';
import type { RootStackParamList } from '../../types';
import {
  parseLiveProofTokens,
  runLinkLiveProof,
  type LiveProofReport,
} from '../../services/link/liveProof';
import { TipEndpointsSettings } from '../../components/TipEndpointsSettings';
import { BackupService } from '../../services/backup/BackupService';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export default function SettingsScreen() {
  const nav = useNavigation<Nav>();
  const homeserver = useAuthStore(s => s.homeserver);

  const [meshEnabled, setMeshEnabled] = useState(() => FeatureFlags.get('mesh_transport'));
  const [telemetryEnabled, setTelemetryEnabled] = useState(() => FeatureFlags.get('telemetry'));
  const [backupBusy, setBackupBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  function toggleMesh(val: boolean) {
    FeatureFlags.set('mesh_transport', val);
    setMeshEnabled(val);
  }

  function toggleTelemetry(val: boolean) {
    FeatureFlags.set('telemetry', val);
    setTelemetryEnabled(val);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
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
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLabel}>BLE Mesh (quarantined)</Text>
              <Text style={styles.rowHint}>
                Research-era path. Off for v1. Re-integration over Encrypted Links is future work.
              </Text>
            </View>
            <Switch
              value={meshEnabled}
              onValueChange={toggleMesh}
              trackColor={{ true: '#7c3aed' }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Encrypted backup</Text>
          <View style={styles.row}>
            <Text style={styles.rowHint}>
              Backup uses a random recovery code, not a passphrase. History (contacts, chats,
              groups, payments, tip lists) restores. Live Encrypted Links re-establish on this
              device. Attachment files without keys show as unavailable until re-shared.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.liveButton, backupBusy && styles.liveButtonDisabled]}
            disabled={backupBusy}
            onPress={() => {
              setBackupBusy(true);
              setRestoreNote(null);
              void BackupService.exportBackup()
                .then(result => {
                  setRecoveryCode(result.recoveryCode);
                })
                .catch(err => {
                  setRestoreNote(err instanceof Error ? err.message : 'Backup failed');
                })
                .finally(() => setBackupBusy(false));
            }}
          >
            {backupBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.liveButtonText}>Backup now</Text>
            )}
          </TouchableOpacity>
          {recoveryCode ? (
            <View style={styles.row}>
              <View>
                <Text style={styles.rowLabel}>Write this recovery code down</Text>
                <Text style={styles.recoveryCode} selectable>
                  {recoveryCode}
                </Text>
                <Text style={styles.rowHint}>
                  It is shown once here. Store it in Ring or a password manager.
                </Text>
              </View>
            </View>
          ) : null}
          <TextInput
            style={styles.liveInput}
            value={restoreCode}
            onChangeText={setRestoreCode}
            placeholder="Paste recovery code to restore"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[
              styles.liveButton,
              (backupBusy || restoreCode.trim().length === 0) && styles.liveButtonDisabled,
            ]}
            disabled={backupBusy || restoreCode.trim().length === 0}
            onPress={() => {
              setBackupBusy(true);
              setRestoreNote(null);
              void BackupService.restoreBackup(restoreCode)
                .then(() => {
                  setRestoreNote(
                    'Restore complete. History is local. Enable messaging again so links re-handshake. Attachments without keys stay unavailable until re-shared.',
                  );
                })
                .catch(err => {
                  setRestoreNote(err instanceof Error ? err.message : 'Restore failed');
                })
                .finally(() => setBackupBusy(false));
            }}
          >
            <Text style={styles.liveButtonText}>Restore from backup</Text>
          </TouchableOpacity>
          {restoreNote ? (
            <View style={styles.row}>
              <Text style={styles.rowHint}>{restoreNote}</Text>
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
              trackColor={{ true: '#7c3aed' }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Messaging</Text>
          <TouchableOpacity style={styles.row} onPress={() => nav.navigate('EnableMessaging')}>
            <View>
              <Text style={styles.rowLabel}>Enable encrypted messaging</Text>
              <Text style={styles.rowHint}>Authorize Pubky Ring for Paykit links</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <TipEndpointsSettings />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <TouchableOpacity style={styles.row} onPress={() => nav.navigate('Profile' as never)}>
            <Text style={styles.rowLabel}>Profile</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.row}>
            <Text style={styles.rowHint}>Keys managed by pubky-ring</Text>
          </View>
        </View>

        {__DEV__ ? <LiveProofSettingsPanel /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  back: { color: '#7c3aed', fontSize: 16, width: 60 },
  title: { fontSize: 17, fontWeight: '600', color: '#f9fafb' },
  content: { paddingVertical: 24 },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
  },
  rowLabel: { fontSize: 16, color: '#f9fafb' },
  rowValue: { fontSize: 13, color: '#6b7280', maxWidth: 200 },
  rowHint: { fontSize: 12, color: '#4b5563', marginTop: 2, flexShrink: 1 },
  chevron: { fontSize: 20, color: '#6b7280' },
  recoveryCode: {
    fontSize: 13,
    color: '#c4b5fd',
    fontFamily: 'monospace',
    marginTop: 8,
  },
  liveInput: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    color: '#f9fafb',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    fontFamily: 'monospace',
  },
  liveButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 4,
  },
  liveButtonDisabled: { opacity: 0.4 },
  liveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  liveStep: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
  },
  liveStepOk: { fontSize: 13, color: '#86efac' },
  liveStepFail: { fontSize: 13, color: '#fca5a5' },
  liveStepDetail: { fontSize: 12, color: '#6b7280', marginTop: 2 },
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
        placeholderTextColor="#4b5563"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.liveInput}
        value={tokenA}
        onChangeText={setTokenA}
        placeholder="Signup token A (or A,B)"
        placeholderTextColor="#4b5563"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.liveInput}
        value={tokenB}
        onChangeText={setTokenB}
        placeholder="Signup token B"
        placeholderTextColor="#4b5563"
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
          <ActivityIndicator color="#fff" />
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
