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
  Share,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, MessageRequest, RootStackParamList } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { LinkService } from '../../services/link/LinkService';
import { threadRouteParams } from '../../types/link';
import { COPY } from '../../copy/uxCopy';
import { HIT_SLOP_44 } from '../../ui/hitTarget';
import { peerIdentity } from '../../ui/peerIdentity';
import { copyText } from '../../utils/copyText';
import { sanitizeError } from '../../ui/sanitizedError';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import { CONTACTS_COPY } from '../../ui/contacts/contactsCopy';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type RequestRow = {
  request: MessageRequest;
  contact: Contact | null;
};

export default function MessageRequestsScreen() {
  const nav = useNavigation<Nav>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const [pendingRows, setPendingRows] = useState<RequestRow[]>([]);
  const [declinedRows, setDeclinedRows] = useState<RequestRow[]>([]);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerPubky) return;
    const [pending, declined] = await Promise.all([
      StorageService.listMessageRequests(ownerPubky, 'pending'),
      StorageService.listMessageRequests(ownerPubky, 'declined'),
    ]);
    const toRows = async (requests: MessageRequest[]): Promise<RequestRow[]> => {
      const next: RequestRow[] = [];
      for (const request of requests) {
        const contact = await StorageService.getContact(request.peerPubky, ownerPubky);
        next.push({ request, contact });
      }
      return next;
    };
    setPendingRows(await toRows(pending));
    setDeclinedRows(await toRows(declined));
    useSessionStatusStore.getState().setPendingRequestCount(pending.length);
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
        const sanitized = sanitizeError(err, 'Could not accept this request.');
        Alert.alert('Could not accept this request.', sanitized.message);
        await load();
      } finally {
        setBusyPeer(null);
      }
    },
    [load, nav],
  );

  const handleAcceptDeclined = useCallback(
    async (peerPubky: string) => {
      setBusyPeer(peerPubky);
      try {
        await LinkService.acceptDeclinedRequest(peerPubky);
        await load();
        nav.navigate('Thread', threadRouteParams(peerPubky));
      } catch (err) {
        const sanitized = sanitizeError(err, 'Could not accept this request.');
        Alert.alert('Could not accept this request.', sanitized.message);
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
        const sanitized = sanitizeError(err, 'Could not decline this request.');
        Alert.alert('Could not decline this request.', sanitized.message);
        await load();
      } finally {
        setBusyPeer(null);
      }
    },
    [load],
  );

  return (
    <MessageRequestsContent
      pendingRows={pendingRows}
      declinedRows={declinedRows}
      busyPeer={busyPeer}
      ownerPubky={ownerPubky}
      onBack={() => nav.goBack()}
      onAccept={peer => {
        void handleAccept(peer);
      }}
      onAcceptDeclined={peer => {
        void handleAcceptDeclined(peer);
      }}
      onDecline={peer => {
        void handleDecline(peer);
      }}
    />
  );
}

export function MessageRequestsContent({
  pendingRows,
  declinedRows,
  busyPeer,
  ownerPubky,
  onBack,
  onAccept,
  onAcceptDeclined,
  onDecline,
}: {
  pendingRows: RequestRow[];
  declinedRows: RequestRow[];
  busyPeer: string | null;
  ownerPubky: string | null;
  onBack: () => void;
  onAccept: (peerPubky: string) => void;
  onAcceptDeclined: (peerPubky: string) => void;
  onDecline: (peerPubky: string) => void;
}) {
  const renderPending = useCallback(
    ({ item }: { item: RequestRow }) => {
      const peer = item.request.peerPubky;
      const identity = peerIdentity(peer, item.contact);
      const busy = busyPeer === peer;
      return (
        <View style={styles.row}>
          <View style={styles.body}>
            <Text style={styles.name}>{identity.title}</Text>
            {identity.subtitle ? <Text style={styles.hint}>{identity.subtitle}</Text> : null}
            <Text style={styles.pubky} selectable>
              {peer}
            </Text>
            <Text style={styles.hint}>{COPY.inboundRequestHint}</Text>
          </View>
          <View style={styles.actions}>
            {busy ? (
              <ActivityIndicator color="#7c3aed" />
            ) : (
              <>
                <TouchableOpacity
                  testID="messageRequestAccept"
                  accessibilityRole="button"
                  accessibilityLabel="Accept message request"
                  style={styles.accept}
                  onPress={() => onAccept(peer)}
                >
                  <Text style={styles.acceptText}>{COPY.accept}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="messageRequestDecline"
                  accessibilityRole="button"
                  accessibilityLabel="Decline message request"
                  style={styles.decline}
                  onPress={() => onDecline(peer)}
                >
                  <Text style={styles.declineText}>{COPY.decline}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      );
    },
    [busyPeer, onAccept, onDecline],
  );

  const renderDeclined = useCallback(
    ({ item }: { item: RequestRow }) => {
      const peer = item.request.peerPubky;
      const identity = peerIdentity(peer, item.contact);
      const busy = busyPeer === peer;
      return (
        <View style={styles.row}>
          <View style={styles.body}>
            <Text style={styles.name}>{identity.title}</Text>
            {identity.subtitle ? <Text style={styles.hint}>{identity.subtitle}</Text> : null}
            <Text style={styles.pubky} selectable>
              {peer}
            </Text>
            <Text style={styles.hint}>{CONTACTS_COPY.declinedSection}</Text>
          </View>
          <View style={styles.actions}>
            {busy ? (
              <ActivityIndicator color="#7c3aed" />
            ) : (
              <TouchableOpacity
                testID="messageRequestAcceptDeclined"
                accessibilityRole="button"
                accessibilityLabel="Accept declined request"
                style={styles.accept}
                onPress={() => onAcceptDeclined(peer)}
              >
                <Text style={styles.acceptText}>{COPY.accept}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    },
    [busyPeer, onAcceptDeclined],
  );

  const inviteBlock = (
    <View style={styles.invite} testID="messageRequestsInvite">
      <Text style={styles.inviteBody}>{COPY.inviteBlockBody}</Text>
      {ownerPubky ? (
        <View style={styles.inviteActions}>
          <TouchableOpacity
            testID="messageRequestsCopyPubky"
            accessibilityRole="button"
            accessibilityLabel={COPY.copyMyPubky}
            style={styles.secondaryButton}
            onPress={() => copyText(ownerPubky)}
          >
            <Text style={styles.secondaryButtonText}>{COPY.copyMyPubky}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="messageRequestsSharePubky"
            accessibilityRole="button"
            accessibilityLabel={COPY.share}
            style={styles.secondaryButton}
            onPress={() => {
              void Share.share({ message: ownerPubky });
            }}
          >
            <Text style={styles.secondaryButtonText}>{COPY.share}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  const empty = pendingRows.length === 0 && declinedRows.length === 0;

  return (
    <SafeAreaView style={styles.container} testID="messageRequestsScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="messageRequestsBack"
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={HIT_SLOP_44}
          onPress={onBack}
          style={styles.backHit}
        >
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{COPY.messageRequests}</Text>
        <View style={styles.backHit} />
      </View>
      <Text style={styles.explainer}>{COPY.requestsExplainer}</Text>
      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{COPY.noPendingRequests}</Text>
          <Text style={styles.emptyHint}>{COPY.requestsEmptyBody}</Text>
          {inviteBlock}
        </View>
      ) : (
        <FlatList
          data={pendingRows}
          keyExtractor={item => item.request.peerPubky}
          renderItem={renderPending}
          ListFooterComponent={
            <>
              {declinedRows.length > 0 ? (
                <View>
                  <Text testID="messageRequestsDeclinedSection" style={styles.section}>
                    {CONTACTS_COPY.declinedSection}
                  </Text>
                  {declinedRows.map(item => (
                    <View key={item.request.peerPubky}>{renderDeclined({ item })}</View>
                  ))}
                </View>
              ) : null}
              {inviteBlock}
            </>
          }
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
  backHit: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  back: { color: '#8f57f0', fontSize: 16 },
  title: { fontSize: 17, fontWeight: '600', color: '#f9fafb' },
  explainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    color: '#808692',
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    color: '#c4b5fd',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
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
    minHeight: 44,
    justifyContent: 'center',
  },
  acceptText: { color: '#fff', fontWeight: '600' },
  decline: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  declineText: { color: '#d1d5db', fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 32 },
  emptyText: { color: '#f9fafb', fontSize: 16, fontWeight: '600' },
  emptyHint: { color: '#808692', fontSize: 14, textAlign: 'center' },
  invite: { paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  inviteBody: { color: '#808692', fontSize: 14, lineHeight: 20 },
  inviteActions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#9ca3af', fontSize: 15, fontWeight: '600' },
});
