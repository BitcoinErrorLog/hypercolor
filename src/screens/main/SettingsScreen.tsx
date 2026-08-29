import React, { useState } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { FeatureFlags } from '../../flags';
import { useAuthStore } from '../../stores/authStore';

export default function SettingsScreen() {
  const nav = useNavigation();
  const homeserver = useAuthStore(s => s.homeserver);

  const [meshEnabled, setMeshEnabled] = useState(() => FeatureFlags.get('mesh_transport'));
  const [inboxEnabled, setInboxEnabled] = useState(() => FeatureFlags.get('pubky_inbox'));
  const [telemetryEnabled, setTelemetryEnabled] = useState(() => FeatureFlags.get('telemetry'));

  function toggleMesh(val: boolean) {
    FeatureFlags.set('mesh_transport', val);
    setMeshEnabled(val);
  }

  function toggleInbox(val: boolean) {
    FeatureFlags.set('pubky_inbox', val);
    setInboxEnabled(val);
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
            <View>
              <Text style={styles.rowLabel}>BLE Mesh</Text>
              <Text style={styles.rowHint}>Local offline delivery</Text>
            </View>
            <Switch
              value={meshEnabled}
              onValueChange={toggleMesh}
              trackColor={{ true: '#7c3aed' }}
            />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.rowLabel}>Pubky Inbox</Text>
              <Text style={styles.rowHint}>Async encrypted delivery</Text>
            </View>
            <Switch
              value={inboxEnabled}
              onValueChange={toggleInbox}
              trackColor={{ true: '#7c3aed' }}
            />
          </View>
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
          <Text style={styles.sectionTitle}>Account</Text>
          <TouchableOpacity style={styles.row} onPress={() => nav.navigate('Profile' as never)}>
            <Text style={styles.rowLabel}>Profile</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.row}>
            <Text style={styles.rowHint}>Keys managed by pubky-ring</Text>
          </View>
        </View>
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
  rowHint: { fontSize: 12, color: '#4b5563', marginTop: 2 },
  chevron: { fontSize: 20, color: '#6b7280' },
});
