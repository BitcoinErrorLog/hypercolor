import { COPY } from '../../copy/uxCopy';
import { formatDeliveryState, formatLinkStatus } from '../messageStatus';

const OUTBOUND_WORDS = new Set([
  COPY.queued,
  COPY.sent,
  COPY.failed,
  COPY.inboxClosed,
  COPY.offline,
  COPY.needsEnable,
  COPY.connectionChangedRetry,
]);

describe('formatDeliveryState', () => {
  it('maps sending to Queued and failed to Failed', () => {
    expect(formatDeliveryState('sending')).toBe(COPY.queued);
    expect(formatDeliveryState('failed')).toBe(COPY.failed);
  });

  it('never emits delivered or read', () => {
    expect(formatDeliveryState('delivered')).toBe(COPY.sent);
    expect(formatDeliveryState('read')).toBe(COPY.sent);
    expect(formatDeliveryState('sent')).toBe(COPY.sent);
    for (const state of ['sending', 'sent', 'failed', 'delivered', 'read', 'unknown']) {
      const label = formatDeliveryState(state);
      expect(label.toLowerCase()).not.toBe('delivered');
      expect(label.toLowerCase()).not.toBe('read');
      expect(OUTBOUND_WORDS.has(label)).toBe(true);
    }
  });
});

describe('formatLinkStatus', () => {
  it('maps per-peer Encrypted Link status to the allowed words', () => {
    expect(formatLinkStatus('needs-enable')).toBe(COPY.needsEnable);
    expect(formatLinkStatus('session-offline')).toBe(COPY.offline);
    expect(formatLinkStatus('not-enrolled')).toBe(COPY.inboxClosed);
    expect(formatLinkStatus('ready')).toBeNull();
    expect(formatLinkStatus('message-request')).toBeNull();
    expect(formatLinkStatus('error')).toBe(COPY.connectionChangedRetry);
  });
});
