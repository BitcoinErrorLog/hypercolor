/**
 * Contacts Block / Unblock copy. UI and the block service read these so the
 * contract, confirmation sheets, and retry surface cannot drift.
 */
export const CONTACTS_COPY = {
  blockTitle: 'Block this pubky?',
  blockBody:
    'They are removed from Contacts. The Encrypted Link is closed, so they cannot deliver messages to your inbox. One-to-one messages with them are deleted on this device. Follows import will skip them. Unblocking is a separate action; adding their pubky again does not lift the block.',
  blockConfirm: 'Block',

  unblockTitle: 'Unblock this pubky?',
  unblockAndAddTitle: 'This pubky is blocked. Unblock and add?',
  unblockBody:
    'They can send you a message request again. No chats, encrypted link, or contact data is restored.',
  unblockConfirm: 'Unblock',
  unblockAndAddConfirm: 'Unblock and add',

  blockedState: 'Blocked',
  blockedCleanupPending: 'Blocked · cleanup pending',
  blockedCleanupRetry: 'Retry',
  blockedAddMessage: 'This pubky is blocked.',

  removeTitle: 'Remove this contact?',
  removeBody:
    'This deletes the local contact row. Chats and message history stay. You can add them again by pubky. If they are blocked, adding them does not unblock them.',
  removeConfirm: 'Remove contact',
} as const;
