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
  RefreshControl,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../../types';
import { CHAT_ATTACHMENT_KIND, type AttachmentRecord } from '../../types/attachment';
import type { LinkMessage } from '../../types/link';
import { buildDmConversationId } from '../../types/link';
import { useAuthStore } from '../../stores/authStore';
import { StorageService } from '../../services/StorageService';
import { LinkService, THREAD_INBOX_POLL_MS } from '../../services/link/LinkService';
import { AttachmentBubble } from '../../components/AttachmentBubble';
import {
  pickAndSendFile,
  pickAndSendPhoto,
  sendGifAttachment,
  type ComposerAttachNotice,
} from '../../components/ComposerAttachButton';
import { ComposerActionMenu } from '../../components/ComposerActionMenu';
import { EmojiAutocomplete, EmojiPickerSheet } from '../../components/EmojiPickerSheet';
import { TagPickerSheet } from '../../ui/TagPickerSheet';
import { TagChips, aggregateTags } from '../../ui/TagChips';
import type { ChatTagRow } from '../../services/StorageService';
import { GifPickerSheet } from '../../components/GifPickerSheet';
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
import { confirmReceiverTakeover } from '../../components/confirmReceiverTakeover';
import { useReceiverRoleStore } from '../../stores/receiverRoleStore';
import { HIT_SLOP_44, minHitStyle } from '../../ui/hitTarget';
import { formatDeliveryState, formatLinkStatus } from '../../ui/messageStatus';
import { peerIdentity } from '../../ui/peerIdentity';
import { copyText } from '../../utils/copyText';
import {
  applyEmojiAtShortcode,
  matchShortcodeTail,
  replaceClosedShortcodes,
} from '../../lib/emoji/matchShortcode';
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
  type ComposerActionId,
} from '../../ui/composerActions';
import { mapPaymentReview } from '../../ui/paymentReview';
import { openBuiltUri } from '../../services/payments/walletHandoff';
import { continuePaymentReview } from './continuePaymentReview';
import { eventIdsWithDeliveryQueue } from '../../ui/failedSendRetry';
import { useReduceMotion } from '../../ui/reduceMotion';
import { color, space, radius, typeRole, measure } from '../../theme';
import {
  Icon,
  MessageBubble,
  DaySeparator,
  formatDaySeparator,
  sameCalendarDay,
  MarkdownText,
} from '../../ui/primitives';
import {
  COMPOSER_KAV_BEHAVIOR,
  COMPOSER_KAV_OFFSET,
  composerDockPadding,
  keyboardLiftHeight,
  subscribeComposerKeyboard,
} from '../../ui/composerKeyboard';

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
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [tipPickerOpen, setTipPickerOpen] = useState(false);
  const [review, setReview] = useState<PaymentReviewRequest | null>(null);
  const [walletUnavailable, setWalletUnavailable] = useState(false);
  const [recordFailed, setRecordFailed] = useState(false);
  const [reviewHandoffError, setReviewHandoffError] = useState<string | null>(null);
  const [composerNotice, setComposerNotice] = useState<ComposerAttachNotice | null>(null);
  const [peerContact, setPeerContact] = useState<Contact | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [threadPrefs, setThreadPrefs] = useState({ muted: false, archived: false });
  const [chatTags, setChatTags] = useState<ChatTagRow[]>([]);
  const [receiptsEnabled, setReceiptsEnabled] = useState(true);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<{ eventId: string; authorPubky: string } | null>(null);
  const [linkStatus, setLinkStatus] = useState<LinkStatus | null>(null);
  const [retryableEventIds, setRetryableEventIds] = useState<Set<string>>(() => new Set());
  const [requestStatus, setRequestStatus] = useState<'pending' | 'accepted' | 'declined' | null>(
    null,
  );
  const { peerBlocked, runUnblock } = useThreadPeerGate(localPubky, participantPubky);
  const sessionKind = useSessionStatusStore(s => s.kind);

  const [refreshing, setRefreshing] = useState(false);

  const conversationId = buildDmConversationId(participantPubky);

  const reloadEncrypted = useCallback(async () => {
    if (!localPubky) return;
    const [msgs, atts, pays, tips, loadedTags, prefs] = await Promise.all([
      StorageService.getLinkMessagesForConversation(localPubky, conversationId, 200),
      StorageService.listAttachmentsForConversation(localPubky, conversationId),
      StorageService.listPaymentRequestsForPeer(localPubky, participantPubky),
      StorageService.listTipEndpoints(localPubky, participantPubky),
      StorageService.listChatTagsForScope(localPubky, conversationId),
      typeof StorageService.getChatDevicePrefs === 'function'
        ? StorageService.getChatDevicePrefs(localPubky)
        : Promise.resolve({ receiptsEnabled: true, typingEnabled: true }),
    ]);
    setLinkMessages(msgs);
    setAttachments(atts);
    setPayments(pays);
    setTipEndpoints(tips);
    setChatTags(loadedTags);
    setReceiptsEnabled(prefs?.receiptsEnabled !== false);
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
    setNickname(await StorageService.getContactNickname(localPubky, participantPubky));
    setThreadPrefs(await StorageService.getThreadLocalPrefs(localPubky, conversationId));
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
      let stopped = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      const syncOpenThread = async () => {
        if (stopped || AppState.currentState !== 'active') return;
        console.log('[ThreadScreen] open-thread-poll sync');
        if (LinkService.hasSession()) {
          try {
            await LinkService.syncInbox([participantPubky]);
          } catch {
            // Inbox drain is best-effort; local history still renders.
          }
        }
        if (!stopped && AppState.currentState === 'active') await reloadEncrypted();
      };
      const stopPoll = () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
          console.log('[ThreadScreen] open-thread-poll stop');
        }
      };
      const startPoll = () => {
        stopPoll();
        if (stopped) return;
        timer = setInterval(() => {
          void syncOpenThread();
        }, THREAD_INBOX_POLL_MS);
        console.log('[ThreadScreen] open-thread-poll start');
      };
      const onAppState = (next: AppStateStatus) => {
        if (stopped) return;
        if (next === 'active') {
          void syncOpenThread();
          startPoll();
        } else {
          stopPoll();
        }
      };
      if (AppState.currentState === 'active') {
        void syncOpenThread();
        startPoll();
      }
      const sub = AppState.addEventListener('change', onAppState);
      return () => {
        stopped = true;
        stopPoll();
        sub.remove();
      };
    }, [participantPubky, reloadEncrypted]),
  );

  useEffect(() => {
    if (!localPubky) return;
    return LinkService.subscribeInboxSynced(owner => {
      if (owner === localPubky) void reloadEncrypted();
    });
  }, [localPubky, reloadEncrypted]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (LinkService.hasSession()) {
        try {
          await LinkService.syncInbox([participantPubky]);
        } catch {
          // Pull-to-refresh still reloads local rows.
        }
      }
      await reloadEncrypted();
    } finally {
      setRefreshing(false);
    }
  }, [participantPubky, reloadEncrypted]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || peerBlocked || draftExceedsByteCap(text, { surface: 'dm' })) return;
    const role = useReceiverRoleStore.getState().role;
    if (role === 'standby' && linkStatus !== 'ready') return;
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
  }, [draft, sending, peerBlocked, participantPubky, reloadEncrypted, linkStatus]);

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
      gifPickerOpen={gifPickerOpen}
      emojiPickerOpen={emojiPickerOpen}
      tagPickerOpen={tagPickerOpen}
      tags={chatTags}
      receiptsEnabled={receiptsEnabled}
      onCloseTagPicker={() => {
        setTagPickerOpen(false);
        setTagTarget(null);
      }}
      onPickTag={label => {
        if (!tagTarget) return;
        void LinkService.sendTag({
          peerPubky: participantPubky,
          targetEventId: tagTarget.eventId,
          targetAuthorPubky: tagTarget.authorPubky,
          label,
          op: 'add',
        })
          .then(() => {
            setTagPickerOpen(false);
            setTagTarget(null);
            void reloadEncrypted();
          })
          .catch(() => undefined);
      }}
      onToggleTag={({ eventId, authorPubky, label, mine }) => {
        void LinkService.sendTag({
          peerPubky: participantPubky,
          targetEventId: eventId,
          targetAuthorPubky: authorPubky,
          label,
          op: mine ? 'remove' : 'add',
        })
          .then(() => void reloadEncrypted())
          .catch(() => undefined);
      }}
      onRequestTag={target => {
        setTagTarget(target);
        setTagPickerOpen(true);
      }}
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
      onChangeDraft={value => setDraft(replaceClosedShortcodes(value))}
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
        if (id === 'gif') {
          setGifPickerOpen(true);
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
      nickname={nickname}
      threadMuted={threadPrefs.muted}
      threadArchived={threadPrefs.archived}
      onToggleMute={() => {
        if (!localPubky) return;
        void StorageService.setThreadLocalPrefs(localPubky, conversationId, {
          muted: !threadPrefs.muted,
        }).then(() => setThreadPrefs(p => ({ ...p, muted: !p.muted })));
      }}
      onToggleArchive={() => {
        if (!localPubky) return;
        void StorageService.setThreadLocalPrefs(localPubky, conversationId, {
          archived: !threadPrefs.archived,
        }).then(() => setThreadPrefs(p => ({ ...p, archived: !p.archived })));
      }}
      onOpenEmojiPicker={() => setEmojiPickerOpen(true)}
      onCloseEmojiPicker={() => setEmojiPickerOpen(false)}
      onCloseGifPicker={() => setGifPickerOpen(false)}
      onSendGif={gifId => {
        setGifPickerOpen(false);
        void sendGifAttachment({ type: 'conversation', peerPubky: participantPubky }, gifId).then(
          result => {
            if (result.ok) void reloadEncrypted();
            else if ('notice' in result) setComposerNotice(result.notice);
          },
        );
      }}
      linkStatus={linkStatus}
      refreshing={refreshing}
      onRefresh={() => {
        void handleRefresh();
      }}
      onEnableMessaging={() => nav.navigate('EnableMessaging' as never)}
      onRetryFailed={eventId => {
        void (async () => {
          if (!retryableEventIds.has(eventId)) return;
          try {
            await LinkService.retryPeerSends(participantPubky);
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
      onUnsend={eventId => {
        void LinkService.unsendDm(participantPubky, eventId)
          .then(() => reloadEncrypted())
          .catch(err => {
            const sanitized = sanitizeError(
              err instanceof Error ? err : COPY.couldNotDeleteMessage,
              COPY.couldNotDeleteMessage,
            );
            Alert.alert(COPY.unsendMessage, sanitized.message);
            return reloadEncrypted();
          });
      }}
      onRetryConnection={() => {
        void (async () => {
          try {
            await LinkService.retryPeerSends(participantPubky);
          } catch {
            Alert.alert(COPY.retrySendsFailedTitle, COPY.retrySendsFailed);
          }
          await reloadEncrypted();
        })();
      }}
      onCopyPubky={() => copyText(participantPubky)}
      onTakeoverSuccess={() => {
        void handleSend();
      }}
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
  gifPickerOpen = false,
  emojiPickerOpen = false,
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
  nickname = null,
  threadMuted = false,
  threadArchived = false,
  onToggleMute,
  onToggleArchive,
  onOpenEmojiPicker,
  onCloseEmojiPicker,
  onCloseGifPicker,
  onSendGif,
  linkStatus,
  refreshing = false,
  onRefresh,
  onEnableMessaging,
  onRetryFailed,
  onUnsend,
  onRetryConnection,
  onCopyPubky,
  onTakeoverSuccess,
  tags = [],
  receiptsEnabled = true,
  tagPickerOpen = false,
  onCloseTagPicker,
  onPickTag,
  onToggleTag,
  onRequestTag,
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
  gifPickerOpen?: boolean;
  emojiPickerOpen?: boolean;
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
  onComposerAction: (id: ComposerActionId) => void;
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
  nickname?: string | null;
  threadMuted?: boolean;
  threadArchived?: boolean;
  onToggleMute?: () => void;
  onToggleArchive?: () => void;
  onOpenEmojiPicker?: () => void;
  onCloseEmojiPicker?: () => void;
  onCloseGifPicker?: () => void;
  onSendGif?: (gifId: string) => void;
  linkStatus: LinkStatus | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEnableMessaging: () => void;
  onRetryFailed: (eventId: string) => void;
  onUnsend?: (eventId: string) => void;
  onRetryConnection: () => void;
  onCopyPubky: () => void;
  onTakeoverSuccess?: () => void;
  tags?: ChatTagRow[];
  receiptsEnabled?: boolean;
  tagPickerOpen?: boolean;
  onCloseTagPicker?: () => void;
  onPickTag?: (label: string) => void;
  onToggleTag?: (target: {
    eventId: string;
    authorPubky: string;
    label: string;
    mine: boolean;
  }) => void;
  onRequestTag?: (target: { eventId: string; authorPubky: string }) => void;
}) {
  const flatListRef = useRef<FlatList<ThreadItem>>(null);
  const plusRef = useRef<View>(null);
  const menuWasOpen = useRef(false);
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [androidKeyboardLift, setAndroidKeyboardLift] = useState(0);
  const items = useMemo(
    () => mergeThreadItems(linkMessages, attachments, payments),
    [linkMessages, attachments, payments],
  );

  const scrollToLatest = useCallback(() => {
    if (items.length === 0) return;
    flatListRef.current?.scrollToEnd({ animated: !reduceMotion });
  }, [items.length, reduceMotion]);

  useEffect(() => {
    scrollToLatest();
  }, [scrollToLatest]);

  useEffect(() => {
    return subscribeComposerKeyboard({
      onShow: event => {
        setKeyboardVisible(true);
        setAndroidKeyboardLift(keyboardLiftHeight(event, Platform.OS));
        scrollToLatest();
      },
      onHide: () => {
        setKeyboardVisible(false);
        setAndroidKeyboardLift(0);
      },
    });
  }, [scrollToLatest]);

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

  const identity = peerIdentity(
    participantPubky,
    peerContact
      ? { ...peerContact, ...(nickname ? { nickname } : {}) }
      : nickname
        ? { addedManually: false, nickname }
        : null,
  );
  const linkLabel = formatLinkStatus(linkStatus);
  const receiverRole = useReceiverRoleStore(s => s.role);
  const standbyBlocksNewChat = receiverRole === 'standby' && linkStatus !== 'ready';
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const showQueuedSubtitle =
    linkStatus === 'handshaking-initiator' || linkStatus === 'handshaking-responder';

  const renderItem = useCallback(
    ({ item, index }: { item: ThreadItem; index: number }) => {
      const previous = items[index - 1];
      const next = items[index + 1];
      const grouped = previous
        ? sameThreadRun(previous, item, localPubky, participantPubky)
        : false;
      const lastInGroup = next ? !sameThreadRun(item, next, localPubky, participantPubky) : true;
      const daySeparator =
        !previous || !sameCalendarDay(previous.sentAt, item.sentAt) ? (
          <DaySeparator label={formatDaySeparator(item.sentAt)} testID="threadDaySeparator" />
        ) : null;
      if (item.kind === 'payment') {
        const isMine = item.record.direction === 'sent';
        return (
          <>
            {daySeparator}
            <MessageBubble
              testID="threadPaymentBubble"
              mine={isMine}
              time={formatTime(item.sentAt)}
              grouped={grouped}
              lastInGroup={lastInGroup}
            >
              {localPubky ? (
                <PaymentRequestBubble
                  record={item.record}
                  localPubky={localPubky}
                  onChanged={onPaymentsChanged}
                  onReview={onReview}
                />
              ) : null}
            </MessageBubble>
          </>
        );
      }
      if (item.kind === 'attachment') {
        const isMine = item.record.senderPubky === localPubky;
        return (
          <>
            {daySeparator}
            <MessageBubble
              testID={isMine ? 'threadAttachmentBubbleMine' : 'threadAttachmentBubbleTheirs'}
              mine={isMine}
              time={formatTime(item.sentAt)}
              grouped={grouped}
              lastInGroup={lastInGroup}
              showIncomingAvatar={!isMine && !grouped}
              senderName={identity.title}
              senderPubky={participantPubky}
              {...(isMine && !item.message?.deleted && onUnsend
                ? { onDelete: () => onUnsend(item.record.eventId) }
                : {})}
            >
              <AttachmentBubble
                record={item.record}
                isMine={isMine}
                onRetrySend={
                  !item.message?.deleted && retryableEventIds.has(item.record.eventId)
                    ? () => onRetryFailed(item.record.eventId)
                    : undefined
                }
              />
            </MessageBubble>
          </>
        );
      }
      const isMine = item.message.senderPubky === localPubky;
      return (
        <>
          {daySeparator}
          <MessageBubble
            testID={isMine ? 'threadBubbleMine' : 'threadBubbleTheirs'}
            mine={isMine}
            time={formatTime(item.message.sentAt)}
            status={
              isMine && !item.message.deleted
                ? formatDeliveryState(item.message.deliveryState, receiptsEnabled)
                : null
            }
            statusTextVisible={
              isMine &&
              !item.message.deleted &&
              receiptsEnabled &&
              (item.message.deliveryState === 'delivered' || item.message.deliveryState === 'read')
            }
            failed={!item.message.deleted && item.message.deliveryState === 'failed'}
            grouped={grouped}
            lastInGroup={lastInGroup}
            showIncomingAvatar={!isMine && !grouped}
            senderName={identity.title}
            senderPubky={participantPubky}
            accessibilityLabel={
              item.message.deleted
                ? isMine
                  ? 'Message unsent'
                  : 'Message deleted'
                : item.message.body
            }
            copyBody={item.message.deleted ? null : item.message.body}
            onTag={() =>
              onRequestTag?.({
                eventId: item.message.eventId,
                authorPubky: item.message.senderPubky,
              })
            }
            {...(isMine && !item.message.deleted && onUnsend
              ? { onDelete: () => onUnsend(item.message.eventId) }
              : {})}
            footer={
              <TagChips
                tags={aggregateTags(
                  tags,
                  item.message.senderPubky,
                  item.message.eventId,
                  localPubky,
                )}
                onToggle={(label, mine) =>
                  onToggleTag?.({
                    eventId: item.message.eventId,
                    authorPubky: item.message.senderPubky,
                    label,
                    mine,
                  })
                }
              />
            }
          >
            <MarkdownText
              source={
                item.message.deleted
                  ? isMine
                    ? 'Message unsent'
                    : 'Message deleted'
                  : item.message.body
              }
              color={isMine ? color.textOnBrand : color.textPrimary}
            />
            {isMine &&
            !item.message.deleted &&
            item.message.deliveryState === 'failed' &&
            !peerBlocked ? (
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
        </>
      );
    },
    [
      identity.title,
      items,
      localPubky,
      onPaymentsChanged,
      onRetryFailed,
      onUnsend,
      onReview,
      participantPubky,
      peerBlocked,
      retryableEventIds,
      tags,
      onRequestTag,
      onToggleTag,
      receiptsEnabled,
    ],
  );

  const needsEnable =
    sessionKind === 'needs-enable' || sessionKind === 'revoked' || sessionKind === 'unavailable';
  const messagingOpen = !needsEnable && !peerBlocked;
  const composerEnabled = messagingOpen && !standbyBlocksNewChat;
  const inboxClosed = linkStatus === 'not-enrolled';
  const actions = composerActionItems('dm', {
    messagingEnabled: messagingOpen,
    inboxClosed,
    standbyNewChat: standbyBlocksNewChat,
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
          hitSlop={HIT_SLOP_44}
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
          {linkLabel && linkStatus !== 'error' && linkStatus !== 'reconnect_required' ? (
            <Text testID="threadLinkStatus" style={styles.linkStatus}>
              {linkLabel}
            </Text>
          ) : null}
          {showQueuedSubtitle ? (
            <Text testID="threadQueuedWaiting" style={styles.linkStatus}>
              {standbyBlocksNewChat ? COPY.queuedStandbySubtitle : COPY.queuedWaitingSubtitle}
            </Text>
          ) : null}
        </TouchableOpacity>
        {linkStatus === 'reconnect_required' ? (
          <Text testID="threadLinkStatus" style={styles.linkStatus}>
            {COPY.reconnectUnavailable}
          </Text>
        ) : null}
        {linkStatus === 'error' ? (
          <TouchableOpacity
            testID="threadLinkRetry"
            accessibilityRole="button"
            accessibilityLabel={COPY.connectionChangedRetry}
            hitSlop={HIT_SLOP_44}
            onPress={onRetryConnection}
            style={styles.titleWrap}
          >
            <Text testID="threadLinkStatus" style={styles.linkStatus}>
              {COPY.connectionChangedRetry}
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          testID="threadMute"
          accessibilityRole="button"
          accessibilityLabel={threadMuted ? COPY.unmuteChat : COPY.muteChat}
          hitSlop={HIT_SLOP_44}
          onPress={onToggleMute}
          style={styles.backBtn}
        >
          <Icon
            name={threadMuted ? 'notifications-off-outline' : 'notifications-outline'}
            tone="secondary"
          />
        </TouchableOpacity>
        <TouchableOpacity
          testID="threadArchive"
          accessibilityRole="button"
          accessibilityLabel={threadArchived ? COPY.unarchiveChat : COPY.archiveChat}
          hitSlop={HIT_SLOP_44}
          onPress={onToggleArchive}
          style={styles.backBtn}
        >
          <Icon name={threadArchived ? 'archive' : 'archive-outline'} tone="secondary" />
        </TouchableOpacity>
      </View>
      {peerBlocked ? <ThreadDeniedBanner onUnblock={onUnblock} /> : null}
      {peerDeclined ? <ThreadDeclinedNotice /> : null}
      {needsEnable ? (
        <EnableMessagingCta testID="threadEnableMessaging" onPress={onEnableMessaging} />
      ) : null}
      {sessionKind === 'offline' ? (
        <StatusBanner testID="threadOfflineBanner" label={COPY.sessionOfflineBanner} />
      ) : null}

      <KeyboardAvoidingView
        testID="threadKeyboardAvoid"
        style={[
          styles.keyboardAvoid,
          androidKeyboardLift ? { paddingBottom: androidKeyboardLift } : null,
        ]}
        behavior={COMPOSER_KAV_BEHAVIOR}
        keyboardVerticalOffset={COMPOSER_KAV_OFFSET}
      >
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
            style={styles.list}
            contentContainerStyle={[styles.messageList, { paddingBottom: space.xl }]}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={color.brand}
                  testID="threadRefresh"
                />
              ) : undefined
            }
          />
        )}

        <View
          style={[
            styles.composerColumn,
            { paddingBottom: composerDockPadding(bottomInset, keyboardVisible) },
          ]}
        >
          {standbyBlocksNewChat || composerNotice ? (
            <View testID="composerNotice" accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>
                {standbyBlocksNewChat ? COPY.standbyComposerNotice : composerNotice?.message}
              </Text>
              {standbyBlocksNewChat ? (
                <TouchableOpacity
                  testID="threadStandbyTakeover"
                  accessibilityRole="button"
                  accessibilityLabel={COPY.standbyPrimary}
                  hitSlop={HIT_SLOP_44}
                  disabled={takeoverBusy}
                  onPress={() =>
                    confirmReceiverTakeover({
                      mode: 'takeover',
                      onBusy: setTakeoverBusy,
                      onSuccess: onTakeoverSuccess,
                    })
                  }
                  style={styles.noticeAction}
                >
                  <Text style={styles.noticeActionText}>{COPY.standbyPrimary}</Text>
                </TouchableOpacity>
              ) : composerNotice?.actionLabel && composerNotice.onAction ? (
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
          {matchShortcodeTail(draft) ? (
            <EmojiAutocomplete
              suggestions={matchShortcodeTail(draft)!.suggestions}
              onPick={glyph => onChangeDraft(applyEmojiAtShortcode(draft, glyph))}
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
                onCopyRecipientPubky={() => copyText(reviewView.recipientPubky)}
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
            <TouchableOpacity
              testID="threadComposerEmoji"
              accessibilityRole="button"
              accessibilityLabel={COPY.emojiPickerTitle}
              hitSlop={HIT_SLOP_44}
              onPress={onOpenEmojiPicker}
              style={styles.plusBtn}
            >
              <Icon name="happy-outline" tone="secondary" />
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
              accessibilityHint={standbyBlocksNewChat ? COPY.standbyComposerNotice : undefined}
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
          <TagPickerSheet
            visible={tagPickerOpen}
            onClose={() => onCloseTagPicker?.()}
            onPick={label => onPickTag?.(label)}
          />
          <EmojiPickerSheet
            visible={emojiPickerOpen}
            onClose={() => onCloseEmojiPicker?.()}
            onPick={glyph => {
              onChangeDraft(`${draft}${glyph}`);
              onCloseEmojiPicker?.();
            }}
          />
          <GifPickerSheet
            visible={gifPickerOpen}
            onClose={() => onCloseGifPicker?.()}
            onPick={hit => onSendGif?.(hit.id)}
          />
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

function sameThreadRun(
  current: ThreadItem,
  next: ThreadItem,
  localPubky: string | null,
  participantPubky: string,
): boolean {
  return (
    sameCalendarDay(current.sentAt, next.sentAt) &&
    threadItemSenderPubky(current, localPubky, participantPubky) ===
      threadItemSenderPubky(next, localPubky, participantPubky)
  );
}

function threadItemSenderPubky(
  item: ThreadItem,
  localPubky: string | null,
  participantPubky: string,
): string {
  if (item.kind === 'link') return item.message.senderPubky;
  if (item.kind === 'attachment') return item.record.senderPubky;
  return item.record.direction === 'sent'
    ? (localPubky ?? '')
    : (item.record.peerPubky ?? participantPubky);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.canvas },
  keyboardAvoid: { flex: 1 },
  list: { flex: 1 },
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
  titleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    minHeight: measure.hitTarget,
  },
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
  messageList: { padding: space.lg, gap: space.sm },
  daySeparator: { alignItems: 'center', paddingVertical: space.md },
  daySeparatorText: {
    color: color.textMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
  bubbleText: { fontSize: typeRole.callout.fontSize, lineHeight: 20 },
  mineText: { color: color.textOnBrand },
  theirsText: { color: color.textPrimary },
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
  composerColumn: { backgroundColor: color.canvas },
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
