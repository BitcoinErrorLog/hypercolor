import type { PubkyKey } from '../../types';
import {
  CHAT_KINDS_V,
  RECEIVER_JSON_STORAGE_PATH,
  buildReceiverMarkerPutBody,
  chatKindsVFromMarker,
  normalizeChatKindsV,
  parseReceiverMarkerJson,
  receiverJsonPubkyUrl,
} from '../../types/receiverMarker';
import { resolveHomeserverOrigin } from '../homeserverOrigin';
import { StorageService } from '../StorageService';
import { PaykitLinkNative, type ReceiverMarker } from './PaykitLinkNative';

const chatKindsUpgradeReplayed = new Set<string>();

export function resetChatKindsUpgradeReplayedForTests(): void {
  chatKindsUpgradeReplayed.clear();
}

export async function putChatKindsVReceiverJson(
  sessionAlias: string,
  ownerPubky: PubkyKey,
  noisePublicKey: string,
): Promise<void> {
  const origin = await resolveHomeserverOrigin(ownerPubky);
  const body = buildReceiverMarkerPutBody({ noisePublicKey });
  await PaykitLinkNative.putPublic(sessionAlias, receiverJsonPubkyUrl(ownerPubky), body, origin);
}

async function fetchPeerReceiverJsonChatKindsV(peerPubky: PubkyKey): Promise<number> {
  if (typeof fetch !== 'function') return 0;
  try {
    const origin = await resolveHomeserverOrigin(peerPubky);
    const url = `${origin.replace(/\/+$/, '')}${RECEIVER_JSON_STORAGE_PATH}?pubky-host=${peerPubky}`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const text = await res.text();
    const parsed = parseReceiverMarkerJson(text);
    return parsed?.chatKindsV ?? 0;
  } catch {
    return 0;
  }
}

export async function resolvePeerChatKindsV(
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
): Promise<number> {
  const fromMarker = chatKindsVFromMarker(marker);
  if (fromMarker >= 1) return fromMarker;
  return fetchPeerReceiverJsonChatKindsV(peerPubky);
}

export async function persistPeerChatKindsVFromMarker(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  onUpgrade: (owner: PubkyKey, peer: PubkyKey) => Promise<void>,
): Promise<number> {
  const next = await resolvePeerChatKindsV(peerPubky, marker);
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  const prev = stored ? normalizeChatKindsV(stored.chatKindsV) : 0;
  if (stored && typeof StorageService.recordPeerChatKindsV === 'function') {
    await StorageService.recordPeerChatKindsV(ownerPubky, peerPubky, next);
  }
  const upgradeKey = `${ownerPubky}:${peerPubky}`;
  if (prev < CHAT_KINDS_V && next >= CHAT_KINDS_V && !chatKindsUpgradeReplayed.has(upgradeKey)) {
    chatKindsUpgradeReplayed.add(upgradeKey);
    queueMicrotask(() => {
      void onUpgrade(ownerPubky, peerPubky);
    });
  }
  return next;
}
