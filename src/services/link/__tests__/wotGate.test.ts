import { classifyInboundPeer, wotInputFromContact } from '../wotGate';

const THRESHOLD = 0.5;

describe('classifyInboundPeer (WoT gate)', () => {
  it('auto-accepts mutual follows regardless of conversation history', () => {
    expect(
      classifyInboundPeer(
        {
          isMutual: true,
          isFollowing: true,
          addedManually: false,
          hasEstablishedConversation: false,
        },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('auto-accepts people I already follow', () => {
    expect(
      classifyInboundPeer(
        {
          isMutual: false,
          isFollowing: true,
          addedManually: false,
          hasEstablishedConversation: false,
        },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('auto-accepts a manually added contact', () => {
    expect(
      classifyInboundPeer(
        {
          isMutual: false,
          isFollowing: false,
          addedManually: true,
          hasEstablishedConversation: false,
        },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('auto-accepts when a prior routed conversation exists', () => {
    expect(
      classifyInboundPeer(
        {
          isMutual: false,
          isFollowing: false,
          addedManually: false,
          hasEstablishedConversation: true,
        },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('never auto-accepts a follower-only stranger on composite trust', () => {
    expect(
      classifyInboundPeer(
        {
          isMutual: false,
          isFollowing: false,
          addedManually: false,
          hasEstablishedConversation: false,
        },
        THRESHOLD,
      ),
    ).toBe('request');
    expect(classifyInboundPeer(wotInputFromContact(null), THRESHOLD)).toBe('request');
    expect(
      classifyInboundPeer(
        wotInputFromContact({
          isMutual: false,
          isFollowing: false,
          addedManually: false,
        }),
        0,
      ),
    ).toBe('request');
  });
});
