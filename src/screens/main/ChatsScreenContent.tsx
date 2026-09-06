import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import type { Contact } from '../../types';
import type { LinkConversationSummary } from '../../types/link';
import { EnableMessagingCta } from '../../components/EnableMessagingCta';
import { StandbyBanner } from '../../components/StandbyBanner';
import { StatusBanner } from '../../ui/StatusBanner';
import { COPY } from '../../copy/uxCopy';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { peerIdentity } from '../../ui/peerIdentity';
import { color, space, typeRole, measure, radius } from '../../theme';
import { Avatar, Badge, Button, EmptyState, Icon, ListRow } from '../../ui/primitives';
import type { ChatListFilter } from '../../ui/chatList';

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
  nicknames?: Record<string, string>;
  listFilter?: ChatListFilter;
  onChangeFilter?: (filter: ChatListFilter) => void;
  onOpenSearch?: () => void;
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
  nicknames = {},
  listFilter = 'inbox',
  onChangeFilter,
  onOpenSearch,
}: ChatsScreenContentProps): React.ReactElement {
  const renderThread = useCallback(
    ({ item }: { item: LinkConversationSummary }) => {
      const row = contacts[item.participantPubky];
      const nick = nicknames[item.participantPubky];
      const identity = peerIdentity(
        item.participantPubky,
        row
          ? { ...row, ...(nick ? { nickname: nick } : {}) }
          : nick
            ? { addedManually: false, nickname: nick }
            : null,
      );
      const unread = item.unreadCount > 0;
      return (
        <ListRow
          testID="chatRow"
          accessibilityLabel={identity.title}
          title={identity.title}
          subtitle={
            identity.subtitle
              ? `${identity.subtitle} · ${item.lastMessage || COPY.noMessagesYet}`
              : item.lastMessage || COPY.noMessagesYet
          }
          meta={item.lastMessageAt ? formatRelativeTime(item.lastMessageAt, nowMs) : undefined}
          badge={item.unreadCount}
          unread={unread}
          leading={<Avatar name={identity.title} pubky={item.participantPubky} size="md" />}
          hideDivider={false}
          onPress={() => onOpenThread(item)}
        />
      );
    },
    [contacts, nicknames, nowMs, onOpenThread],
  );

  const requestsRow = (
    <ListRow
      testID="chatsMessageRequests"
      accessibilityLabel={
        pendingRequests > 0 ? `${COPY.messageRequests}, ${pendingRequests}` : COPY.messageRequests
      }
      title={COPY.messageRequests}
      leading={<Icon name="mail-unread-outline" tone="secondary" />}
      trailing={
        pendingRequests > 0 ? (
          <Badge
            testID="chatsRequestsBadge"
            label={pendingRequests > 99 ? '99+' : String(pendingRequests)}
            tone="brand"
          />
        ) : null
      }
      onPress={onOpenRequests}
    />
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
          <Icon name="add" tone={needsEnable ? 'muted' : 'brand'} />
        </TouchableOpacity>
        {onOpenSearch ? (
          <TouchableOpacity
            testID="chatsSearch"
            accessibilityRole="button"
            accessibilityLabel={COPY.messageSearchTitle}
            hitSlop={HIT_SLOP_44}
            onPress={onOpenSearch}
            style={styles.newChatHit}
          >
            <Icon name="search-outline" tone="brand" />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.sectionTitle}>{COPY.inbox}</Text>
      {onChangeFilter ? (
        <View style={styles.filters}>
          {(['inbox', 'archived', 'muted'] as const).map(filter => (
            <TouchableOpacity
              key={filter}
              testID={`chatsFilter-${filter}`}
              accessibilityRole="button"
              accessibilityState={{ selected: listFilter === filter }}
              accessibilityLabel={
                filter === 'inbox'
                  ? COPY.chatsFilterInbox
                  : filter === 'archived'
                    ? COPY.chatsFilterArchived
                    : COPY.chatsFilterMuted
              }
              hitSlop={HIT_SLOP_44}
              onPress={() => onChangeFilter(filter)}
              style={[styles.filterChip, listFilter === filter && styles.filterChipOn]}
            >
              <Text style={styles.filterText}>
                {filter === 'inbox'
                  ? COPY.chatsFilterInbox
                  : filter === 'archived'
                    ? COPY.chatsFilterArchived
                    : COPY.chatsFilterMuted}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <StandbyBanner />
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
          <EmptyState title={COPY.noChatsYet} body={COPY.chatsEmptyBody} testID="chatsEmptyState" />
          {!needsEnable ? (
            <Button
              testID="chatsEmptyAddContact"
              label={COPY.addAContact}
              onPress={onNewChat}
              style={styles.emptyButton}
            />
          ) : null}
          {ownerPubky ? (
            <Button
              testID="chatsCopyMyPubky"
              label={COPY.copyMyPubky}
              variant="secondary"
              onPress={onCopyMyPubky}
              style={styles.emptyButton}
            />
          ) : null}
          {ownerPubky ? (
            <Button
              testID="chatsShareMyPubky"
              label={COPY.share}
              variant="secondary"
              onPress={onShareMyPubky}
              style={styles.emptyButton}
            />
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
  newChatDisabled: { opacity: 0.4 },
  filters: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
  },
  filterChip: {
    minHeight: measure.hitTarget,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
  },
  filterChipOn: { backgroundColor: color.surfaceBrand },
  filterText: { color: color.textSecondary, fontSize: typeRole.caption.fontSize },
  sectionTitle: {
    color: color.textSecondary,
    fontSize: typeRole.caption.fontSize,
    lineHeight: typeRole.caption.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  list: { paddingVertical: space.xs },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
  },
  emptyButton: { alignSelf: 'stretch' },
});
