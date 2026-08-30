import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, MessageRequest, RootStackParamList } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { LinkService } from '../../services/link/LinkService';
import { threadRouteParams } from '../../types/link';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type RequestRow = {
  request: MessageRequest;
  contact: Contact | null;
};

export default function MessageRequestsScreen() {
  const nav = useNavigation<Nav>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerPubky) return;
    const pending = await StorageService.listMessageRequests(ownerPubky, 'pending');
    const next: RequestRow[] = [];
    for (const request of pending) {
      const contact = await StorageService.getContact(request.peerPubky, ownerPubky);
      next.push({ request, contact });
    }
    setRows(next);
  }, [ownerPubky]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = useCallback(
    async (peerPubky: string) => {
      setBusyPeer(peerPubky);
      try {
        await LinkService.acceptMessageRequest(peerPubky);
        await load();
        nav.navigate('Thread', threadRouteParams(peerPubky));
      } catch (err) {
        Alert.alert(
          'Accept failed',
          err instanceof Error ? err.message : 'Could not accept this request.',
        );
        await load();
      } finally {
        setBusyPeer(null);
      }
    },
    [load, nav],
  );

  const handleDecline = useCallback(
    async (peerPubky: string) => {
      setBusyPeer(peerPubky);
      try {
        await LinkService.declineMessageRequest(peerPubky);
        await load();
      } catch (err) {
        Alert.alert(
          'Decline failed',
          err instanceof Error ? err.message : 'Could not decline this request.',
        );
        await load();
      } finally {
        setBusyPeer(null);
      }
    },
    [load],
  );

  return (
    <MessageRequestsContent
      rows={rows}
      busyPeer={busyPeer}
      onBack={() => nav.goBack()}
      onAccept={peer => {
        void handleAccept(peer);
      }}
      onDecline={peer => {
        void handleDecline(peer);
      }}
    />
  );
}

export function MessageRequestsContent({
  rows,
  busyPeer,
  onBack,
  onAccept,
  onDecline,
}: {
  rows: RequestRow[];
  busyPeer: string | null;
  onBack: () => void;
  onAccept: (peerPubky: string) => void;
  onDecline: (peerPubky: string) => void;
}) {
  const renderRow = useCallback(
    ({ item }: { item: RequestRow }) => {
      const peer = item.request.peerPubky;
      const name = item.contact?.displayName ?? `${peer.slice(0, 6)}…${peer.slice(-4)}`;
      const busy = busyPeer === peer;
      return (
        <View style={styles.row}>
          <View style={styles.body}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.pubky} numberOfLines={1} ellipsizeMode="middle">
              {peer}
            </Text>
            <Text style={styles.hint}>Inbound message request</Text>
          </View>
          <View style={styles.actions}>
            {busy ? (
              <ActivityIndicator color="#7c3aed" />
            ) : (
              <>
                <TouchableOpacity
                  testID="messageRequestAccept"
                  accessibilityLabel="Accept message request"
                  style={styles.accept}
                  onPress={() => onAccept(peer)}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="messageRequestDecline"
                  accessibilityLabel="Decline message request"
                  style={styles.decline}
                  onPress={() => onDecline(peer)}
                >
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      );
    },
    [busyPeer, onAccept, onDecline],
  );

  return (
    <SafeAreaView style={styles.container} testID="messageRequestsScreen">
      <View style={styles.header}>
        <TouchableOpacity testID="messageRequestsBack" accessibilityLabel="Back" onPress={onBack}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Message requests</Text>
        <View style={{ width: 60 }} />
      </View>
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No pending requests.</Text>
          <Text style={styles.emptyHint}>
            Inbound links from people you do not follow wait here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.request.peerPubky}
          renderItem={renderRow}
        />
      )}
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
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
    gap: 12,
  },
  body: { gap: 4 },
  name: { fontSize: 16, fontWeight: '600', color: '#f9fafb' },
  pubky: { fontSize: 12, color: '#4b5563', fontFamily: 'monospace' },
  hint: { fontSize: 13, color: '#6b7280' },
  actions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  accept: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  acceptText: { color: '#fff', fontWeight: '600' },
  decline: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  declineText: { color: '#d1d5db', fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyText: { color: '#6b7280', fontSize: 16 },
  emptyHint: { color: '#4b5563', fontSize: 14, textAlign: 'center' },
});
