import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList, Thread } from '../../types';
import { useMessageStore } from '../../stores/messageStore';
import { StorageService } from '../../services/StorageService';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ChatsScreen() {
  const nav = useNavigation<Nav>();
  const threads = useMessageStore(s => Object.values(s.threads));

  // Load persisted threads on mount
  useEffect(() => {
    StorageService.getAllThreads().then(dbThreads => {
      dbThreads.forEach(t => useMessageStore.getState().upsertThread(t));
    });
  }, []);

  const sorted = [...threads].sort(
    (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
  );

  const handlePress = useCallback(
    (thread: Thread) => {
      nav.navigate('Thread', {
        threadId: thread.id,
        participantPubky: thread.participantPubky,
      });
    },
    [nav],
  );

  const renderThread = useCallback(
    ({ item }: { item: Thread }) => (
      <TouchableOpacity style={styles.threadRow} onPress={() => handlePress(item)}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {item.participantPubky.charAt(0).toUpperCase()}
          </Text>
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
              {item.lastMessage ?? 'No messages yet'}
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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <TouchableOpacity onPress={() => nav.navigate('ContactSearch')}>
          <Text style={styles.newChat}>+</Text>
        </TouchableOpacity>
      </View>
      {sorted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No conversations yet.</Text>
          <Text style={styles.emptyHint}>
            Search for a contact to start chatting.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => item.id}
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
