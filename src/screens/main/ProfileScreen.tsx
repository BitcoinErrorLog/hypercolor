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
import { ensureSignOutPaint } from '../../services/paintedOwner';
import { CustodyLine } from '../../ui/CustodyLine';
import { SignOutSheet } from '../../ui/SignOutSheet';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { shortPubky } from '../../ui/shortPubky';
import { sessionUiModel } from '../../ui/sessionUi';
import { sanitizeError } from '../../ui/sanitizedError';
import { copyText } from '../../utils/copyText';
import { PROFILE_BACKUP_ROUTE, PROFILE_TIP_ENDPOINTS_ROUTE } from '../../ui/exposurePaths';
import { color, space, radius, typeRole, measure } from '../../theme';
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
    ensureSignOutPaint();
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
            testID="profileEncryptedBackup"
            accessibilityRole="button"
            accessibilityLabel={COPY.encryptedBackup}
            style={styles.navRow}
            onPress={() => nav.navigate(PROFILE_BACKUP_ROUTE.name, PROFILE_BACKUP_ROUTE.params)}
          >
            <Text style={styles.navRowText}>{COPY.encryptedBackup}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="profileTipEndpoints"
            accessibilityRole="button"
            accessibilityLabel={COPY.myTipEndpoints}
            style={styles.navRow}
            onPress={() =>
              nav.navigate(PROFILE_TIP_ENDPOINTS_ROUTE.name, PROFILE_TIP_ENDPOINTS_ROUTE.params)
            }
          >
            <Text style={styles.navRowText}>{COPY.myTipEndpoints}</Text>
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
  container: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  title: { fontSize: typeRole.title.fontSize, fontWeight: '700', color: color.textPrimary },
  headerAction: { minHeight: measure.hitTarget, justifyContent: 'center' },
  settings: { fontSize: typeRole.body.fontSize, color: color.brandText, fontWeight: '600' },
  scroll: { flexGrow: 1 },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xxl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: color.brand,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: typeRole.display.fontSize, fontWeight: '700', color: color.textOnBrand },
  displayName: { fontSize: typeRole.heading.fontSize, fontWeight: '600', color: color.textPrimary },
  pubkyKey: {
    fontSize: typeRole.meta.fontSize,
    color: color.textSecondary,
    fontFamily: 'monospace',
    maxWidth: 280,
  },
  copyBtn: { minHeight: measure.hitTarget, justifyContent: 'center' },
  copyText: { color: color.brandText, fontSize: typeRole.callout.fontSize, fontWeight: '600' },
  sessionRow: {
    marginHorizontal: space.xl,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.surfaceRaised,
    gap: space.sm,
  },
  sessionLabel: { color: color.textPrimary, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  sessionBody: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: 20,
  },
  sessionAction: { minHeight: measure.hitTarget, justifyContent: 'center' },
  sessionActionText: {
    color: color.brandText,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '700',
  },
  actions: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl + space.lg,
    gap: space.md,
  },
  navRow: {
    minHeight: measure.hitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceRaised,
  },
  navRowText: { color: color.textPrimary, fontSize: typeRole.body.fontSize },
  chevron: { fontSize: typeRole.heading.fontSize, color: color.textSecondary },
  e2eSwitch: {
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    alignItems: 'center',
  },
  e2eSwitchText: {
    color: color.brandMuted,
    fontSize: typeRole.secondary.fontSize,
    fontWeight: '600',
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: color.dangerStrong,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: color.dangerStrong,
    fontSize: typeRole.body.fontSize,
    fontWeight: '600',
  },
});
