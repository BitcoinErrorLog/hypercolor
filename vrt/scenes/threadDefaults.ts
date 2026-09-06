import { ThreadScreenContent } from '../../src/screens/main/ThreadScreen';
import { CONTACTS_POPULATED, OWNER, PEER, THREAD_POPULATED, noop } from '../fixtures/productData';

type ThreadProps = Parameters<typeof ThreadScreenContent>[0];

export const emptyRetry = new Set<string>();

export function threadProps(patch: Partial<ThreadProps> = {}): ThreadProps {
  return {
    participantPubky: PEER,
    localPubky: OWNER,
    draft: '',
    sending: false,
    loading: false,
    linkMessages: THREAD_POPULATED,
    attachments: [],
    payments: [],
    tipEndpoints: [],
    composePayment: false,
    composeIntent: 'request',
    paymentBusy: false,
    actionMenuOpen: false,
    tipPickerOpen: false,
    review: null,
    walletUnavailable: false,
    recordFailed: false,
    reviewHandoffError: null,
    retryableEventIds: emptyRetry,
    peerBlocked: false,
    peerDeclined: false,
    onUnblock: noop,
    composerNotice: null,
    onBack: noop,
    onChangeDraft: noop,
    onSend: noop,
    onOpenActionMenu: noop,
    onCloseActionMenu: noop,
    onComposerAction: noop,
    onClosePaymentCompose: noop,
    onSubmitPayment: noop,
    onPaymentsChanged: noop,
    onReview: noop,
    onCloseReview: noop,
    onCloseTipPicker: noop,
    onNeedTipAmount: noop,
    onContinueReview: noop,
    sessionKind: 'enabled',
    peerContact: CONTACTS_POPULATED[0] ?? null,
    linkStatus: 'ready',
    onEnableMessaging: noop,
    onRetryFailed: noop,
    onRetryConnection: noop,
    onCopyPubky: noop,
    ...patch,
  };
}
