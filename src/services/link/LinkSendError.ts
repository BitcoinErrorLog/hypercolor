export type LinkSendErrorCode = 'denied' | 'deny-unavailable' | 'not-sendable' | 'owner-changed';

/**
 * Typed send failure. UI maps this through {@link sanitizeError}; never
 * alert the constructor message from a catch-all `err.message`. Messages
 * must not contain a pubky.
 */
export class LinkSendError extends Error {
  readonly code: LinkSendErrorCode;

  constructor(code: LinkSendErrorCode, message: string) {
    super(message);
    this.name = 'LinkSendError';
    this.code = code;
  }
}
