import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { COPY } from '../../copy/uxCopy';
import { CustodyLine } from '../../ui/CustodyLine';
import { ProfileQrSheet } from '../../ui/profile/ProfileQrSheet';
import { SignOutSheet } from '../../ui/SignOutSheet';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import type { SessionUiModel } from '../../ui/sessionUi';
import { color, space, radius, typeRole, measure } from '../../theme';
import { Avatar } from '../../ui/primitives';

export type ProfileScreenContentProps = {
  displayName: string;
  pubky: string | null;
  copied: boolean;
  session: SessionUiModel;
  sessionKind: string;
  showEnableMessaging: boolean;
  signOutOpen: boolean;
  signOutBusy: boolean;
  signOutError: { message: string; details: string | null } | null;
  lastBackupRelative: string | null;
  debugSlot?: React.ReactNode;
  qrOpen: boolean;
  qrCopied: boolean;
  onOpenSettings: () => void;
  onCopyPubky: () => void;
  onShowQr: () => void;
  onCloseQr: () => void;
  onQrCopied: () => void;
  onEnableMessaging: () => void;
  onOpenRequests: () => void;
  onOpenBackup: () => void;
  onOpenTipEndpoints: () => void;
  onOpenSignOut: () => void;
  onCancelSignOut: () => void;
  onConfirmSignOut: () => void;
  nameDraft?: string;
  onChangeNameDraft?: (value: string) => void;
  onSaveDisplayName?: () => void;
};

export function ProfileScreenContent({
  displayName,
  pubky,
  copied,
  session,
  sessionKind: _sessionKind,
  showEnableMessaging,
  signOutOpen,
  signOutBusy,
  signOutError,
  lastBackupRelative,
  debugSlot = null,
  qrOpen,
  qrCopied,
  onOpenSettings,
  onCopyPubky,
  onShowQr,
  onCloseQr,
  onQrCopied,
  onEnableMessaging,
  onOpenRequests,
  onOpenBackup,
  onOpenTipEndpoints,
  onOpenSignOut,
  onCancelSignOut,
  onConfirmSignOut,
  nameDraft,
  onChangeNameDraft,
  onSaveDisplayName,
}: ProfileScreenContentProps): React.ReactElement {
  return (
    <SafeAreaView style={styles.container} testID="profileScreen">
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity
          testID="profileSettings"
          accessibilityRole="button"
          accessibilityLabel={COPY.settingsRow}
          hitSlop={HIT_SLOP_44}
          onPress={onOpenSettings}
          style={styles.headerAction}
        >
          <Text style={styles.settings}>{COPY.settingsRow}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Avatar name={displayName} pubky={pubky} size="lg" testID="profileAvatar" />
          <Text style={styles.displayName}>{displayName}</Text>
          {onChangeNameDraft && onSaveDisplayName ? (
            <>
              <TextInput
                testID="profileDisplayName"
                accessibilityLabel={COPY.displayNameLabel}
                value={nameDraft ?? ''}
                onChangeText={onChangeNameDraft}
                placeholder={COPY.displayNamePlaceholder}
                placeholderTextColor={color.textSecondary}
                style={styles.nameInput}
              />
              <TouchableOpacity
                testID="profileSaveDisplayName"
                accessibilityRole="button"
                accessibilityLabel={COPY.saveDisplayName}
                hitSlop={HIT_SLOP_44}
                onPress={onSaveDisplayName}
                style={styles.copyBtn}
              >
                <Text style={styles.copyText}>{COPY.saveDisplayName}</Text>
              </TouchableOpacity>
            </>
          ) : null}
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
                onPress={onCopyPubky}
                style={styles.copyBtn}
              >
                <Text style={styles.copyText}>{copied ? COPY.copied : 'Copy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="profileShowQr"
                accessibilityRole="button"
                accessibilityLabel={COPY.showQr}
                hitSlop={HIT_SLOP_44}
                onPress={onShowQr}
                style={styles.copyBtn}
              >
                <Text style={styles.copyText}>{COPY.showQr}</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <CustodyLine />
        </View>

        <View style={styles.sessionRow} testID="profileSessionStatus">
          <Text style={styles.sessionLabel}>{session.label}</Text>
          {session.body ? <Text style={styles.sessionBody}>{session.body}</Text> : null}
          {showEnableMessaging ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={COPY.enableEncryptedMessaging}
              style={styles.sessionAction}
              onPress={onEnableMessaging}
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
            onPress={onOpenRequests}
          >
            <Text style={styles.navRowText}>{COPY.messageRequestsNav}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="profileEncryptedBackup"
            accessibilityRole="button"
            accessibilityLabel={COPY.encryptedBackup}
            style={styles.navRow}
            onPress={onOpenBackup}
          >
            <Text style={styles.navRowText}>{COPY.encryptedBackup}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="profileTipEndpoints"
            accessibilityRole="button"
            accessibilityLabel={COPY.myTipEndpoints}
            style={styles.navRow}
            onPress={onOpenTipEndpoints}
          >
            <Text style={styles.navRowText}>{COPY.myTipEndpoints}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="profileOpenSettings"
            accessibilityRole="button"
            accessibilityLabel={COPY.settingsRow}
            style={styles.navRow}
            onPress={onOpenSettings}
          >
            <Text style={styles.navRowText}>{COPY.settingsRow}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          {debugSlot}
          <TouchableOpacity
            testID="profileSignOut"
            accessibilityRole="button"
            accessibilityLabel={COPY.signOut}
            style={styles.dangerButton}
            onPress={onOpenSignOut}
          >
            <Text style={styles.dangerButtonText}>{COPY.signOut}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <ProfileQrSheet
        visible={qrOpen && Boolean(pubky)}
        pubky={pubky ?? ''}
        copied={qrCopied}
        onCopied={onQrCopied}
        onClose={onCloseQr}
      />
      <SignOutSheet
        visible={signOutOpen}
        lastBackupRelative={lastBackupRelative}
        busy={signOutBusy}
        error={signOutError}
        onCancel={onCancelSignOut}
        onConfirm={onConfirmSignOut}
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
  nameInput: {
    alignSelf: 'stretch',
    minHeight: measure.hitTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.textPrimary,
  },
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
