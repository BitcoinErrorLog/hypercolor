import { classifyInboundPeer, wotInputFromContact } from '../wotGate';

const THRESHOLD = 0.5;

describe('classifyInboundPeer (WoT gate)', () => {
  it('auto-accepts mutual follows regardless of trust', () => {
    expect(
      classifyInboundPeer(
        { isMutual: true, isFollowing: true, addedManually: false, trustScore: 0 },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('auto-accepts people I already follow', () => {
    expect(
      classifyInboundPeer(
        { isMutual: false, isFollowing: true, addedManually: false, trustScore: 0 },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('auto-accepts a manually added contact', () => {
    expect(
      classifyInboundPeer(
        { isMutual: false, isFollowing: false, addedManually: true, trustScore: 0 },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('auto-accepts when trust meets the configured threshold', () => {
    expect(
      classifyInboundPeer(
        { isMutual: false, isFollowing: false, addedManually: false, trustScore: 0.5 },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
    expect(
      classifyInboundPeer(
        { isMutual: false, isFollowing: false, addedManually: false, trustScore: 0.9 },
        THRESHOLD,
      ),
    ).toBe('auto-accept');
  });

  it('holds a stranger / follower-only below threshold as a request', () => {
    expect(
      classifyInboundPeer(
        { isMutual: false, isFollowing: false, addedManually: false, trustScore: 0.49 },
        THRESHOLD,
      ),
    ).toBe('request');
    expect(classifyInboundPeer(wotInputFromContact(null), THRESHOLD)).toBe('request');
  });
});
