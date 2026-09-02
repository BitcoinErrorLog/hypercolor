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
  copyPaykitConnectUrl: 'Copy paykit-connect URL',
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
  messagingUnavailable: 'Encrypted messaging is unavailable in this build.',
  notConnected: 'Not connected',

  preparingPaykitConnect: 'Preparing paykit-connect…',
  couldNotStartAuthorization: 'Could not start authorization.',
  couldNotCompleteAuthorization: 'Could not complete authorization.',
  connectExplanation: 'Adopt your identity on this device. Pubky Ring approves the connection.',

  messageRequests: 'Message requests',
  newChat: 'New chat',
  noChatsYet: 'No chats yet.',
  chatsEmptyBody:
    'Add someone by pubky, then start a chat. Nobody can message you first until you have talked before or you invite them.',
  addAContact: 'Add a contact',
  copyMyPubky: 'Copy my pubky',
  share: 'Share',
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
} as const;

export function lastBackupLine(relativeTime: string): string {
  return `Your last backup was ${relativeTime}.`;
}

export function claimsToBe(name: string): string {
  return `claims to be ${name}`;
}
