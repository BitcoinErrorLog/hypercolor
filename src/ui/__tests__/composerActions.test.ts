import { COPY } from '../../copy/uxCopy';
import { LINK_MESSAGE_MAX_BYTES } from '../../types/link';
import { composerActionItems, draftByteSize, draftExceedsByteCap } from '../composerActions';

const OPEN = { messagingEnabled: true, inboxClosed: false, hasTipEndpoints: true };

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

  it('disables Send a tip when the peer has no destinations', () => {
    const items = composerActionItems('dm', { ...OPEN, hasTipEndpoints: false });
    expect(items.find(item => item.id === 'send-tip')?.reason).toBe(COPY.noTipDestinations);
    expect(items.find(item => item.id === 'send-tip-list')?.disabled).toBe(false);
  });
});

describe('draft byte cap', () => {
  it('counts UTF-8 bytes and flags drafts over the Encrypted Link cap', () => {
    expect(draftByteSize('a')).toBe(1);
    expect(draftByteSize('é')).toBe(2);
    expect(draftExceedsByteCap('a'.repeat(LINK_MESSAGE_MAX_BYTES))).toBe(false);
    expect(draftExceedsByteCap('a'.repeat(LINK_MESSAGE_MAX_BYTES + 1))).toBe(true);
  });
});
