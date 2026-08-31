import { classifyInboundPeer, wotInputFromContact } from '../wotGate';

describe('classifyInboundPeer (WoT gate)', () => {
  const stranger = {
    isMutual: false,
    isFollowing: false,
    addedManually: false,
    hasPriorRoutedConversation: false,
  };

  it('requests a never-seen stranger', () => {
    expect(classifyInboundPeer(stranger)).toBe('request');
  });

  it('requests a follow-only inbound peer', () => {
    expect(classifyInboundPeer({ ...stranger, isFollowing: true })).toBe('request');
  });

  it('requests a mutual-follow inbound peer', () => {
    expect(classifyInboundPeer({ ...stranger, isMutual: true })).toBe('request');
  });

  it('requests a manually added inbound peer', () => {
    expect(classifyInboundPeer({ ...stranger, addedManually: true })).toBe('request');
  });

  it('keeps a prior routed conversation accepted', () => {
    expect(classifyInboundPeer({ ...stranger, hasPriorRoutedConversation: true })).toBe(
      'auto-accept',
    );
    expect(
      classifyInboundPeer({
        isMutual: true,
        isFollowing: true,
        addedManually: true,
        hasPriorRoutedConversation: true,
      }),
    ).toBe('auto-accept');
  });

  it('maps contact flags without treating them as a gate', () => {
    expect(
      classifyInboundPeer(
        wotInputFromContact({
          isMutual: true,
          isFollowing: true,
          addedManually: true,
        }),
      ),
    ).toBe('request');
    expect(
      classifyInboundPeer(
        wotInputFromContact({ isMutual: false, isFollowing: false, addedManually: false }, true),
      ),
    ).toBe('auto-accept');
  });
});
