import type { PubkyKey } from '../../types';
import {
  CHAT_KINDS_V,
  RECEIVER_JSON_STORAGE_PATH,
  addChatKindsVToReceiverJson,
  chatKindsVFromMarker,
  normalizeChatKindsV,
  parseReceiverMarkerJson,
  receiverJsonPubkyUrl,
} from '../../types/receiverMarker';
import { resolveHomeserverOrigin } from '../homeserverOrigin';
import { StorageService } from '../StorageService';
import { PaykitLinkNative, type ReceiverMarker } from './PaykitLinkNative';

const chatKindsUpgradeReplayed = new Set<string>();
const advertiseRetryOwners = new Set<string>();

export function resetChatKindsUpgradeReplayedForTests(): void {
  chatKindsUpgradeReplayed.clear();
  advertiseRetryOwners.clear();
}

export function chatKindsAdvertiseRetryPending(ownerPubky: PubkyKey): boolean {
  return advertiseRetryOwners.has(ownerPubky);
}

export async function putChatKindsVReceiverJson(
  sessionAlias: string,
  ownerPubky: PubkyKey,
  noisePublicKey: string,
): Promise<void> {
  const origin = await resolveHomeserverOrigin(ownerPubky);
  const first = await getPublicReceiverJson(ownerPubky, origin);
  if (first === null) {
    advertiseRetryOwners.add(ownerPubky);
    return;
  }
  const latest = await getPublicReceiverJson(ownerPubky, origin);
  if (latest === null) {
    advertiseRetryOwners.add(ownerPubky);
    return;
  }
  const latestDoc = parseReceiverMarkerJson(latest);
  if (latestDoc?.noisePublicKey && latestDoc.noisePublicKey !== noisePublicKey) {
    advertiseRetryOwners.add(ownerPubky);
    return;
  }
  const body = addChatKindsVToReceiverJson(latest);
  if (body === null) {
    advertiseRetryOwners.delete(ownerPubky);
    return;
  }
  await PaykitLinkNative.putPublic(sessionAlias, receiverJsonPubkyUrl(ownerPubky), body, origin);
  advertiseRetryOwners.delete(ownerPubky);
}

async function getPublicReceiverJson(pubky: PubkyKey, origin: string): Promise<string | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const url = `${origin.replace(/\/+$/, '')}${RECEIVER_JSON_STORAGE_PATH}?pubky-host=${pubky}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export type ChatKindsVResolution =
  | { source: 'marker' | 'http'; value: number }
  | { source: 'unavailable' };

async function fetchPeerReceiverJsonChatKindsV(peerPubky: PubkyKey): Promise<ChatKindsVResolution> {
  const origin = await resolveHomeserverOrigin(peerPubky);
  const text = await getPublicReceiverJson(peerPubky, origin);
  if (text === null) return { source: 'unavailable' };
  const parsed = parseReceiverMarkerJson(text);
  if (!parsed) return { source: 'unavailable' };
  return { source: 'http', value: parsed.chatKindsV };
}

export async function resolvePeerChatKindsV(
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
): Promise<number> {
  const detailed = await resolvePeerChatKindsVDetailed(peerPubky, marker);
  if (detailed.source === 'unavailable') return 0;
  return detailed.value;
}

export async function resolvePeerChatKindsVDetailed(
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
): Promise<ChatKindsVResolution> {
  const fromMarker = chatKindsVFromMarker(marker);
  if (fromMarker >= 1) return { source: 'marker', value: fromMarker };
  return fetchPeerReceiverJsonChatKindsV(peerPubky);
}

export async function persistPeerChatKindsVFromMarker(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  onUpgrade: (owner: PubkyKey, peer: PubkyKey) => Promise<void>,
): Promise<number> {
  const resolved = await resolvePeerChatKindsVDetailed(peerPubky, marker);
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  const prev = stored ? normalizeChatKindsV(stored.chatKindsV) : 0;
  if (resolved.source === 'unavailable') {
    return prev;
  }
  const next = resolved.value;
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
