import { StorageService } from '../../StorageService';
import { isGroupInboundGated } from '../groupInboundGate';
import {
  buildGroupMembershipEnvelope,
  buildGroupMessageEnvelope,
  type GroupChannel,
} from '../../../types/group';

jest.mock('../../StorageService', () => ({
  StorageService: {
    getGroupChannel: jest.fn(),
  },
}));

const mockedStorage = jest.mocked(StorageService);

const OWNER = 'a'.repeat(52);
const SENDER = 'z'.repeat(52);
const CHANNEL_ID = `${SENDER}:00000000-0000-4000-8000-00000000aaaa`;
const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const SENT_AT = 1_700_000_000_000;

const knownChannel: GroupChannel = {
  ownerPubky: OWNER,
  channelId: CHANNEL_ID,
  name: 'shared',
  createdAt: SENT_AT,
  updatedAt: SENT_AT,
  createdBy: SENDER,
  isPublic: false,
  lastMessageAt: null,
  membershipEpoch: 0,
};

function messageEnvelope() {
  return buildGroupMessageEnvelope({
    channelId: CHANNEL_ID,
    eventId: EVENT_ID,
    sentAt: SENT_AT,
    body: 'hello',
  }).envelope;
}

function createEnvelope() {
  return buildGroupMembershipEnvelope({
    channelId: CHANNEL_ID,
    eventId: EVENT_ID,
    sentAt: SENT_AT,
    op: 'create',
    name: 'planted',
    members: [OWNER, SENDER],
  }).envelope;
}

describe('isGroupInboundGated storage resolution', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('does not consult storage when the peer is accepted', async () => {
    const gated = await isGroupInboundGated({
      ownerPubky: OWNER,
      envelope: createEnvelope(),
      peerTrust: 'accepted',
    });
    expect(gated).toBe(false);
    expect(mockedStorage.getGroupChannel).not.toHaveBeenCalled();
  });

  it('gates content when getGroupChannel returns null', async () => {
    mockedStorage.getGroupChannel.mockResolvedValue(null);
    const gated = await isGroupInboundGated({
      ownerPubky: OWNER,
      envelope: messageEnvelope(),
      peerTrust: 'gated',
    });
    expect(gated).toBe(true);
    expect(mockedStorage.getGroupChannel).toHaveBeenCalledWith(OWNER, CHANNEL_ID);
  });

  it('gates content when getGroupChannel returns undefined (unstubbed jest.fn default)', async () => {
    mockedStorage.getGroupChannel.mockResolvedValue(undefined as unknown as GroupChannel | null);
    const gated = await isGroupInboundGated({
      ownerPubky: OWNER,
      envelope: messageEnvelope(),
      peerTrust: 'gated',
    });
    expect(gated).toBe(true);
  });

  it('allows content when storage returns a locally known channel row', async () => {
    mockedStorage.getGroupChannel.mockResolvedValue(knownChannel);
    const gated = await isGroupInboundGated({
      ownerPubky: OWNER,
      envelope: messageEnvelope(),
      peerTrust: 'gated',
    });
    expect(gated).toBe(false);
  });

  it('still gates create even when the channel row already exists locally', async () => {
    mockedStorage.getGroupChannel.mockResolvedValue(knownChannel);
    const gated = await isGroupInboundGated({
      ownerPubky: OWNER,
      envelope: createEnvelope(),
      peerTrust: 'gated',
    });
    expect(gated).toBe(true);
  });
});
