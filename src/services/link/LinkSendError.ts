/**
 * Typed send failure. UI maps this through {@link sanitizeError}; never
 * alert the constructor message from a catch-all `err.message`.
 */
export class LinkSendError extends Error {
  readonly code: 'denied';

  constructor(code: 'denied', message: string) {
    super(message);
    this.name = 'LinkSendError';
    this.code = code;
  }
}
