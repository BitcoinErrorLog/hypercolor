import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../stores/authStore';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import { PubkyService } from '../../services/PubkyService';
import type { RootStackParamList } from '../../types';
import { DebugSignupPanel } from '../auth/DebugSignupPanel';
import { getE2eIdentity } from '../../navigation/e2eSignupResult';
import { switchE2eSavedSlotFromUi } from '../../navigation/e2eDeepLinks';
import { COPY } from '../../copy/uxCopy';
import { paintSigningOut } from '../../services/paintedOwner';
import { CustodyLine } from '../../ui/CustodyLine';
import { SignOutSheet } from '../../ui/SignOutSheet';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { shortPubky } from '../../ui/shortPubky';
import { sessionUiModel } from '../../ui/sessionUi';
import { sanitizeError } from '../../ui/sanitizedError';
import { copyText } from '../../utils/copyText';
import {
  clearLastBackupAt,
  formatRelativeBackupTime,
  getLastBackupAt,
} from '../../stores/backupMetaStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProfileScreen() {
  const nav = useNavigation<Nav>();
  const { profile, pubky, setProfile, clearSession } = useAuthStore();
  const sessionKind = useSessionStatusStore(s => s.kind);
  const [, setE2eRefresh] = useState(0);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<{
    message: string;
    details: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setE2eRefresh(tick => tick + 1);
      if (!pubky) return;
      void PubkyService.getProfile(pubky).then(next => {
        if (next) setProfile(next);
      });
    }, [pubky, setProfile]),
  );

  const session = sessionUiModel(sessionKind);
  const displayName =
    profile?.displayName?.trim() || (pubky ? shortPubky(pubky) : COPY.notConnected);
  const lastBackupAt = getLastBackupAt();

  async function confirmSignOut() {
    setSignOutBusy(true);
    setSignOutError(null);
    paintSigningOut();
    try {
      try {
        await PubkyService.signOut();
      } catch (err) {
        const sanitized = sanitizeError(err, COPY.couldNotSignOut);
        setSignOutError({ message: sanitized.message, details: sanitized.details });
        return;
      }
      try {
        clearLastBackupAt();
        clearSession();
        setSignOutOpen(false);
      } catch (err) {
        const sanitized = sanitizeError(err, COPY.couldNotSignOut);
        setSignOutError({ message: sanitized.message, details: sanitized.details });
      }
    } finally {
      setSignOutBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} testID="profileScreen">
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity
          testID="profileSettings"
          accessibilityRole="button"
          accessibilityLabel={COPY.settingsRow}
          hitSlop={HIT_SLOP_44}
          onPress={() => nav.navigate('Settings')}
          style={styles.headerAction}
        >
          <Text style={styles.settings}>{COPY.settingsRow}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>

          <Text style={styles.displayName}>{displayName}</Text>

          {pubky ? (
            <>
              <Text
                testID="profilePubky"
                accessibilityLabel="Profile pubky"
                style={styles.pubkyKey}
                selectable
              >
                {pubky}
              </Text>
              <TouchableOpacity
                testID="profileCopyPubky"
                accessibilityRole="button"
                accessibilityLabel="Copy pubky"
                hitSlop={HIT_SLOP_44}
                onPress={() => {
                  copyText(pubky);
                  setCopied(true);
                }}
                style={styles.copyBtn}
              >
                <Text style={styles.copyText}>{copied ? COPY.copied : 'Copy'}</Text>
              </TouchableOpacity>
            </>
          ) : null}

          <CustodyLine />
        </View>

        <View style={styles.sessionRow} testID="profileSessionStatus">
          <Text style={styles.sessionLabel}>{session.label}</Text>
          {session.body ? <Text style={styles.sessionBody}>{session.body}</Text> : null}
          {sessionKind === 'needs-enable' || sessionKind === 'revoked' ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={COPY.enableEncryptedMessaging}
              style={styles.sessionAction}
              onPress={() => nav.navigate('EnableMessaging')}
            >
              <Text style={styles.sessionActionText}>{COPY.enableEncryptedMessaging}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            testID="profileMessageRequests"
            accessibilityRole="button"
            accessibilityLabel={COPY.messageRequestsNav}
            style={styles.navRow}
            onPress={() => nav.navigate('MessageRequests')}
          >
            <Text style={styles.navRowText}>{COPY.messageRequestsNav}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="profileOpenSettings"
            accessibilityRole="button"
            accessibilityLabel={COPY.settingsRow}
            style={styles.navRow}
            onPress={() => nav.navigate('Settings')}
          >
            <Text style={styles.navRowText}>{COPY.settingsRow}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {__DEV__ ? (
            <>
              {getE2eIdentity('a') ? (
                <TouchableOpacity
                  testID="debugSwitchSlotA"
                  accessibilityLabel="E2E switch to slot A"
                  style={styles.e2eSwitch}
                  onPress={() => {
                    void switchE2eSavedSlotFromUi('a');
                  }}
                >
                  <Text style={styles.e2eSwitchText}>E2E switch A</Text>
                </TouchableOpacity>
              ) : null}
              {getE2eIdentity('b') ? (
                <TouchableOpacity
                  testID="debugSwitchSlotB"
                  accessibilityLabel="E2E switch to slot B"
                  style={styles.e2eSwitch}
                  onPress={() => {
                    void switchE2eSavedSlotFromUi('b');
                  }}
                >
                  <Text style={styles.e2eSwitchText}>E2E switch B</Text>
                </TouchableOpacity>
              ) : null}
              <DebugSignupPanel
                title="Switch debug account"
                submitLabel="Switch debug account"
                e2eSlot="b"
              />
            </>
          ) : null}
          <TouchableOpacity
            testID="profileSignOut"
            accessibilityRole="button"
            accessibilityLabel={COPY.signOut}
            style={styles.dangerButton}
            onPress={() => setSignOutOpen(true)}
          >
            <Text style={styles.dangerButtonText}>{COPY.signOut}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <SignOutSheet
        visible={signOutOpen}
        lastBackupRelative={lastBackupAt ? formatRelativeBackupTime(lastBackupAt) : null}
        busy={signOutBusy}
        error={signOutError}
        onCancel={() => {
          if (signOutBusy) return;
          setSignOutOpen(false);
          setSignOutError(null);
        }}
        onConfirm={() => {
          void confirmSignOut();
        }}
      />
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#f9fafb' },
  headerAction: { minHeight: 44, justifyContent: 'center' },
  settings: { fontSize: 16, color: '#8f57f0', fontWeight: '600' },
  scroll: { flexGrow: 1 },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  displayName: { fontSize: 20, fontWeight: '600', color: '#f9fafb' },
  pubkyKey: {
    fontSize: 12,
    color: '#808692',
    fontFamily: 'monospace',
    maxWidth: 280,
  },
  copyBtn: { minHeight: 44, justifyContent: 'center' },
  copyText: { color: '#8f57f0', fontSize: 15, fontWeight: '600' },
  sessionRow: {
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#111111',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1a1a1a',
    gap: 8,
  },
  sessionLabel: { color: '#f9fafb', fontSize: 16, fontWeight: '600' },
  sessionBody: { color: '#808692', fontSize: 14, lineHeight: 20 },
  sessionAction: { minHeight: 44, justifyContent: 'center' },
  sessionActionText: { color: '#8f57f0', fontSize: 15, fontWeight: '700' },
  actions: { paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  navRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
  },
  navRowText: { color: '#f9fafb', fontSize: 16 },
  chevron: { fontSize: 20, color: '#808692' },
  e2eSwitch: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: 'center',
  },
  e2eSwitchText: { color: '#c4b5fd', fontSize: 14, fontWeight: '600' },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 16,
    minHeight: 44,
    alignItems: 'center',
  },
  dangerButtonText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
});
