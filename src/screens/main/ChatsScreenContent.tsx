import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import type { Contact } from '../../types';
import type { LinkConversationSummary } from '../../types/link';
import { EnableMessagingCta } from '../../components/EnableMessagingCta';
import { StatusBanner } from '../../ui/StatusBanner';
import { COPY } from '../../copy/uxCopy';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { peerIdentity } from '../../ui/peerIdentity';
import { color, space, radius, typeRole, measure } from '../../theme';

export type ChatsScreenContentProps = {
  conversations: LinkConversationSummary[];
  contacts: Record<string, Contact>;
  pendingRequests: number;
  ownerPubky: string | null;
  needsEnable: boolean;
  showEnableCta: boolean;
  listError: string | null;
  nowMs?: number;
  onOpenThread: (row: LinkConversationSummary) => void;
  onOpenRequests: () => void;
  onNewChat: () => void;
  onEnableMessaging: () => void;
  onRetry: () => void;
  onCopyMyPubky: () => void;
  onShareMyPubky: () => void;
};

export function ChatsScreenContent({
  conversations,
  contacts,
  pendingRequests,
  ownerPubky,
  needsEnable,
  showEnableCta,
  listError,
  nowMs,
  onOpenThread,
  onOpenRequests,
  onNewChat,
  onEnableMessaging,
  onRetry,
  onCopyMyPubky,
  onShareMyPubky,
}: ChatsScreenContentProps): React.ReactElement {
  const renderThread = useCallback(
    ({ item }: { item: LinkConversationSummary }) => {
      const identity = peerIdentity(item.participantPubky, contacts[item.participantPubky] ?? null);
      return (
        <TouchableOpacity
          testID="chatRow"
          accessibilityRole="button"
          accessibilityLabel={identity.title}
          style={styles.threadRow}
          onPress={() => onOpenThread(item)}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>{identity.title.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.threadBody}>
            <View style={styles.threadHeader}>
              <Text style={styles.peerName} numberOfLines={1} ellipsizeMode="middle">
                {identity.title}
              </Text>
              {item.lastMessageAt ? (
                <Text style={styles.time}>{formatRelativeTime(item.lastMessageAt, nowMs)}</Text>
              ) : null}
            </View>
            {identity.subtitle ? (
              <Text style={styles.claimed} numberOfLines={1}>
                {identity.subtitle}
              </Text>
            ) : null}
            <View style={styles.threadPreview}>
              <Text style={styles.lastMessage} numberOfLines={1}>
                {item.lastMessage || COPY.noMessagesYet}
              </Text>
              {item.unreadCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [contacts, nowMs, onOpenThread],
  );

  const requestsRow = (
    <TouchableOpacity
      testID="chatsMessageRequests"
      accessibilityRole="button"
      accessibilityLabel={
        pendingRequests > 0 ? `${COPY.messageRequests}, ${pendingRequests}` : COPY.messageRequests
      }
      style={styles.requestsRow}
      onPress={onOpenRequests}
    >
      <Text style={styles.requestsLabel}>{COPY.messageRequests}</Text>
      {pendingRequests > 0 ? (
        <View testID="chatsRequestsBadge" style={styles.badge}>
          <Text style={styles.badgeText}>{pendingRequests > 99 ? '99+' : pendingRequests}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} testID="chatsScreen">
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <TouchableOpacity
          testID="chatsNew"
          accessibilityRole="button"
          accessibilityLabel={COPY.newChat}
          accessibilityState={{ disabled: needsEnable }}
          hitSlop={HIT_SLOP_44}
          disabled={needsEnable}
          onPress={onNewChat}
          style={[styles.newChatHit, needsEnable && styles.newChatDisabled]}
        >
          <Text style={styles.newChat}>+</Text>
        </TouchableOpacity>
      </View>
      {requestsRow}
      {showEnableCta ? (
        <EnableMessagingCta testID="chatsEnableMessaging" onPress={onEnableMessaging} />
      ) : null}
      {listError ? (
        <StatusBanner
          testID="chatsLoadError"
          label={listError}
          actionLabel={COPY.tryAgain}
          onAction={onRetry}
        />
      ) : null}
      {conversations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{COPY.noChatsYet}</Text>
          <Text style={styles.emptyHint}>{COPY.chatsEmptyBody}</Text>
          {!needsEnable ? (
            <TouchableOpacity
              testID="chatsEmptyAddContact"
              accessibilityRole="button"
              accessibilityLabel={COPY.addAContact}
              style={styles.primaryButton}
              onPress={onNewChat}
            >
              <Text style={styles.primaryButtonText}>{COPY.addAContact}</Text>
            </TouchableOpacity>
          ) : null}
          {ownerPubky ? (
            <TouchableOpacity
              testID="chatsCopyMyPubky"
              accessibilityRole="button"
              accessibilityLabel={COPY.copyMyPubky}
              style={styles.secondaryButton}
              onPress={onCopyMyPubky}
            >
              <Text style={styles.secondaryButtonText}>{COPY.copyMyPubky}</Text>
            </TouchableOpacity>
          ) : null}
          {ownerPubky ? (
            <TouchableOpacity
              testID="chatsShareMyPubky"
              accessibilityRole="button"
              accessibilityLabel={COPY.share}
              style={styles.textButton}
              onPress={onShareMyPubky}
            >
              <Text style={styles.textButtonText}>{COPY.share}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => item.conversationId}
          renderItem={renderThread}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

export function formatRelativeTime(ms: number, nowMs: number = Date.now()): string {
  const diff = nowMs - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(ms);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  title: { fontSize: typeRole.title.fontSize, fontWeight: '700', color: color.textPrimary },
  newChatHit: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChat: { fontSize: typeRole.display.fontSize, color: color.brand, fontWeight: '600' },
  newChatDisabled: { opacity: 0.4 },
  requestsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: measure.hitTarget,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
    backgroundColor: color.surface,
  },
  requestsLabel: { fontSize: typeRole.body.fontSize, color: color.textPrimary, fontWeight: '600' },
  list: { paddingVertical: space.xs },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    gap: space.lg,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.xxl,
    backgroundColor: color.well,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: typeRole.heading.fontSize, fontWeight: '600', color: color.brand },
  threadBody: { flex: 1, gap: space.xs },
  threadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  peerName: {
    flex: 1,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
    color: color.textPrimary,
    marginRight: space.sm,
  },
  claimed: { fontSize: typeRole.meta.fontSize, color: color.textSecondary },
  time: { fontSize: typeRole.meta.fontSize, color: color.textSecondary },
  threadPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    flex: 1,
    fontSize: typeRole.secondary.fontSize,
    color: color.textSecondary,
    marginRight: space.sm,
  },
  badge: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.sm,
  },
  badgeText: { color: color.textOnBrand, fontSize: typeRole.meta.fontSize, fontWeight: '700' },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
  },
  emptyText: { color: color.textPrimary, fontSize: typeRole.numeric.fontSize, fontWeight: '600' },
  emptyHint: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.xxl,
    minHeight: measure.hitTarget,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: color.textOnBrand,
    fontSize: typeRole.body.fontSize,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.xxl,
    minHeight: measure.hitTarget,
    alignItems: 'center',
  },
  secondaryButtonText: { color: color.textMuted, fontSize: typeRole.body.fontSize },
  textButton: { minHeight: measure.hitTarget, alignItems: 'center', justifyContent: 'center' },
  textButtonText: {
    color: color.brandText,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
