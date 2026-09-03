import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, Alert, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, MessageRequest, RootStackParamList } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { LinkService } from '../../services/link/LinkService';
import { threadRouteParams } from '../../types/link';
import { COPY } from '../../copy/uxCopy';
import { peerIdentity } from '../../ui/peerIdentity';
import { copyText } from '../../utils/copyText';
import { sanitizeError } from '../../ui/sanitizedError';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import { CONTACTS_COPY } from '../../ui/contacts/contactsCopy';
import { shortPubky } from '../../ui/shortPubky';
import { color, space, typeRole } from '../../theme';
import {
  Avatar,
  Button,
  EmptyState,
  ListRow,
  LoadingState,
  PageHeader,
  PubkyChip,
  StatusBanner,
} from '../../ui/primitives';

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
      const peerShort = shortPubky(peer);
      const busy = busyPeer === peer;
      return (
        <View style={styles.requestCard}>
          <ListRow
            title={identity.title}
            subtitle={identity.subtitle ?? undefined}
            leading={<Avatar name={identity.title} pubky={peer} size="md" />}
            showChevron={false}
            hideDivider
          />
          <View style={styles.body}>
            <PubkyChip
              pubky={peer}
              onCopy={() => copyText(peer)}
              copyLabel={`Copy pubky ${peerShort}`}
              testID="messageRequestPubkyChip"
            />
            <Text style={styles.hint}>{COPY.inboundRequestHint}</Text>
          </View>
          <View style={styles.actions}>
            {busy ? (
              <LoadingState label="Updating request" />
            ) : (
              <>
                <Button
                  testID="messageRequestAccept"
                  label={COPY.accept}
                  accessibilityLabel={`Accept message request from ${peerShort}`}
                  onPress={() => onAccept(peer)}
                  style={styles.actionButton}
                />
                <Button
                  testID="messageRequestDecline"
                  label={COPY.decline}
                  accessibilityLabel={`Decline message request from ${peerShort}`}
                  variant="destructive"
                  onPress={() => onDecline(peer)}
                  style={styles.actionButton}
                />
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
      const peerShort = shortPubky(peer);
      const busy = busyPeer === peer;
      return (
        <View style={styles.requestCard}>
          <ListRow
            title={identity.title}
            subtitle={identity.subtitle ?? undefined}
            leading={<Avatar name={identity.title} pubky={peer} size="md" />}
            showChevron={false}
            hideDivider
          />
          <View style={styles.body}>
            <PubkyChip
              pubky={peer}
              onCopy={() => copyText(peer)}
              copyLabel={`Copy pubky ${peerShort}`}
              testID="messageRequestPubkyChip"
            />
            <Text style={styles.hint}>{CONTACTS_COPY.declinedSection}</Text>
          </View>
          <View style={styles.actions}>
            {busy ? (
              <LoadingState label="Updating request" />
            ) : (
              <Button
                testID="messageRequestAcceptDeclined"
                label={COPY.accept}
                accessibilityLabel={`Accept declined request from ${peerShort}`}
                onPress={() => onAcceptDeclined(peer)}
                style={styles.actionButton}
              />
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
          <Button
            testID="messageRequestsCopyPubky"
            label={COPY.copyMyPubky}
            variant="secondary"
            onPress={() => copyText(ownerPubky)}
          />
          <Button
            testID="messageRequestsSharePubky"
            label={COPY.share}
            variant="secondary"
            onPress={() => {
              void Share.share({ message: ownerPubky });
            }}
          />
        </View>
      ) : null}
    </View>
  );

  const empty = pendingRows.length === 0 && declinedRows.length === 0;

  return (
    <SafeAreaView style={styles.container} testID="messageRequestsScreen">
      <PageHeader title={COPY.messageRequests} onBack={onBack} testID="messageRequests" />
      <StatusBanner label={COPY.requestsExplainer} />
      {empty ? (
        <View style={styles.empty}>
          <EmptyState title={COPY.noPendingRequests} body={COPY.requestsEmptyBody} />
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
  container: { flex: 1, backgroundColor: color.canvas },
  section: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    color: color.brandMuted,
    fontSize: typeRole.caption.fontSize,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  requestCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
    paddingBottom: space.md,
  },
  body: { gap: space.xs, paddingHorizontal: space.xl },
  hint: { fontSize: typeRole.caption.fontSize, color: color.textSecondary },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  actionButton: { flex: 1 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xxxl,
  },
  invite: { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.md },
  inviteBody: { color: color.textSecondary, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
  inviteActions: { gap: space.sm },
});
