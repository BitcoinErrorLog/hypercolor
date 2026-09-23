import { COPY } from '../../copy/uxCopy';
import { LINK_MESSAGE_MAX_BYTES } from '../../types/link';
import {
  composerActionItems,
  draftEnvelopeByteSize,
  draftExceedsByteCap,
} from '../composerActions';

const OPEN = {
  messagingEnabled: true,
  inboxClosed: false,
  hasTipEndpoints: true,
  gifSearchAvailable: true,
};

describe('composerActionItems', () => {
  it('disables every action until messaging is enabled', () => {
    const items = composerActionItems('dm', {
      messagingEnabled: false,
      inboxClosed: false,
      hasTipEndpoints: true,
    });
    expect(items.every(item => item.disabled)).toBe(true);
    expect(items.map(item => item.reason)).toEqual(items.map(() => COPY.enableMessagingReason));
  });

  it('includes a visible icon for every action', () => {
    const items = composerActionItems('dm', OPEN);
    expect(items.map(item => item.icon)).toEqual([
      'image-outline',
      'document-text-outline',
      'film-outline',
      'card-outline',
      'arrow-up-circle-outline',
      'list-outline',
    ]);
    expect(items.every(item => item.icon.length > 0)).toBe(true);
  });

  it('disables DM actions with Inbox closed when the peer is not enrolled', () => {
    const items = composerActionItems('dm', {
      messagingEnabled: true,
      inboxClosed: true,
      hasTipEndpoints: true,
    });
    expect(items.find(item => item.id === 'request-payment')?.reason).toBe(COPY.inboxClosed);
    expect(items.find(item => item.id === 'photo')?.reason).toBe(COPY.inboxClosed);
  });

  it('disables payments and tips in groups and public topics', () => {
    const group = composerActionItems('private-group', OPEN);
    expect(group.find(item => item.id === 'request-payment')?.reason).toBe(COPY.paymentsDmOnly);
    expect(group.find(item => item.id === 'send-tip')?.reason).toBe(COPY.paymentsDmOnly);
    expect(group.find(item => item.id === 'photo')?.disabled).toBe(false);

    const topic = composerActionItems('public-topic', OPEN);
    expect(topic.find(item => item.id === 'photo')?.reason).toBe(COPY.attachmentsPublicUnsupported);
    expect(topic.find(item => item.id === 'file')?.reason).toBe(COPY.attachmentsPublicUnsupported);
    expect(topic.find(item => item.id === 'request-payment')?.reason).toBe(COPY.paymentsDmOnly);
  });

  it('omits GIF unless search is configured', () => {
    const hidden = composerActionItems('dm', {
      messagingEnabled: true,
      inboxClosed: false,
      hasTipEndpoints: true,
    });
    expect(hidden.find(item => item.id === 'gif')).toBeUndefined();
    const shown = composerActionItems('dm', { ...OPEN, gifSearchAvailable: true });
    expect(shown.find(item => item.id === 'gif')?.disabled).toBe(false);
  });

  it('disables Send a tip when the peer has no destinations', () => {
    const items = composerActionItems('dm', { ...OPEN, hasTipEndpoints: false });
    expect(items.find(item => item.id === 'send-tip')?.reason).toBe(COPY.noTipDestinations);
    expect(items.find(item => item.id === 'send-tip-list')?.disabled).toBe(false);
  });

  it('disables DM actions on standby until this device is receiving', () => {
    const items = composerActionItems('dm', { ...OPEN, standbyNewChat: true });
    expect(items.every(item => item.disabled)).toBe(true);
    expect(items.map(item => item.reason)).toEqual(items.map(() => COPY.standbyComposerNotice));
  });
});

describe('draft envelope byte cap', () => {
  const dm = { surface: 'dm' as const };

  it('counts the serialized envelope, not just the body', () => {
    const body = 'hi';
    const size = draftEnvelopeByteSize(body, dm);
    expect(size).toBeGreaterThan(new TextEncoder().encode(body).byteLength);
    expect(draftExceedsByteCap(body, dm)).toBe(false);
  });

  it('rejects a body that only fits if the cap were counted on plaintext', () => {
    expect(draftExceedsByteCap('a'.repeat(LINK_MESSAGE_MAX_BYTES), dm)).toBe(true);
    expect(draftExceedsByteCap('é'.repeat(500), dm)).toBe(true);
  });

  it('counts UTF-8 and JSON-escaped characters against the envelope budget', () => {
    const quoted = `${'a'.repeat(850)}"quoted"`;
    expect(draftEnvelopeByteSize(quoted, dm)).toBeGreaterThan(
      new TextEncoder().encode(quoted).byteLength,
    );
    const groupSize = draftEnvelopeByteSize('hello', {
      surface: 'private-group',
      channelId: 'group-probe',
    });
    const dmSize = draftEnvelopeByteSize('hello', dm);
    expect(groupSize).toBeGreaterThan(dmSize);
  });

  it('allows a draft at the envelope cap and rejects one extra character', () => {
    let fit = 0;
    for (let n = 1; n <= LINK_MESSAGE_MAX_BYTES; n += 1) {
      if (draftExceedsByteCap('a'.repeat(n), dm)) break;
      fit = n;
    }
    expect(fit).toBeGreaterThan(0);
    expect(draftEnvelopeByteSize('a'.repeat(fit), dm)).toBeLessThanOrEqual(LINK_MESSAGE_MAX_BYTES);
    expect(draftExceedsByteCap('a'.repeat(fit), dm)).toBe(false);
    expect(draftExceedsByteCap('a'.repeat(fit + 1), dm)).toBe(true);
  });
});
