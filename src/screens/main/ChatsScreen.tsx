import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types';
import type { LinkConversationSummary } from '../../types/link';
import { threadRouteParams } from '../../types/link';
import { StorageService } from '../../services/StorageService';
import { KeyStore } from '../../services/KeyStore';
import { LinkService } from '../../services/link/LinkService';
import { useAuthStore } from '../../stores/authStore';
import { EnableMessagingCta } from '../../components/EnableMessagingCta';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function isMessagingEnabled(): boolean {
  return LinkService.hasSession() || Boolean(KeyStore.getLinkSession());
}

export default function ChatsScreen() {
  const nav = useNavigation<Nav>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const [conversations, setConversations] = useState<LinkConversationSummary[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [messagingEnabled, setMessagingEnabled] = useState(isMessagingEnabled);

  const loadLocal = useCallback(async () => {
    if (!ownerPubky) {
      setConversations([]);
      setPendingRequests(0);
      return;
    }
    const [rows, pending] = await Promise.all([
      StorageService.listLinkConversations(ownerPubky),
      StorageService.countPendingMessageRequests(ownerPubky),
    ]);
    setConversations(rows);
    setPendingRequests(pending);
    setMessagingEnabled(isMessagingEnabled());
  }, [ownerPubky]);

  const refresh = useCallback(async () => {
    if (ownerPubky && LinkService.hasSession()) {
      try {
        await LinkService.syncInbox();
      } catch {
        // Local conversation list still refreshes below.
      }
    }
    await loadLocal();
  }, [loadLocal, ownerPubky]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    return LinkService.subscribeInboxSynced(owner => {
      if (owner === ownerPubky) void loadLocal();
    });
  }, [loadLocal, ownerPubky]);

  const handlePress = useCallback(
    (row: LinkConversationSummary) => {
      nav.navigate('Thread', threadRouteParams(row.participantPubky));
    },
    [nav],
  );

  const renderThread = useCallback(
    ({ item }: { item: LinkConversationSummary }) => (
      <TouchableOpacity
        testID="chatRow"
        accessibilityLabel={item.participantPubky}
        style={styles.threadRow}
        onPress={() => handlePress(item)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{item.participantPubky.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.threadBody}>
          <View style={styles.threadHeader}>
            <Text style={styles.peerName} numberOfLines={1} ellipsizeMode="middle">
              {item.participantPubky}
            </Text>
            {item.lastMessageAt ? (
              <Text style={styles.time}>{formatRelativeTime(item.lastMessageAt)}</Text>
            ) : null}
          </View>
          <View style={styles.threadPreview}>
            <Text style={styles.lastMessage} numberOfLines={1}>
              {item.lastMessage || 'No messages yet'}
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
    ),
    [handlePress],
  );

  return (
    <SafeAreaView style={styles.container} testID="chatsScreen">
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            testID="chatsRequests"
            accessibilityLabel="Message requests"
            onPress={() => nav.navigate('MessageRequests')}
          >
            <Text style={styles.requests}>
              Requests{pendingRequests > 0 ? ` (${pendingRequests})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="chatsNew"
            accessibilityLabel="New chat"
            onPress={() => nav.navigate('ContactSearch')}
          >
            <Text style={styles.newChat}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
      {!messagingEnabled ? (
        <EnableMessagingCta
          testID="chatsEnableMessaging"
          onPress={() => nav.navigate('EnableMessaging')}
        />
      ) : null}
      {conversations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No conversations yet.</Text>
          <Text style={styles.emptyHint}>Search for a contact to start chatting.</Text>
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

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#f9fafb' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  requests: { fontSize: 15, color: '#7c3aed', fontWeight: '600' },
  newChat: { fontSize: 28, color: '#7c3aed', fontWeight: '600' },
  list: { paddingVertical: 4 },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1f2937',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '600', color: '#7c3aed' },
  threadBody: { flex: 1, gap: 4 },
  threadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  peerName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#f9fafb',
    marginRight: 8,
  },
  time: { fontSize: 12, color: '#4b5563' },
  threadPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: { flex: 1, fontSize: 14, color: '#6b7280', marginRight: 8 },
  badge: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyText: { color: '#6b7280', fontSize: 16 },
  emptyHint: { color: '#4b5563', fontSize: 14 },
});
