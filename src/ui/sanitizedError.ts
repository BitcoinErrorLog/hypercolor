import { COPY } from '../copy/uxCopy';

export type SanitizedErrorCategory =
  | 'network'
  | 'denied'
  | 'expired'
  | 'invalid-callback'
  | 'handoff'
  | 'verification'
  | 'offline'
  | 'unknown';

export type SanitizedError = {
  category: SanitizedErrorCategory;
  message: string;
  details: string | null;
};

const URL_PATTERN = /(?:https?:\/\/|pubky:\/\/|pubkyring:\/\/|pubkyauth:\/\/|hypercolor:\/\/)\S+/gi;
const Z32_PATTERN = /[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/gi;

function rawMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  if (typeof err === 'string' && err.trim().length > 0) return err;
  return '';
}

function stripSensitive(text: string): string {
  return text.replace(URL_PATTERN, '[url]').replace(Z32_PATTERN, '[pubky]');
}

export function classifyError(err: unknown): SanitizedErrorCategory {
  const rec = typeof err === 'object' && err !== null ? (err as { code?: unknown }) : null;
  if (rec?.code === 'network') return 'network';
  if (rec?.code === 'auth') return 'denied';
  const msg = rawMessage(err).toLowerCase();
  if (
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('failed to fetch') ||
    msg.includes('internet')
  ) {
    return msg.includes('offline') ? 'offline' : 'network';
  }
  if (
    msg.includes('denied') ||
    msg.includes('declined') ||
    msg.includes('rejected') ||
    msg.includes('authentication failed')
  ) {
    return 'denied';
  }
  if (msg.includes('expired') || msg.includes('timed out') || msg.includes('timeout')) {
    return 'expired';
  }
  if (msg.includes('missing required params') || msg.includes('invalid callback')) {
    return 'invalid-callback';
  }
  if (msg.includes('handoff') || msg.includes('sb2')) {
    return msg.includes('signature') || msg.includes('tamper') ? 'verification' : 'handoff';
  }
  if (msg.includes('tamper') || msg.includes('verification failed')) {
    return 'verification';
  }
  return 'unknown';
}

const CATEGORY_MESSAGE: Record<SanitizedErrorCategory, string> = {
  network: COPY.sessionOfflineBanner,
  offline: COPY.welcomeOffline,
  denied: COPY.authorizationDeclinedBody,
  expired: COPY.authorizationExpiredBody,
  'invalid-callback': COPY.couldNotCompleteAuthorization,
  handoff: COPY.couldNotCompleteAuthorization,
  verification: COPY.couldNotCompleteAuthorization,
  unknown: COPY.couldNotStartAuthorization,
};

export function sanitizeError(
  err: unknown,
  fallback: string = COPY.couldNotStartAuthorization,
): SanitizedError {
  const category = classifyError(err);
  const raw = rawMessage(err);
  const details = raw.length > 0 ? stripSensitive(raw) : null;
  const message = category === 'unknown' ? fallback : CATEGORY_MESSAGE[category];
  return { category, message, details };
}

export function isDeniedEnableError(err: unknown): boolean {
  return classifyError(err) === 'denied';
}
