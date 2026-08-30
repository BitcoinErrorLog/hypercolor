import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types';
import { CHAT_ATTACHMENT_KIND, type AttachmentRecord } from '../../types/attachment';
import type { LinkMessage } from '../../types/link';
import { buildDmConversationId } from '../../types/link';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { LinkService } from '../../services/link/LinkService';
import { AttachmentBubble } from '../../components/AttachmentBubble';
import { ComposerAttachButton } from '../../components/ComposerAttachButton';
import { PaymentRequestBubble } from '../../components/PaymentRequestBubble';
import { PaymentComposeSheet } from '../../components/PaymentComposeSheet';
import { ThreadTipBar } from '../../components/ThreadTipBar';
import { EnableMessagingCta } from '../../components/EnableMessagingCta';
import { PaymentService } from '../../services/payments/PaymentService';
import { isPaykitPaymentKind, PaymentError, type PaymentRequestRecord } from '../../types/payment';
import type { TipEndpointRecord } from '../../types/payment';

type Props = NativeStackScreenProps<RootStackParamList, 'Thread'>;

type ThreadItem =
  | { id: string; sentAt: number; kind: 'link'; message: LinkMessage }
  | {
      id: string;
      sentAt: number;
      kind: 'attachment';
      record: AttachmentRecord;
      message?: LinkMessage;
    }
  | { id: string; sentAt: number; kind: 'payment'; record: PaymentRequestRecord };

export default function ThreadScreen({ route }: Props) {
  const { participantPubky } = route.params;
  const nav = useNavigation();
  const localPubky = useAuthStore(s => s.pubky);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkMessages, setLinkMessages] = useState<LinkMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRequestRecord[]>([]);
  const [tipEndpoints, setTipEndpoints] = useState<TipEndpointRecord[]>([]);
  const [composePayment, setComposePayment] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [messagingEnabled, setMessagingEnabled] = useState(LinkService.hasSession());

  const conversationId = buildDmConversationId(participantPubky);

  const reloadEncrypted = useCallback(async () => {
    if (!localPubky) return;
    const [msgs, atts, pays, tips] = await Promise.all([
      StorageService.getLinkMessagesForConversation(localPubky, conversationId, 200),
      StorageService.listAttachmentsForConversation(localPubky, conversationId),
      StorageService.listPaymentRequestsForPeer(localPubky, participantPubky),
      StorageService.listTipEndpoints(localPubky, participantPubky),
    ]);
    setLinkMessages(msgs);
    setAttachments(atts);
    setPayments(pays);
    setTipEndpoints(tips);
    setLoading(false);
    const latest = msgs.reduce((max, m) => Math.max(max, m.sentAt), 0);
    await LinkService.markRead(conversationId, latest > 0 ? latest : Date.now());
  }, [conversationId, localPubky, participantPubky]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (LinkService.hasSession()) {
          try {
            await LinkService.syncInbox();
          } catch {
            // Inbox drain is best-effort on focus; local history still renders.
          }
        }
        await reloadEncrypted();
        setMessagingEnabled(LinkService.hasSession());
      })();
    }, [reloadEncrypted]),
  );

  useEffect(() => {
    if (!localPubky) return;
    return LinkService.subscribeInboxSynced(owner => {
      if (owner === localPubky) void reloadEncrypted();
    });
  }, [localPubky, reloadEncrypted]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setSending(true);
    try {
      await LinkService.sendDm(participantPubky, text);
      await reloadEncrypted();
    } catch (err) {
      Alert.alert(
        'Send failed',
        err instanceof Error ? err.message : 'Could not send this message over Encrypted Links.',
      );
    } finally {
      setSending(false);
    }
  }, [draft, sending, participantPubky, reloadEncrypted]);

  return (
    <ThreadScreenContent
      participantPubky={participantPubky}
      localPubky={localPubky}
      draft={draft}
      sending={sending}
      loading={loading}
      linkMessages={linkMessages}
      attachments={attachments}
      payments={payments}
      tipEndpoints={tipEndpoints}
      composePayment={composePayment}
      paymentBusy={paymentBusy}
      onBack={() => nav.goBack()}
      onChangeDraft={setDraft}
      onSend={() => {
        void handleSend();
      }}
      onAttachSent={() => {
        void reloadEncrypted();
      }}
      onOpenPaymentCompose={() => setComposePayment(true)}
      onClosePaymentCompose={() => setComposePayment(false)}
      onSubmitPayment={(amountBtc, reference) => {
        setPaymentBusy(true);
        void PaymentService.requestPayment(participantPubky, { value: amountBtc }, reference)
          .then(() => {
            setComposePayment(false);
            void reloadEncrypted();
          })
          .catch(err => {
            Alert.alert(
              'Payment request',
              err instanceof PaymentError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Could not send payment request',
            );
          })
          .finally(() => setPaymentBusy(false));
      }}
      onPaymentsChanged={() => {
        void reloadEncrypted();
      }}
      messagingEnabled={messagingEnabled}
      onEnableMessaging={() => nav.navigate('EnableMessaging' as never)}
    />
  );
}

export function ThreadScreenContent({
  participantPubky,
  localPubky,
  draft,
  sending,
  loading,
  linkMessages,
  attachments,
  payments,
  tipEndpoints,
  composePayment,
  paymentBusy,
  onBack,
  onChangeDraft,
  onSend,
  onAttachSent,
  onOpenPaymentCompose,
  onClosePaymentCompose,
  onSubmitPayment,
  onPaymentsChanged,
  messagingEnabled,
  onEnableMessaging,
}: {
  participantPubky: string;
  localPubky: string | null;
  draft: string;
  sending: boolean;
  loading: boolean;
  linkMessages: LinkMessage[];
  attachments: AttachmentRecord[];
  payments: PaymentRequestRecord[];
  tipEndpoints: TipEndpointRecord[];
  composePayment: boolean;
  paymentBusy: boolean;
  onBack: () => void;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onAttachSent: () => void;
  onOpenPaymentCompose: () => void;
  onClosePaymentCompose: () => void;
  onSubmitPayment: (amountBtc: string, reference: string) => void;
  onPaymentsChanged: () => void;
  messagingEnabled: boolean;
  onEnableMessaging: () => void;
}) {
  const flatListRef = useRef<FlatList<ThreadItem>>(null);
  const items = useMemo(
    () => mergeThreadItems(linkMessages, attachments, payments),
    [linkMessages, attachments, payments],
  );

  useEffect(() => {
    if (items.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [items.length]);

  const renderItem = useCallback(
    ({ item }: { item: ThreadItem }) => {
      if (item.kind === 'payment') {
        const isMine = item.record.direction === 'sent';
        return (
          <View
            testID="threadPaymentBubble"
            style={[styles.bubble, isMine ? styles.mine : styles.theirs]}
          >
            {localPubky ? (
              <PaymentRequestBubble
                record={item.record}
                localPubky={localPubky}
                onChanged={onPaymentsChanged}
              />
            ) : null}
            <View style={styles.meta}>
              <Text style={styles.time}>{formatTime(item.sentAt)}</Text>
            </View>
          </View>
        );
      }
      if (item.kind === 'attachment') {
        const isMine = item.record.senderPubky === localPubky;
        return (
          <View style={[styles.bubble, isMine ? styles.mine : styles.theirs]}>
            <AttachmentBubble record={item.record} isMine={isMine} />
            <View style={styles.meta}>
              <Text style={styles.time}>{formatTime(item.sentAt)}</Text>
            </View>
          </View>
        );
      }
      const isMine = item.message.senderPubky === localPubky;
      return (
        <View
          testID={isMine ? 'threadBubbleMine' : 'threadBubbleTheirs'}
          accessibilityLabel={item.message.body}
          style={[styles.bubble, isMine ? styles.mine : styles.theirs]}
        >
          <Text style={[styles.bubbleText, isMine ? styles.mineText : styles.theirsText]}>
            {item.message.body}
          </Text>
          <View style={styles.meta}>
            <Text style={styles.time}>{formatTime(item.message.sentAt)}</Text>
            {isMine ? <Text style={styles.status}>{item.message.deliveryState}</Text> : null}
          </View>
        </View>
      );
    },
    [localPubky, onPaymentsChanged],
  );

  return (
    <SafeAreaView style={styles.container} testID="threadScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="threadBack"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text
          testID="threadTitle"
          accessibilityLabel={participantPubky}
          style={styles.title}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {participantPubky}
        </Text>
        <TouchableOpacity
          testID="threadRequestPay"
          accessibilityLabel="Request payment"
          onPress={onOpenPaymentCompose}
          style={styles.backBtn}
        >
          <Text style={styles.requestPay}>₿</Text>
        </TouchableOpacity>
      </View>
      <ThreadTipBar
        peerPubky={participantPubky}
        endpoints={tipEndpoints}
        onChanged={onPaymentsChanged}
      />
      {!messagingEnabled ? (
        <EnableMessagingCta testID="threadEnableMessaging" onPress={onEnableMessaging} />
      ) : null}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#7c3aed" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={items}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.composer}>
          <PaymentComposeSheet
            visible={composePayment}
            busy={paymentBusy}
            onClose={onClosePaymentCompose}
            onSubmit={onSubmitPayment}
          />
          <ComposerAttachButton
            target={{ type: 'conversation', peerPubky: participantPubky }}
            disabled={sending}
            onSent={onAttachSent}
          />
          <TextInput
            testID="threadComposer"
            accessibilityLabel="Message"
            style={styles.input}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder="Message…"
            placeholderTextColor="#4b5563"
            multiline
            maxLength={4000}
            returnKeyType="default"
          />
          <TouchableOpacity
            testID="threadSend"
            accessibilityLabel="Send message"
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            onPress={onSend}
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

function mergeThreadItems(
  linkMessages: LinkMessage[],
  attachments: AttachmentRecord[],
  payments: PaymentRequestRecord[],
): ThreadItem[] {
  const items: ThreadItem[] = [];
  const attachmentByEvent = new Map(attachments.map(a => [a.eventId, a]));
  const seenAttachment = new Set<string>();

  for (const record of payments) {
    items.push({
      id: `pay:${record.peerPubky}:${record.paymentRequestId}`,
      sentAt: record.createdAt,
      kind: 'payment',
      record,
    });
  }
  for (const message of linkMessages) {
    if (isPaykitPaymentKind(message.kind)) {
      continue;
    }
    if (message.kind === CHAT_ATTACHMENT_KIND) {
      const record = attachmentByEvent.get(message.eventId);
      if (record) {
        seenAttachment.add(record.eventId);
        items.push({
          id: `att:${record.eventId}`,
          sentAt: record.createdAt,
          kind: 'attachment',
          record,
          message,
        });
      }
      continue;
    }
    items.push({
      id: `link:${message.senderPubky}:${message.eventId}`,
      sentAt: message.sentAt,
      kind: 'link',
      message,
    });
  }
  for (const record of attachments) {
    if (seenAttachment.has(record.eventId)) continue;
    items.push({
      id: `att:${record.eventId}`,
      sentAt: record.createdAt,
      kind: 'attachment',
      record,
    });
  }
  return items.sort((a, b) => a.sentAt - b.sentAt);
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  requestPay: { fontSize: 18, color: '#c4b5fd', textAlign: 'right' },
});
