import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AttachmentRecord } from '../../types/attachment';
import { COPY } from '../../copy/uxCopy';
import { AttachmentBubble } from '../AttachmentBubble';

jest.mock('../../services/attachments/AttachmentService', () => ({
  AttachmentService: {
    resolveAttachment: jest.fn(),
    resolveThumbnail: jest.fn(),
  },
}));

function record(partial: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    ownerPubky: 'a'.repeat(52),
    eventId: '11111111-1111-4111-8111-111111111111',
    conversationId: 'dm:peer',
    channelId: null,
    senderPubky: 'a'.repeat(52),
    direction: 'sent',
    location: 'pubky://a/pub/hypercolor.app/v1/attachments/x',
    keyRef: 'ref',
    contentType: 'application/pdf',
    size: 12,
    thumbnailLocation: null,
    localCachePath: null,
    createdAt: 1,
    updatedAt: 1,
    deliveryState: 'failed',
    resolveState: 'failed',
    ...partial,
  };
}

describe('AttachmentBubble', () => {
  it('offers Retry for a failed outgoing send', async () => {
    const onRetrySend = jest.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<AttachmentBubble record={record()} isMine onRetrySend={onRetrySend} />);
    });
    const retry = tree.root.findByProps({ testID: 'attachmentRetrySend' });
    expect(retry.props.accessibilityLabel).toBe(COPY.retry);
    await act(async () => {
      retry.props.onPress();
    });
    expect(onRetrySend).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.unmount();
    });
  });
});
