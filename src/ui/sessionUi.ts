import type { LinkEnableStatus } from '../services/link/LinkService';
import { COPY } from '../copy/uxCopy';

export type SessionUiKind =
  | 'no-identity'
  | 'needs-enable'
  | 'waiting-for-ring'
  | 'expired'
  | 'denied'
  | 'offline'
  | 'revoked'
  | 'enabled'
  | 'unavailable'
  | 'keystore-unavailable';

export type SessionUiModel = {
  kind: SessionUiKind;
  label: string;
  body: string | null;
  primary: string | null;
  secondary: string | null;
};

export function sessionUiFromEnableStatus(
  isAuthenticated: boolean,
  status: LinkEnableStatus | null,
  hadPublishedReceiver: boolean,
): SessionUiKind {
  if (!isAuthenticated) return 'no-identity';
  if (status === 'native-missing') return 'unavailable';
  if (status === 'enabled') return 'enabled';
  if (status === 'session-offline') return 'offline';
  if (status === 'needs-enable' && hadPublishedReceiver) return 'revoked';
  if (status === 'needs-enable') return 'needs-enable';
  return 'needs-enable';
}

export function sessionUiModel(kind: SessionUiKind): SessionUiModel {
  switch (kind) {
    case 'no-identity':
      return {
        kind,
        label: COPY.notConnected,
        body: COPY.custodyLine,
        primary: COPY.connectWithPubkyRing,
        secondary: null,
      };
    case 'needs-enable':
      return {
        kind,
        label: COPY.messagingNotEnabled,
        body: COPY.approveScopesBody,
        primary: COPY.enableEncryptedMessaging,
        secondary: COPY.notNow,
      };
    case 'waiting-for-ring':
      return {
        kind,
        label: COPY.waitingForRing,
        body: COPY.waitingForRingBody,
        primary: COPY.openPubkyRing,
        secondary: COPY.copyAuthorizationUrl,
      };
    case 'expired':
      return {
        kind,
        label: COPY.authorizationExpired,
        body: COPY.authorizationExpiredBody,
        primary: COPY.generateNewAuthorization,
        secondary: COPY.cancel,
      };
    case 'denied':
      return {
        kind,
        label: COPY.authorizationDeclined,
        body: COPY.authorizationDeclinedBody,
        primary: COPY.tryAgain,
        secondary: COPY.cancel,
      };
    case 'offline':
      return {
        kind,
        label: COPY.sessionOfflineBanner,
        body: null,
        primary: COPY.tryAgain,
        secondary: null,
      };
    case 'revoked':
      return {
        kind,
        label: COPY.accessRevoked,
        body: COPY.accessRevokedBody,
        primary: COPY.enableEncryptedMessaging,
        secondary: COPY.signOut,
      };
    case 'enabled':
      return {
        kind,
        label: COPY.encryptedMessagingEnabled,
        body: COPY.encryptedMessagingEnabledBody,
        primary: COPY.openChats,
        secondary: COPY.authorizeAgain,
      };
    case 'unavailable':
      return {
        kind,
        label: COPY.messagingUnavailable,
        body: null,
        primary: null,
        secondary: COPY.back,
      };
    case 'keystore-unavailable':
      return {
        kind,
        label: COPY.keystoreUnavailable,
        body: COPY.keystoreUnavailableBody,
        primary: null,
        secondary: null,
      };
  }
}

export function isBannerSessionKind(
  kind: SessionUiKind,
): kind is 'offline' | 'revoked' | 'keystore-unavailable' {
  return kind === 'offline' || kind === 'revoked' || kind === 'keystore-unavailable';
}
