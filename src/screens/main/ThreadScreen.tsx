import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, Message } from '../../types';
import { useMessageStore } from '../../stores/messageStore';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { MessageRouter } from '../../services/MessageRouter';

type Props = NativeStackScreenProps<RootStackParamList, 'Thread'>;

export default function ThreadScreen({ route }: Props) {
  const { threadId, participantPubky } = route.params;
  const nav = useNavigation();
  const localPubky = useAuthStore(s => s.pubky);
  const storeMessages = useMessageStore(s => s.messages[threadId] ?? []);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList<Message>>(null);

  // Load initial messages from SQLite
  useEffect(() => {
    StorageService.getMessagesForThread(threadId, 50).then(msgs => {
      msgs.forEach(m => useMessageStore.getState().addMessage(threadId, m));
      setLoading(false);
      StorageService.markThreadRead(threadId);
    });
  }, [threadId]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (storeMessages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [storeMessages.length]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setSending(true);
    try {
      await MessageRouter.sendDM(participantPubky, text, threadId);
    } finally {
      setSending(false);
    }
  }, [draft, sending, participantPubky, threadId]);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isMine = item.senderPubky === localPubky;
      return (
        <View style={[styles.bubble, isMine ? styles.mine : styles.theirs]}>
          <Text style={[styles.bubbleText, isMine ? styles.mineText : styles.theirsText]}>
            {item.content}
          </Text>
          <View style={styles.meta}>
            <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
            {isMine && <Text style={styles.status}>{statusIcon(item.deliveryStatus)}</Text>}
          </View>
        </View>
      );
    },
    [localPubky],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="middle">
          {participantPubky}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#7c3aed" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={storeMessages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor="#4b5563"
            multiline
            maxLength={4000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendIcon}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusIcon(status: Message['deliveryStatus']): string {
  switch (status) {
    case 'pending':
      return '○';
    case 'sent_mesh':
      return '✓';
    case 'sent_pubky':
      return '✓';
    case 'delivered':
      return '✓✓';
    case 'failed':
      return '✗';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  backBtn: { width: 32 },
  backText: { fontSize: 22, color: '#7c3aed' },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: '#f9fafb', textAlign: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageList: { padding: 16, gap: 8 },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 2,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: '#7c3aed',
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f1f1f',
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  mineText: { color: '#fff' },
  theirsText: { color: '#f9fafb' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  time: { fontSize: 10, color: 'rgba(255,255,255,0.5)' },
  status: { fontSize: 10, color: 'rgba(255,255,255,0.5)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#f9fafb',
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
