import { COPY } from '../../copy/uxCopy';
import { sessionUiFromEnableStatus, sessionUiModel } from '../sessionUi';

describe('sessionUiFromEnableStatus', () => {
  it('maps the enumerated session kinds', () => {
    expect(sessionUiFromEnableStatus(false, null, false)).toBe('no-identity');
    expect(sessionUiFromEnableStatus(true, 'native-missing', false)).toBe('unavailable');
    expect(sessionUiFromEnableStatus(true, 'enabled', true)).toBe('enabled');
    expect(sessionUiFromEnableStatus(true, 'session-offline', true)).toBe('offline');
    expect(sessionUiFromEnableStatus(true, 'needs-enable', false)).toBe('needs-enable');
    expect(sessionUiFromEnableStatus(true, 'needs-enable', true)).toBe('revoked');
  });
});

describe('sessionUiModel', () => {
  it('uses canonical labels and actions for each kind', () => {
    expect(sessionUiModel('no-identity')).toEqual(
      expect.objectContaining({
        label: COPY.notConnected,
        primary: COPY.connectWithPubkyRing,
      }),
    );
    expect(sessionUiModel('needs-enable')).toEqual(
      expect.objectContaining({
        label: COPY.messagingNotEnabled,
        body: COPY.approveScopesBody,
        primary: COPY.enableEncryptedMessaging,
        secondary: COPY.notNow,
      }),
    );
    expect(sessionUiModel('waiting-for-ring')).toEqual(
      expect.objectContaining({
        label: COPY.waitingForRing,
        primary: COPY.openPubkyRing,
      }),
    );
    expect(sessionUiModel('expired')).toEqual(
      expect.objectContaining({
        label: COPY.authorizationExpired,
        primary: COPY.generateNewAuthorization,
      }),
    );
    expect(sessionUiModel('denied')).toEqual(
      expect.objectContaining({
        label: COPY.authorizationDeclined,
        primary: COPY.tryAgain,
      }),
    );
    expect(sessionUiModel('offline')).toEqual(
      expect.objectContaining({
        label: COPY.sessionOfflineBanner,
        primary: COPY.tryAgain,
      }),
    );
    expect(sessionUiModel('revoked')).toEqual(
      expect.objectContaining({
        label: COPY.accessRevoked,
        primary: COPY.enableEncryptedMessaging,
        secondary: COPY.signOut,
      }),
    );
    expect(sessionUiModel('enabled')).toEqual(
      expect.objectContaining({
        label: COPY.encryptedMessagingEnabled,
        primary: COPY.openChats,
      }),
    );
    expect(sessionUiModel('unavailable').label).toBe(COPY.messagingUnavailable);
    expect(sessionUiModel('unavailable').label).not.toBe('Native module missing');
  });
});
