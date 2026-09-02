import { useCallback, useEffect, useState } from 'react';
import { unblockPeer } from '../../../services/contacts/blockPeer';
import { FollowsImportSettings } from '../../../services/contacts/followsImportSettings';
import { LinkService } from '../../../services/link/LinkService';

/**
 * Owner-scoped Block gate for a 1:1 thread. Subscribes to the deny list
 * so Unblock from this screen, Contact Detail, or search all refresh.
 */
export function useThreadPeerGate(ownerPubky: string | null, peerPubky: string) {
  const [, setTick] = useState(0);
  useEffect(() => FollowsImportSettings.subscribe(() => setTick(t => t + 1)), []);

  const peerBlocked = ownerPubky ? FollowsImportSettings.isBlocked(ownerPubky, peerPubky) : false;

  const runUnblock = useCallback(async () => {
    if (!ownerPubky) return;
    await unblockPeer({
      ownerPubky,
      peerPubky,
      persistUnblock: (owner, peer) => FollowsImportSettings.unblock(owner, peer),
      releaseDeclinedRequest: (owner, peer) => LinkService.releaseDeclinedRequest(owner, peer),
      clearCleanupPending: (owner, peer) =>
        FollowsImportSettings.clearBlockCleanupPending(owner, peer),
    });
  }, [ownerPubky, peerPubky]);

  return { peerBlocked, runUnblock };
}
