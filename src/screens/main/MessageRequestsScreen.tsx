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
import { color, space, radius, typeRole, measure } from '../../theme';

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
              <ActivityIndicator color={color.brand} />
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
              <ActivityIndicator color={color.brand} />
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
  container: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  backHit: { minWidth: measure.hitTarget, minHeight: measure.hitTarget, justifyContent: 'center' },
  back: { color: color.brandText, fontSize: typeRole.body.fontSize },
  title: { fontSize: typeRole.titleStack.fontSize, fontWeight: '600', color: color.textPrimary },
  explainer: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: 20,
  },
  section: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    color: color.brandMuted,
    fontSize: typeRole.caption.fontSize,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  row: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
    gap: space.md,
  },
  body: { gap: space.xs },
  name: { fontSize: typeRole.body.fontSize, fontWeight: '600', color: color.textPrimary },
  pubky: { fontSize: typeRole.meta.fontSize, color: color.textSecondary, fontFamily: 'monospace' },
  hint: { fontSize: typeRole.caption.fontSize, color: color.textSecondary },
  actions: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  accept: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    justifyContent: 'center',
  },
  acceptText: { color: color.textOnBrand, fontWeight: '600' },
  decline: {
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: measure.hitTarget,
    justifyContent: 'center',
  },
  declineText: { color: color.textMuted, fontWeight: '600' },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xxxl,
  },
  emptyText: { color: color.textPrimary, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  emptyHint: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    textAlign: 'center',
  },
  invite: { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.md },
  inviteBody: { color: color.textSecondary, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
  inviteActions: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: measure.hitTarget,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: color.textMuted,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
