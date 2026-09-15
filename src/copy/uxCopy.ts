/** Canonical UX copy. Screens must use these strings rather than ad-hoc variants. */

export const CUSTODY_LINE = 'Pubky Ring holds your key. Hypercolor never sees it.';

export const BACKUP_CUSTODY_LINE =
  'This code unlocks your local backup. It is not your identity key — Pubky Ring still holds that.';

export const CONNECT_WITH_PUBKY_RING = 'Connect with Pubky Ring';
export const ENABLE_ENCRYPTED_MESSAGING = 'Enable encrypted messaging';
export const APPROVE_SCOPES_BODY = 'Approve the Paykit and Hypercolor write scopes in Pubky Ring.';
export const RING_GRANT_SCOPE_DETAIL = '/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw';

export const ENABLE_AUTH_TTL_MS = 5 * 60 * 1000;

export const COPY = {
  custodyLine: CUSTODY_LINE,
  backupCustodyLine: BACKUP_CUSTODY_LINE,
  connectWithPubkyRing: CONNECT_WITH_PUBKY_RING,
  enableEncryptedMessaging: ENABLE_ENCRYPTED_MESSAGING,
  approveScopesBody: APPROVE_SCOPES_BODY,
  ringGrantScopeDetail: RING_GRANT_SCOPE_DETAIL,
  openPubkyRing: 'Open Pubky Ring',
  copyAuthorizationUrl: 'Copy authorization URL',
  copied: 'Copied',
  generateNewAuthorization: 'Generate new authorization',
  generateNewLink: 'Generate new link',
  openChats: 'Open chats',
  done: 'Done',
  notNow: 'Not now',
  tryAgain: 'Try again',
  cancel: 'Cancel',
  back: 'Back',
  signOut: 'Sign out',
  authorizeAgain: 'Authorize again',

  checkingMessaging: 'Checking messaging status…',
  messagingNotEnabled: 'Messaging not enabled',
  waitingForRing: 'Waiting for Pubky Ring…',
  waitingForRingBody: 'Approve the request in Pubky Ring, or scan the code on another device.',
  authorizationExpired: 'Authorization expired',
  authorizationExpiredBody: 'The paykit-connect link is only valid for five minutes.',
  enableExpiredBody: 'This authorization expired. Generate a new one.',
  welcomeExpiredBody: 'This paykit-connect link expired. Generate a new one.',
  authorizationDeclined: 'Authorization declined',
  authorizationDeclinedBody: 'Pubky Ring did not grant the scopes Hypercolor asked for.',
  sessionOffline: 'Session offline',
  sessionOfflineBanner: 'You are offline. Messages will send when you reconnect.',
  welcomeOffline: 'You are offline. Connect again when you reconnect.',
  accessRevoked: 'Access was revoked',
  accessRevokedBody:
    'Pubky Ring no longer grants Hypercolor write access. Your local history is untouched.',
  encryptedMessagingEnabled: 'Encrypted messaging enabled',
  encryptedMessagingEnabledBody:
    'Ring approved the grant and this device published a receiver marker.',
  standbyBannerTitle: 'Another device is receiving new messages',
  standbyBannerBody:
    'This identity is signed in somewhere else, and that device is the one that can accept new chats. Conversations already on this device still work. Take over if you want new message requests and new handshakes to land here instead.',
  standbyPrimary: 'Receive on this device',
  standbySecondary: 'Keep using this device for existing chats',
  takeoverToast:
    'This device now receives new messages. Other signed-in devices will stop accepting new chats until they take over.',
  reenableToast: 'This device now receives new messages again.',
  reenableBannerTitle: 'This device stopped receiving new chats',
  reenableBannerBody:
    'The published receiver marker is gone. Conversations already on this device still work. Re-enable receiving if you want new message requests and new handshakes to land here.',
  reenablePrimary: 'Re-enable receiving',
  reenableSecondary: 'Not now',
  queuedWaitingSubtitle: 'Waiting for the other person — retrying if they switched devices.',
  queuedStandbySubtitle: 'Not receiving on this device — tap Receive on this device to continue.',
  connectionChangedRetry: 'Connection changed — tap to retry',
  reconnectRequired: 'Reconnect required',
  reconnectUnavailable: 'Connection lost — re-linking will be available in the next update.',
  reconnectFailed: 'Reconnect failed.',
  restoring: 'Restoring…',
  standbyComposerNotice:
    "This device isn't receiving new chats. Receive on this device to start this conversation.",
  messagingUnavailable: 'Encrypted messaging is unavailable in this build.',
  keystoreUnavailable: 'Encrypted storage is not ready on this device.',
  keystoreUnavailableBody: 'Messaging is paused. Local history is untouched.',
  notConnected: 'Not connected',

  preparingPaykitConnect: 'Preparing paykit-connect…',
  couldNotStartAuthorization: 'Could not start authorization.',
  couldNotCompleteAuthorization: 'Could not complete authorization.',
  connectExplanation: 'Approve once in Pubky Ring',
  retryPublish: 'Retry publish',
  couldNotPublishReceiver: 'Could not publish the receiver. Retry publish.',
  updatePubkyRing: 'Update Pubky Ring and scan again.',
  connectScanAgain: 'Hypercolor was restarted during setup. Scan the paykit-connect code again.',

  messageRequests: 'Message requests',
  inbox: 'Inbox',
  newChat: 'New chat',
  noChatsYet: 'No chats yet.',
  chatsEmptyBody:
    'Add someone by pubky, then start a chat. Nobody can message you first until you have talked before or you invite them.',
  addAContact: 'Add a contact',
  copyMyPubky: 'Copy my pubky',
  share: 'Share',
  showQr: 'Show QR',
  scanQr: 'Scan QR',
  yourPubkyQrTitle: 'Your pubky',
  thatsYourOwnPubky: "That's your own pubky.",
  notAPubkyQr: 'That code is not a pubky.',
  cameraPermissionDenied: 'Camera access is required to scan a pubky QR.',
  enterPubkyManually: 'Enter pubky manually',
  couldNotLoadChats: 'Could not load your chats.',

  requestsExplainer:
    'New inbound chats wait here until you accept. Nothing is auto-accepted — following someone does not open your inbox to them. Accepting opens the chat and any held group invitations. Declining drops the held items and remembers the decline.',
  noPendingRequests: 'No pending requests.',
  requestsEmptyBody: 'New inbound chats wait here until you accept.',
  inviteBlockBody:
    'Someone who has never messaged you cannot reach this queue yet — Hypercolor has no public drop point. Share your pubky and they can start the chat.',
  inboundRequestHint: 'Inbound message request',
  accept: 'Accept',
  decline: 'Decline',

  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  notDelivered: 'Not delivered',
  inboxClosed: 'Inbox closed',
  offline: 'Offline',
  needsEnable: 'Needs enable',
  retry: 'Retry',

  noMessagesYet: 'No messages yet.',
  threadEmptyBody: 'Say something. Only the two of you can read this.',

  signOutTitle: 'Sign out of Hypercolor?',
  signOutBodyLocal:
    'This device deletes your chats, groups, contacts, attachments, and the Paykit session.',
  signOutBodyRing:
    'Pubky Ring keeps your key and your identity — you can connect again and re-authorize.',
  signOutNoBackup: 'If you have not made an encrypted backup, this history is not recoverable.',
  settingsRow: 'Settings',
  messageRequestsNav: 'Message requests',

  backupExplanation:
    'A backup encrypts your local history with a recovery code. Only you have that code — Hypercolor cannot restore your history without it.',
  writeRecoveryCodeDown: 'Write this recovery code down',
  writtenRecoveryCode: 'I have written this code down',
  copyRecoveryCode: 'Copy recovery code',
  leaveRecoveryTitle: 'Leave without saving your recovery code?',
  leaveRecoveryBody: 'Your backup cannot be restored without it.',
  goBack: 'Go back',
  leaveAnyway: 'Leave anyway',
  couldNotCreateBackup: 'Could not create a backup.',
  recoveryCodeDidNotWork: 'That recovery code did not work.',
  couldNotSignOut: 'Could not sign out.',
  signOutIncompleteTryAgain: 'Sign-out incomplete, try again',
  resetAppData: 'Reset app data',
  resetAppDataTitle: 'Reset all local app data?',
  resetAppDataBody:
    'Data for the previous account could not be removed normally. This will delete all local app data.',
  resetAppDataFailed: 'Could not reset app data. Try again.',
  couldNotSendMessage: 'Could not send that message.',
  couldNotReact: 'Could not add that reaction.',
  couldNotDeleteMessage: 'Could not delete that message.',
  couldNotAddMember: 'Could not add that member.',
  couldNotRemoveMember: 'Could not remove that member.',
  couldNotLeaveChannel: 'Could not leave this channel.',
  couldNotRefreshChannel: 'Could not refresh this channel.',
  couldNotCreateGroup: 'Could not create group',
  couldNotCreateChannel: 'Could not create channel',
  couldNotJoinChannel: 'Could not join',
  stillLoading: 'Still loading…',
  publicGraphWarningTitle: 'Public',
  publicGraphWarningBody:
    'anything you post here is world-readable and permanent. Loading this list asks the public index for topics; the index operator sees that query. Your chats and private groups are never sent here.',
  publicSubstrateMobile: 'Public topics here are Hypercolor rooms on your homeserver.',
  channelsTitle: 'Channels',
  channelsPrivate: 'Private',
  channelsPublic: 'Public',
  privateGroup: 'Private group',
  publicTopic: 'Public topic',
  noPrivateGroupsYet: 'No private groups yet.',
  privateGroupsEmptyBody:
    'A private group is end-to-end encrypted to every member, up to 50 people.',
  newPrivateGroup: 'New private group',
  noPublicTopicsYet: 'No public topics yet.',
  publicTopicsEmptyBody: 'Join a public topic by link, or create one on your homeserver.',
  newPublicTopic: 'New public topic',
  joinByLink: 'Join by link',
  loadPublicTopics: 'Load public topics',
  newChannelSheetTitle: 'New',
  joinPublicTopicTitle: 'Join a public topic',
  createGroup: 'Create group',
  channelDestinationPrivate: 'Posts here are end-to-end encrypted to every member.',
  channelDestinationPublic:
    'Posts here publish to /pub/hypercolor.app/v1/public-channels and are world-readable.',
  composerAttach: 'Attach',
  composerPhoto: 'Photo',
  composerFile: 'File',
  composerRequestPayment: 'Request payment',
  composerSendTip: 'Send a tip',
  composerSendTipList: 'Send my tip list',
  composerGif: 'GIF',
  emojiPickerTitle: 'Emoji',
  emojiSearch: 'Search emoji',
  gifPickerTitle: 'GIF',
  gifSearch: 'Search GIFs',
  gifNotConfigured: 'GIF search not configured',
  gifNotConfiguredBody: 'The Hypercolor GIF proxy is not set up on this build.',
  gifTooLarge: 'That GIF is larger than 8 MiB.',
  displayNameLabel: 'Display name',
  displayNamePlaceholder: 'Your name',
  saveDisplayName: 'Save name',
  nicknameLabel: 'Nickname',
  nicknamePlaceholder: 'Local nickname',
  saveNickname: 'Save nickname',
  muteChat: 'Mute',
  unmuteChat: 'Unmute',
  archiveChat: 'Archive',
  unarchiveChat: 'Unarchive',
  chatsFilterInbox: 'Inbox',
  chatsFilterArchived: 'Archived',
  chatsFilterMuted: 'Muted',
  messageSearchTitle: 'Search messages',
  noSearchHits: 'No matching messages.',
  copyMessage: 'Copy message',
  unsendMessage: 'Unsend',
  tagMessage: 'Tag',
  tagWithEmoji: 'Emoji',
  tagWithWord: 'Word tag',
  addTag: 'Add tag',
  untag: 'Remove tag',
  delivered: 'Delivered',
  read: 'Read',
  readReceipts: 'Read receipts',
  readReceiptsHint:
    'Send delivered and read receipts on this device. Inbound receipts still apply.',
  openExternalLinkTitle: 'Open this link?',
  open: 'Open',
  enableMessagingReason: 'Enable messaging',
  paymentsDmOnly: 'Payments are for one-to-one chats.',
  attachmentsPublicUnsupported: 'Public topics cannot carry encrypted attachments.',
  noTipDestinations: 'No tip destinations from this peer yet.',
  photoPermissionNotice: 'Photo library access is required to send images.',
  openSettings: 'Open settings',
  updatingRequest: 'Updating request',
  reviewBeforePaying: 'Review before paying',
  openWallet: 'Open wallet',
  copyPaymentUri: 'Copy payment URI',
  couldNotOpenWallet: 'Could not open a wallet for this payment.',
  couldNotCompletePaymentAction: 'Could not complete that payment action.',
  couldNotSendStartAgain: "Couldn't send — start again",
  pendingPublicInvite: 'Pending invite to public topic',
  dismissPendingInvite: 'Dismiss',
  joinPendingInvite: 'Join',
  loadPublicTopicsToJoin: 'Load public topics before joining this invite.',
  choosePaymentDestination: 'Choose a destination',
  tipAmountTitle: 'Send a tip',
  continueToReview: 'Continue',
  noMatchingDestination: 'This peer has no destination that matches this request.',
  unsupportedPaymentAmount: 'This payment request is not a supported bitcoin amount.',
  onlyLightningCanPayAmount: 'Only Lightning can pay this amount.',
  invoiceExpired: 'This invoice expired.',
  invoiceInvalid: 'This invoice could not be read.',
  noWalletForLink: 'No app on this device can open that payment link.',
  paymentRequested: 'requested',
  paymentPaid: 'paid',
  paymentExpired: 'expired',
  paymentFailed: 'failed',
  proofNotVerified: 'Payment proof could not be verified yet',
  proofAlreadyUsed: 'This proof was already used',
  proofAmountMismatch: "This proof does not match this request's amount",
  invoiceAlreadyAttachedRotate:
    'This invoice is already attached to another request — rotate your invoice',
  paymentSending: 'Sending…',
  invoiceNotRecorded:
    'Your wallet opened, but this invoice was not recorded on this device. Tap Open wallet again to record it. Proof verification here may not work until then — the receipt stays requested until a matching proof can be verified.',
  networkBitcoinMainnet: 'Bitcoin mainnet',
  networkLightningMainnet: 'Lightning on Bitcoin mainnet',
  networkLightningRegtest: 'Lightning on Bitcoin regtest',
  networkLightningTestnet: 'Lightning on Bitcoin testnet',
  couldNotDownloadAttachment: 'Could not download/decrypt this attachment',
  encryptedBackup: 'Encrypted backup',
  myTipEndpoints: 'My tip endpoints',
} as const;

export function pendingInviteChannelHost(channelId: string, hostLabel: string): string {
  return `Channel ${channelId} hosted by ${hostLabel}`;
}

export function publicGraphWarning(): string {
  return `${COPY.publicGraphWarningTitle} — ${COPY.publicGraphWarningBody}`;
}

export function invoiceAmountMismatchWarning(invoiceBtc: string, requestedBtc: string): string {
  return `The invoice is for ${invoiceBtc} BTC, not the ${requestedBtc} BTC that was requested.`;
}

export function paymentNetworkLabel(
  scheme: 'lightning' | 'bitcoin' | null,
  network: 'bitcoin' | 'testnet' | 'regtest' | 'unknown' | null,
): string | null {
  if (scheme === 'bitcoin') return COPY.networkBitcoinMainnet;
  if (scheme !== 'lightning') return null;
  if (network === 'bitcoin') return COPY.networkLightningMainnet;
  if (network === 'regtest') return COPY.networkLightningRegtest;
  if (network === 'testnet') return COPY.networkLightningTestnet;
  return null;
}

/** Whole sats with grouping that matches the period-only BTC input grammar. */
export function amountSatsApprox(sats: number, locale = 'en-US'): string {
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(sats);
  return `${grouped} sats`;
}

export function messageByteCountLabel(used: number, cap: number): string {
  return `${used} / ${cap} bytes`;
}

export function lastBackupLine(relativeTime: string): string {
  return `Your last backup was ${relativeTime}.`;
}

export function claimsToBe(name: string): string {
  return `claims to be ${name}`;
}

export function sentToNofM(sent: number, total: number): string {
  return `Sent to ${sent} of ${total}`;
}

export function sendingNofM(sent: number, total: number): string {
  return `Sending · ${sent} of ${total} sent`;
}

export function notDeliveredBlocked(name: string): string {
  return `Not delivered to ${name} (blocked)`;
}
