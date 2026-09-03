import React, { useCallback, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
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
import { ProfileScreenContent } from './ProfileScreenContent';

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

  const debugSlot = __DEV__ ? (
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
  ) : null;

  return (
    <ProfileScreenContent
      displayName={displayName}
      pubky={pubky}
      copied={copied}
      session={session}
      sessionKind={sessionKind}
      showEnableMessaging={sessionKind === 'needs-enable' || sessionKind === 'revoked'}
      signOutOpen={signOutOpen}
      signOutBusy={signOutBusy}
      signOutError={signOutError}
      lastBackupRelative={lastBackupAt ? formatRelativeBackupTime(lastBackupAt) : null}
      debugSlot={debugSlot}
      onOpenSettings={() => nav.navigate('Settings')}
      onCopyPubky={() => {
        if (!pubky) return;
        copyText(pubky);
        setCopied(true);
      }}
      onEnableMessaging={() => nav.navigate('EnableMessaging')}
      onOpenRequests={() => nav.navigate('MessageRequests')}
      onOpenBackup={() => nav.navigate(PROFILE_BACKUP_ROUTE.name, PROFILE_BACKUP_ROUTE.params)}
      onOpenTipEndpoints={() =>
        nav.navigate(PROFILE_TIP_ENDPOINTS_ROUTE.name, PROFILE_TIP_ENDPOINTS_ROUTE.params)
      }
      onOpenSignOut={() => setSignOutOpen(true)}
      onCancelSignOut={() => {
        if (signOutBusy) return;
        setSignOutOpen(false);
        setSignOutError(null);
      }}
      onConfirmSignOut={() => {
        void confirmSignOut();
      }}
    />
  );
}

const styles = StyleSheet.create({
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
});
