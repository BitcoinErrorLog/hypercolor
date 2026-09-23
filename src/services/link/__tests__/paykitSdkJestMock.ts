/**
 * Jest double for PaykitSdkNative. Handshake role stays inside ensure.
 * Send and receive delegate to the PaykitLinkNative jest fns so existing
 * delivery tests keep a single observable seam.
 */
import { PaykitLinkNative } from '../PaykitLinkNative';
export class SdkOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SdkOperationError';
    this.code = code;
  }
}

export function isSdkOperationError(err: unknown): err is SdkOperationError {
  return err instanceof SdkOperationError;
}

type StreamMessage = { kind: string | null; rawJson: string };
let lastMessages: StreamMessage[] = [];

export const PaykitSdkNative = {
  isAvailable: jest.fn(() => true),
  bindOwner: jest.fn(async () => undefined),
  ensureLinkWithPeer: jest.fn(async (ownerPubky: string, peerPubky: string) => ({
    counterparty: peerPubky,
    path: 'hypercolor/wallet',
    state: 'LINKED' as const,
    generation: '1',
    role: 'INITIATOR' as const,
    leaseSkipped: false,
    ownerPubky,
  })),
  observeEncryptedLinkRecoveryMarker: jest.fn(async () => ({
    state: 'LINKED' as const,
    remoteMarkerChanged: false,
    localAttemptId: null,
    remoteAttemptId: null,
  })),
  enqueueOpaquePrivateApplicationMessageJson: jest.fn(
    async (_owner: string, _peer: string, _path: string, rawJson: string) => {
      await PaykitLinkNative.sendPrivateMessageJson('sdk-link', rawJson);
      return { queueId: 'sdk-queue-1' };
    },
  ),
  processOutboundPrivateMessages: jest.fn(async () => ({ sent: ['sdk-queue-1'], failed: [] })),
  receivePrivateMessages: jest.fn(async () => {
    const received = await PaykitLinkNative.receivePrivateMessages('sdk-link');
    lastMessages = received?.messages ?? [];
    return {
      receiveBatchId: '1',
      streamItemIds: lastMessages.map((_item, index) => String(index)),
    };
  }),
  privateStreamItems: jest.fn(async (_owner: string, ids: string[]) => {
    return ids.map(id => {
      const item = lastMessages[Number(id)];
      return {
        streamItemId: id,
        counterparty: '',
        path: 'hypercolor/wallet',
        kind: item?.kind ?? '',
        rawJson: item?.rawJson ?? '',
        eventId: '',
      };
    });
  }),
  deleteOwnerState: jest.fn(async () => undefined),
};

export function seedPaykitSdkJestMock(): void {
  PaykitSdkNative.isAvailable.mockReset();
  PaykitSdkNative.isAvailable.mockReturnValue(true);
  PaykitSdkNative.bindOwner.mockReset();
  PaykitSdkNative.bindOwner.mockResolvedValue(undefined);
  PaykitSdkNative.ensureLinkWithPeer.mockReset();
  PaykitSdkNative.ensureLinkWithPeer.mockImplementation(
    async (ownerPubky: string, peerPubky: string) => ({
      counterparty: peerPubky,
      path: 'hypercolor/wallet',
      state: 'LINKED' as const,
      generation: '1',
      role: 'INITIATOR' as const,
      leaseSkipped: false,
      ownerPubky,
    }),
  );
  PaykitSdkNative.observeEncryptedLinkRecoveryMarker.mockReset();
  PaykitSdkNative.observeEncryptedLinkRecoveryMarker.mockResolvedValue({
    state: 'LINKED',
    remoteMarkerChanged: false,
    localAttemptId: null,
    remoteAttemptId: null,
  });
  PaykitSdkNative.enqueueOpaquePrivateApplicationMessageJson.mockReset();
  PaykitSdkNative.enqueueOpaquePrivateApplicationMessageJson.mockImplementation(
    async (_owner: string, _peer: string, _path: string, rawJson: string) => {
      await PaykitLinkNative.sendPrivateMessageJson('sdk-link', rawJson);
      return { queueId: 'sdk-queue-1' };
    },
  );
  PaykitSdkNative.processOutboundPrivateMessages.mockReset();
  PaykitSdkNative.processOutboundPrivateMessages.mockResolvedValue({
    sent: ['sdk-queue-1'],
    failed: [],
  });
  PaykitSdkNative.receivePrivateMessages.mockReset();
  PaykitSdkNative.receivePrivateMessages.mockImplementation(async () => {
    const received = await PaykitLinkNative.receivePrivateMessages('sdk-link');
    lastMessages = received?.messages ?? [];
    return {
      receiveBatchId: '1',
      streamItemIds: lastMessages.map((_item, index) => String(index)),
    };
  });
  PaykitSdkNative.privateStreamItems.mockReset();
  PaykitSdkNative.privateStreamItems.mockImplementation(async (_owner: string, ids: string[]) => {
    return ids.map(id => {
      const item = lastMessages[Number(id)];
      return {
        streamItemId: id,
        counterparty: '',
        path: 'hypercolor/wallet',
        kind: item?.kind ?? '',
        rawJson: item?.rawJson ?? '',
        eventId: '',
      };
    });
  });
  PaykitSdkNative.deleteOwnerState.mockReset();
  PaykitSdkNative.deleteOwnerState.mockResolvedValue(undefined);
}
