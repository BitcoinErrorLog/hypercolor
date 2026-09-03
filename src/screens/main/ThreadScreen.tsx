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
  Linking,
  AccessibilityInfo,
  findNodeHandle,
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
import {
  pickAndSendFile,
  pickAndSendPhoto,
  type ComposerAttachNotice,
} from '../../components/ComposerAttachButton';
import { ComposerActionMenu } from '../../components/ComposerActionMenu';
import {
  PaymentRequestBubble,
  type PaymentReviewRequest,
} from '../../components/PaymentRequestBubble';
import { useTickingNow } from '../../components/PaymentRequestCard';
import { PaymentComposeSheet } from '../../components/PaymentComposeSheet';
import { PaymentReviewSheet } from '../../components/PaymentReviewSheet';
import { ThreadDeniedBanner } from './contacts/ThreadDeniedBanner';
import { ThreadDeclinedNotice } from './contacts/ThreadDeclinedNotice';
import { useThreadPeerGate } from './contacts/useThreadPeerGate';
import { ThreadTipBarContent } from '../../components/ThreadTipBar';
import { EnableMessagingCta } from '../../components/EnableMessagingCta';
import { PaymentService } from '../../services/payments/PaymentService';
import {
  isPaykitPaymentKind,
  PaymentError,
  isPositiveBtcAmount,
  type PaymentRequestRecord,
} from '../../types/payment';
import type { TipEndpointRecord } from '../../types/payment';
import { COPY, messageByteCountLabel } from '../../copy/uxCopy';
import { HIT_SLOP_44, minHitStyle } from '../../ui/hitTarget';
import { formatDeliveryState, formatLinkStatus } from '../../ui/messageStatus';
import { peerIdentity } from '../../ui/peerIdentity';
import { copyText } from '../../utils/copyText';
import type { Contact } from '../../types';
import type { LinkStatus } from '../../types/link';
import { LINK_MESSAGE_MAX_BYTES } from '../../types/link';
import { StatusBanner } from '../../ui/StatusBanner';
import { useSessionStatusStore } from '../../stores/sessionStatusStore';
import { sanitizeError } from '../../ui/sanitizedError';
import {
  composerActionItems,
  draftEnvelopeByteSize,
  draftExceedsByteCap,
} from '../../ui/composerActions';
import { mapPaymentReview } from '../../ui/paymentReview';
import { openBuiltUri } from '../../services/payments/walletHandoff';
import { continuePaymentReview } from './continuePaymentReview';
import { eventIdsWithDeliveryQueue } from '../../ui/failedSendRetry';
import { useReduceMotion } from '../../ui/reduceMotion';
import { color, space, radius, typeRole, measure } from '../../theme';
import { Icon, MessageBubble } from '../../ui/primitives';

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
  const [composeIntent, setComposeIntent] = useState<'request' | 'tip'>('request');
  const [pendingTipEndpoint, setPendingTipEndpoint] = useState<TipEndpointRecord | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [tipPickerOpen, setTipPickerOpen] = useState(false);
  const [review, setReview] = useState<PaymentReviewRequest | null>(null);
  const [walletUnavailable, setWalletUnavailable] = useState(false);
  const [recordFailed, setRecordFailed] = useState(false);
  const [reviewHandoffError, setReviewHandoffError] = useState<string | null>(null);
  const [composerNotice, setComposerNotice] = useState<ComposerAttachNotice | null>(null);
  const [peerContact, setPeerContact] = useState<Contact | null>(null);
  const [linkStatus, setLinkStatus] = useState<LinkStatus | null>(null);
  const [retryableEventIds, setRetryableEventIds] = useState<Set<string>>(() => new Set());
  const [requestStatus, setRequestStatus] = useState<'pending' | 'accepted' | 'declined' | null>(
    null,
  );
  const { peerBlocked, runUnblock } = useThreadPeerGate(localPubky, participantPubky);
  const sessionKind = useSessionStatusStore(s => s.kind);

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
    const failedIds = [
      ...msgs.filter(row => row.deliveryState === 'failed').map(row => row.eventId),
      ...atts.filter(row => row.deliveryState === 'failed').map(row => row.eventId),
    ];
    setRetryableEventIds(await eventIdsWithDeliveryQueue(failedIds));
    setLoading(false);
    const latest = msgs.reduce((max, m) => Math.max(max, m.sentAt), 0);
    await LinkService.markRead(conversationId, latest > 0 ? latest : Date.now());
    const contact = await StorageService.getContact(participantPubky, localPubky);
    setPeerContact(contact);
    const request = await StorageService.getMessageRequest(localPubky, participantPubky);
    setRequestStatus(request?.status ?? null);
    try {
      setLinkStatus(await LinkService.getLinkStatus(participantPubky));
    } catch {
      setLinkStatus(null);
    }
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
    if (!text || sending || peerBlocked || draftExceedsByteCap(text, { surface: 'dm' })) return;
    setSending(true);
    try {
      await LinkService.sendDm(participantPubky, text);
      setDraft('');
      await reloadEncrypted();
    } catch {
      await reloadEncrypted();
    } finally {
      setSending(false);
    }
  }, [draft, sending, peerBlocked, participantPubky, reloadEncrypted]);

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
      composeIntent={composeIntent}
      paymentBusy={paymentBusy}
      actionMenuOpen={actionMenuOpen}
      tipPickerOpen={tipPickerOpen}
      review={review}
      walletUnavailable={walletUnavailable}
      recordFailed={recordFailed}
      reviewHandoffError={reviewHandoffError}
      retryableEventIds={retryableEventIds}
      peerBlocked={peerBlocked}
      peerDeclined={requestStatus === 'declined' && !peerBlocked}
      onUnblock={runUnblock}
      composerNotice={composerNotice}
      onBack={() => nav.goBack()}
      onChangeDraft={setDraft}
      onSend={() => {
        void handleSend();
      }}
      onOpenActionMenu={() => setActionMenuOpen(true)}
      onCloseActionMenu={() => {
        setActionMenuOpen(false);
      }}
      onComposerAction={id => {
        setActionMenuOpen(false);
        if (id === 'photo') {
          void pickAndSendPhoto({ type: 'conversation', peerPubky: participantPubky }).then(
            result => {
              if (result.ok) void reloadEncrypted();
              else if ('notice' in result) setComposerNotice(result.notice);
            },
          );
          return;
        }
        if (id === 'file') {
          void pickAndSendFile({ type: 'conversation', peerPubky: participantPubky }).then(
            result => {
              if (result.ok) void reloadEncrypted();
              else if ('notice' in result) setComposerNotice(result.notice);
            },
          );
          return;
        }
        if (id === 'request-payment') {
          setComposeIntent('request');
          setComposePayment(true);
        }
        if (id === 'send-tip') setTipPickerOpen(true);
        if (id === 'send-tip-list') {
          void PaymentService.sendTipList(participantPubky)
            .then(() => {
              void reloadEncrypted();
            })
            .catch(err => {
              const sanitized = sanitizeError(
                err instanceof PaymentError || err instanceof Error
                  ? err
                  : 'Could not send tip list',
                'Could not send tip list',
              );
              Alert.alert('Tip list', sanitized.message);
            });
        }
      }}
      onClosePaymentCompose={() => {
        setComposePayment(false);
        setPendingTipEndpoint(null);
        setComposeIntent('request');
      }}
      onSubmitPayment={(amountBtc, reference) => {
        if (composeIntent === 'tip' && pendingTipEndpoint) {
          if (!isPositiveBtcAmount(amountBtc)) return;
          setComposePayment(false);
          setReview({
            kind: 'tip',
            record: null,
            peerPubky: participantPubky,
            amountBtc,
            amountAsset: 'btc',
            reference: null,
            destinations: [pendingTipEndpoint],
            selected: pendingTipEndpoint,
          });
          setPendingTipEndpoint(null);
          setComposeIntent('request');
          return;
        }
        setPaymentBusy(true);
        void PaymentService.requestPayment(participantPubky, { value: amountBtc }, reference)
          .then(() => {
            setComposePayment(false);
            void reloadEncrypted();
          })
          .catch(err => {
            const sanitized = sanitizeError(
              err instanceof PaymentError || err instanceof Error
                ? err
                : 'Could not send payment request',
              'Could not send payment request',
            );
            Alert.alert('Payment request', sanitized.message);
          })
          .finally(() => setPaymentBusy(false));
      }}
      onPaymentsChanged={() => {
        void reloadEncrypted();
      }}
      onReview={next => {
        setWalletUnavailable(false);
        setReviewHandoffError(null);
        setReview(next);
        setTipPickerOpen(false);
      }}
      onCloseReview={() => {
        setReview(null);
        setWalletUnavailable(false);
        setRecordFailed(false);
        setReviewHandoffError(null);
      }}
      onCloseTipPicker={() => setTipPickerOpen(false)}
      onNeedTipAmount={endpoint => {
        setPendingTipEndpoint(endpoint);
        setComposeIntent('tip');
        setComposePayment(true);
        setTipPickerOpen(false);
      }}
      onContinueReview={() => {
        if (!review) return;
        void (async () => {
          try {
            const result = await continuePaymentReview(review, {
              canOpenURL: url => Linking.canOpenURL(url),
              openUri: url => openBuiltUri(url),
              recordDisplayedInvoice: (peer, paymentRequestId, paymentHash, endpointIdentifier) =>
                PaymentService.recordDisplayedInvoice(
                  peer,
                  paymentRequestId,
                  paymentHash,
                  endpointIdentifier,
                ),
              recordDisplayedTipInvoice: (endpointIdentifier, paymentHash) =>
                PaymentService.recordDisplayedTipInvoice(endpointIdentifier, paymentHash),
            });
            setWalletUnavailable(result.walletUnavailable);
            setRecordFailed(result.recordFailed);
            setReviewHandoffError(result.error);
            if (result.closeReview) {
              setReview(null);
              setWalletUnavailable(false);
              setRecordFailed(false);
              setReviewHandoffError(null);
            }
          } catch (err) {
            setWalletUnavailable(true);
            setRecordFailed(false);
            setReviewHandoffError(sanitizeError(err, COPY.couldNotOpenWallet).message);
          }
        })();
      }}
      sessionKind={sessionKind}
      peerContact={peerContact}
      linkStatus={linkStatus}
      onEnableMessaging={() => nav.navigate('EnableMessaging' as never)}
      onRetryFailed={eventId => {
        void (async () => {
          if (!retryableEventIds.has(eventId)) return;
          try {
            await LinkService.recoverPendingSends();
            await LinkService.drainRetries();
          } catch {
            setRetryableEventIds(prev => {
              const next = new Set(prev);
              next.delete(eventId);
              return next;
            });
          }
          await reloadEncrypted();
        })();
      }}
      onCopyPubky={() => copyText(participantPubky)}
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
  composeIntent,
  paymentBusy,
  actionMenuOpen,
  tipPickerOpen,
  review,
  walletUnavailable,
  recordFailed,
  reviewHandoffError,
  retryableEventIds,
  peerBlocked,
  peerDeclined,
  onUnblock,
  composerNotice,
  onBack,
  onChangeDraft,
  onSend,
  onOpenActionMenu,
  onCloseActionMenu,
  onComposerAction,
  onClosePaymentCompose,
  onSubmitPayment,
  onPaymentsChanged,
  onReview,
  onCloseReview,
  onCloseTipPicker,
  onNeedTipAmount,
  onContinueReview,
  sessionKind,
  peerContact,
  linkStatus,
  onEnableMessaging,
  onRetryFailed,
  onCopyPubky,
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
  composeIntent: 'request' | 'tip';
  paymentBusy: boolean;
  actionMenuOpen: boolean;
  tipPickerOpen: boolean;
  review: PaymentReviewRequest | null;
  walletUnavailable: boolean;
  recordFailed: boolean;
  reviewHandoffError: string | null;
  retryableEventIds: ReadonlySet<string>;
  peerBlocked: boolean;
  peerDeclined: boolean;
  onUnblock: () => void;
  composerNotice: ComposerAttachNotice | null;
  onBack: () => void;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onOpenActionMenu: () => void;
  onCloseActionMenu: () => void;
  onComposerAction: (
    id: 'photo' | 'file' | 'request-payment' | 'send-tip' | 'send-tip-list',
  ) => void;
  onClosePaymentCompose: () => void;
  onSubmitPayment: (amountBtc: string, reference: string) => void;
  onPaymentsChanged: () => void;
  onReview: (request: PaymentReviewRequest) => void;
  onCloseReview: () => void;
  onCloseTipPicker: () => void;
  onNeedTipAmount: (endpoint: TipEndpointRecord) => void;
  onContinueReview: (uri: string) => void;
  sessionKind: 'offline' | 'needs-enable' | 'revoked' | string;
  peerContact: Contact | null;
  linkStatus: LinkStatus | null;
  onEnableMessaging: () => void;
  onRetryFailed: (eventId: string) => void;
  onCopyPubky: () => void;
}) {
  const flatListRef = useRef<FlatList<ThreadItem>>(null);
  const plusRef = useRef<View>(null);
  const menuWasOpen = useRef(false);
  const reduceMotion = useReduceMotion();
  const items = useMemo(
    () => mergeThreadItems(linkMessages, attachments, payments),
    [linkMessages, attachments, payments],
  );

  useEffect(() => {
    if (items.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: !reduceMotion });
    }
  }, [items.length, reduceMotion]);

  useEffect(() => {
    if (actionMenuOpen) {
      menuWasOpen.current = true;
      return;
    }
    if (!menuWasOpen.current) return;
    menuWasOpen.current = false;
    const tag = findNodeHandle(plusRef.current);
    if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
  }, [actionMenuOpen]);

  const renderItem = useCallback(
    ({ item }: { item: ThreadItem }) => {
      if (item.kind === 'payment') {
        const isMine = item.record.direction === 'sent';
        return (
          <MessageBubble testID="threadPaymentBubble" mine={isMine} time={formatTime(item.sentAt)}>
            {localPubky ? (
              <PaymentRequestBubble
                record={item.record}
                localPubky={localPubky}
                onChanged={onPaymentsChanged}
                onReview={onReview}
              />
            ) : null}
          </MessageBubble>
        );
      }
      if (item.kind === 'attachment') {
        const isMine = item.record.senderPubky === localPubky;
        return (
          <MessageBubble
            testID={isMine ? 'threadAttachmentBubbleMine' : 'threadAttachmentBubbleTheirs'}
            mine={isMine}
            time={formatTime(item.sentAt)}
          >
            <AttachmentBubble
              record={item.record}
              isMine={isMine}
              onRetrySend={
                retryableEventIds.has(item.record.eventId)
                  ? () => onRetryFailed(item.record.eventId)
                  : undefined
              }
            />
          </MessageBubble>
        );
      }
      const isMine = item.message.senderPubky === localPubky;
      return (
        <MessageBubble
          testID={isMine ? 'threadBubbleMine' : 'threadBubbleTheirs'}
          mine={isMine}
          time={formatTime(item.message.sentAt)}
          status={isMine ? formatDeliveryState(item.message.deliveryState) : null}
          failed={item.message.deliveryState === 'failed'}
        >
          <Text style={[styles.bubbleText, isMine ? styles.mineText : styles.theirsText]}>
            {item.message.body}
          </Text>
          {isMine && item.message.deliveryState === 'failed' && !peerBlocked ? (
            retryableEventIds.has(item.message.eventId) ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={COPY.retry}
                hitSlop={HIT_SLOP_44}
                onPress={() => onRetryFailed(item.message.eventId)}
              >
                <Text style={styles.retry}>{COPY.retry}</Text>
              </TouchableOpacity>
            ) : (
              <Text
                testID="threadSendTerminal"
                accessibilityRole="text"
                style={styles.statusFailed}
              >
                {COPY.couldNotSendStartAgain}
              </Text>
            )
          ) : null}
        </MessageBubble>
      );
    },
    [localPubky, onPaymentsChanged, onRetryFailed, onReview, peerBlocked, retryableEventIds],
  );

  const identity = peerIdentity(participantPubky, peerContact);
  const linkLabel = formatLinkStatus(linkStatus);
  const needsEnable =
    sessionKind === 'needs-enable' || sessionKind === 'revoked' || sessionKind === 'unavailable';
  const composerEnabled = !needsEnable && !peerBlocked;
  const inboxClosed = linkStatus === 'not-enrolled';
  const actions = composerActionItems('dm', {
    messagingEnabled: composerEnabled,
    inboxClosed,
    hasTipEndpoints: tipEndpoints.some(row => row.validationStatus !== 'rejected'),
  });
  const byteSize = draftEnvelopeByteSize(draft, { surface: 'dm' });
  const overCap = draftExceedsByteCap(draft, { surface: 'dm' });
  const showByteCap = byteSize >= LINK_MESSAGE_MAX_BYTES * 0.8 || overCap;
  const byteLabel = messageByteCountLabel(byteSize, LINK_MESSAGE_MAX_BYTES);
  const nowMs = useTickingNow();
  const reviewView = review
    ? mapPaymentReview({
        kind: review.kind,
        recipientPubky: review.peerPubky,
        recipientContact: peerContact,
        requestAmountBtc: review.amountBtc,
        amountAsset: review.amountAsset,
        reference: review.reference,
        endpoint: review.selected,
        destinations: review.destinations,
        nowMs,
        destinationsEmpty: review.destinations.length === 0,
        walletUnavailable,
        recordFailed,
        handoffError: recordFailed ? null : reviewHandoffError,
      })
    : null;

  return (
    <SafeAreaView style={styles.container} testID="threadScreen">
      <View style={styles.header}>
        <TouchableOpacity
          testID="threadBack"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={HIT_SLOP_44}
          style={styles.backBtn}
        >
          <Icon name="chevron-back" tone="brand" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.titleWrap}
          onPress={onCopyPubky}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${identity.title}`}
        >
          <Text
            testID="threadTitle"
            accessibilityLabel={identity.title}
            style={styles.title}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {identity.title}
          </Text>
          {identity.subtitle ? (
            <Text style={styles.claimed} numberOfLines={1}>
              {identity.subtitle}
            </Text>
          ) : null}
          {linkLabel ? (
            <Text testID="threadLinkStatus" style={styles.linkStatus}>
              {linkLabel}
            </Text>
          ) : null}
        </TouchableOpacity>
        <View style={styles.backBtn} />
      </View>
      {peerBlocked ? <ThreadDeniedBanner onUnblock={onUnblock} /> : null}
      {peerDeclined ? <ThreadDeclinedNotice /> : null}
      {needsEnable ? (
        <EnableMessagingCta testID="threadEnableMessaging" onPress={onEnableMessaging} />
      ) : null}
      {sessionKind === 'offline' ? (
        <StatusBanner testID="threadOfflineBanner" label={COPY.sessionOfflineBanner} />
      ) : null}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={color.brand} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{COPY.noMessagesYet}</Text>
          <Text style={styles.emptyBody}>{COPY.threadEmptyBody}</Text>
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
        <View style={styles.composerColumn}>
          {composerNotice ? (
            <View testID="composerNotice" accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>{composerNotice.message}</Text>
              {composerNotice.actionLabel && composerNotice.onAction ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={composerNotice.actionLabel}
                  hitSlop={HIT_SLOP_44}
                  onPress={composerNotice.onAction}
                  style={styles.noticeAction}
                >
                  <Text style={styles.noticeActionText}>{composerNotice.actionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {tipPickerOpen ? (
            <ThreadTipBarContent
              endpoints={tipEndpoints}
              onTip={identifier => {
                const match = tipEndpoints.find(row => row.identifier === identifier) ?? null;
                if (!match) return;
                if (isPositiveBtcAmount(match.invoiceAmount ?? '')) {
                  onReview({
                    kind: 'tip',
                    record: null,
                    peerPubky: participantPubky,
                    amountBtc: match.invoiceAmount ?? '',
                    amountAsset: 'btc',
                    reference: null,
                    destinations: [match],
                    selected: match,
                  });
                  return;
                }
                onNeedTipAmount(match);
              }}
            />
          ) : null}
          <View style={styles.composer}>
            <PaymentComposeSheet
              visible={composePayment}
              busy={paymentBusy}
              intent={composeIntent}
              onClose={onClosePaymentCompose}
              onSubmit={onSubmitPayment}
            />
            <ComposerActionMenu
              visible={actionMenuOpen}
              actions={actions}
              onSelect={onComposerAction}
              onClose={onCloseActionMenu}
            />
            {reviewView ? (
              <PaymentReviewSheet
                visible
                review={reviewView}
                busy={false}
                onClose={onCloseReview}
                onContinue={() => {
                  if (reviewView.uri) onContinueReview(reviewView.uri);
                }}
                onCopyUri={() => {
                  if (reviewView.uri) copyText(reviewView.uri);
                }}
                onSelectDestination={identifier => {
                  if (!review) return;
                  const next =
                    review.destinations.find(row => row.identifier === identifier) ?? null;
                  onReview({ ...review, selected: next });
                }}
              />
            ) : null}
            <TouchableOpacity
              ref={plusRef}
              testID="threadComposerPlus"
              accessibilityRole="button"
              accessibilityLabel={COPY.composerAttach}
              hitSlop={HIT_SLOP_44}
              onPress={onOpenActionMenu}
              style={styles.plusBtn}
            >
              <Icon name="add" tone="secondary" />
            </TouchableOpacity>
            <TextInput
              testID="threadComposer"
              accessibilityLabel="Message"
              style={styles.input}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Message…"
              placeholderTextColor={color.textSecondary}
              multiline
              editable={composerEnabled}
              returnKeyType="default"
            />
            <TouchableOpacity
              testID="threadSend"
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{
                disabled: !draft.trim() || sending || !composerEnabled || overCap,
              }}
              style={[
                styles.sendBtn,
                (!draft.trim() || sending || !composerEnabled || overCap) && styles.sendBtnDisabled,
              ]}
              onPress={onSend}
              disabled={!draft.trim() || sending || !composerEnabled || overCap}
            >
              {sending ? (
                <ActivityIndicator color={color.textOnBrand} size="small" />
              ) : (
                <Icon
                  name="arrow-up"
                  tone={
                    !draft.trim() || sending || !composerEnabled || overCap ? 'muted' : 'onBrand'
                  }
                />
              )}
            </TouchableOpacity>
          </View>
          {showByteCap ? (
            <Text
              testID="threadByteCap"
              accessibilityLabel={byteLabel}
              numberOfLines={1}
              style={[
                styles.byteCap,
                byteSize >= LINK_MESSAGE_MAX_BYTES * 0.95 && styles.byteCapOver,
              ]}
            >
              {byteLabel}
            </Text>
          ) : null}
          {tipPickerOpen ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={COPY.cancel}
              hitSlop={HIT_SLOP_44}
              onPress={onCloseTipPicker}
              style={styles.noticeAction}
            >
              <Text style={styles.noticeActionText}>{COPY.cancel}</Text>
            </TouchableOpacity>
          ) : null}
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
  container: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  backBtn: { ...minHitStyle },
  backText: { fontSize: typeRole.heading.fontSize, color: color.brand },
  titleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: space.sm },
  title: {
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
    color: color.textPrimary,
    textAlign: 'center',
  },
  claimed: { fontSize: typeRole.meta.fontSize, color: color.brandMuted, textAlign: 'center' },
  linkStatus: {
    fontSize: typeRole.meta.fontSize,
    color: color.warningStrong,
    textAlign: 'center',
    marginTop: 2,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.sm,
  },
  emptyTitle: { color: color.textPrimary, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  emptyBody: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageList: { padding: space.lg, paddingBottom: space.xxxl + space.xl, gap: space.sm },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginVertical: 2,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: color.brand,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: color.bubbleIncoming,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: typeRole.callout.fontSize, lineHeight: 20 },
  mineText: { color: color.textOnBrand },
  theirsText: { color: color.textPrimary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  time: { fontSize: typeRole.meta.fontSize, color: color.textOnBrandUi },
  status: { fontSize: typeRole.meta.fontSize, color: color.textOnBrandMuted },
  statusFailed: { color: color.danger },
  retry: {
    fontSize: typeRole.meta.fontSize,
    color: color.textOnBrand,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.surfaceRaised,
    backgroundColor: color.canvas,
  },
  input: {
    flex: 1,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: color.textPrimary,
    fontSize: typeRole.callout.fontSize,
    maxHeight: 160,
  },
  sendBtn: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    width: 44,
    height: 44,
    borderRadius: radius.xxl,
    backgroundColor: color.brand,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { color: color.textOnBrand, fontSize: typeRole.numeric.fontSize, fontWeight: '700' },
  composerColumn: { backgroundColor: color.canvas, paddingBottom: space.lg },
  plusBtn: {
    ...minHitStyle,
    width: 44,
    height: 44,
    borderRadius: radius.xxl,
    backgroundColor: color.bubbleIncoming,
  },
  plusIcon: {
    color: color.brandMuted,
    fontSize: typeRole.heading.fontSize,
    fontWeight: '700',
    marginTop: -2,
  },
  byteCap: {
    color: color.textSecondary,
    fontSize: typeRole.meta.fontSize,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  byteCapOver: { color: color.danger },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  noticeText: { flex: 1, color: color.danger, fontSize: typeRole.caption.fontSize },
  noticeAction: {
    minHeight: measure.hitTarget,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  noticeActionText: {
    color: color.brandText,
    fontSize: typeRole.secondary.fontSize,
    fontWeight: '700',
  },
});
