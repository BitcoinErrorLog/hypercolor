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
const MAX_ADVERTISE_RETRY_ATTEMPTS = 10;
const ADVERTISE_RETRY_BASE_MS = 15_000;
const ADVERTISE_RETRY_MAX_MS = 30 * 60 * 1000;

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
  const outcome = await advertiseChatKindsVReceiverJson(sessionAlias, ownerPubky, noisePublicKey);
  if (outcome === 'success' || outcome === 'terminal') {
    await clearAdvertiseRetry(ownerPubky);
    return;
  }
  advertiseRetryOwners.add(ownerPubky);
  if (outcome === 'transient') {
    if (typeof StorageService.saveChatKindsAdvertiseRetry === 'function') {
      try {
        await StorageService.saveChatKindsAdvertiseRetry({
          ownerPubky,
          sessionAlias,
          noisePublicKey,
          nextRetryAt: Date.now() + ADVERTISE_RETRY_BASE_MS,
        });
      } catch {
        // The volatile flag still drives a same-session retry.
      }
    }
  }
}

export async function drainChatKindsAdvertiseRetry(
  ownerPubky: PubkyKey,
  activeSessionAlias?: string,
): Promise<void> {
  if (typeof StorageService.getChatKindsAdvertiseRetry !== 'function') return;
  const retry = await StorageService.getChatKindsAdvertiseRetry(ownerPubky);
  if (!retry) return;
  if (
    retry.ownerPubky !== ownerPubky ||
    !activeSessionAlias ||
    retry.attempts >= MAX_ADVERTISE_RETRY_ATTEMPTS
  ) {
    await clearAdvertiseRetry(ownerPubky);
    return;
  }
  if (retry.nextRetryAt > Date.now()) return;

  if (retry.sessionAlias !== activeSessionAlias) {
    if (typeof StorageService.saveChatKindsAdvertiseRetry !== 'function') {
      await clearAdvertiseRetry(ownerPubky);
      return;
    }
    await StorageService.saveChatKindsAdvertiseRetry({
      ownerPubky,
      sessionAlias: activeSessionAlias,
      noisePublicKey: retry.noisePublicKey,
      nextRetryAt: retry.nextRetryAt,
    });
  }

  const outcome = await advertiseChatKindsVReceiverJson(
    activeSessionAlias,
    ownerPubky,
    retry.noisePublicKey,
  );
  if (outcome === 'success' || outcome === 'terminal') {
    await clearAdvertiseRetry(ownerPubky);
    return;
  }
  if (typeof StorageService.recordChatKindsAdvertiseRetryFailure === 'function') {
    const nextAttempts = await StorageService.recordChatKindsAdvertiseRetryFailure(
      ownerPubky,
      Date.now() + retryDelayMs(retry.attempts),
    );
    if (nextAttempts >= MAX_ADVERTISE_RETRY_ATTEMPTS) {
      await clearAdvertiseRetry(ownerPubky);
    }
  }
}

type AdvertiseOutcome = 'success' | 'transient' | 'terminal';

async function advertiseChatKindsVReceiverJson(
  sessionAlias: string,
  ownerPubky: PubkyKey,
  noisePublicKey: string,
): Promise<AdvertiseOutcome> {
  try {
    const origin = await resolveHomeserverOrigin(ownerPubky);
    const first = await getPublicReceiverJson(ownerPubky, origin);
    if (first === null) return 'transient';
    const latest = await getPublicReceiverJson(ownerPubky, origin);
    if (latest === null) return 'transient';
    const latestDoc = parseReceiverMarkerJson(latest);
    if (latestDoc?.noisePublicKey && latestDoc.noisePublicKey !== noisePublicKey) {
      return 'terminal';
    }
    const body = addChatKindsVToReceiverJson(latest);
    if (body === null) return 'success';
    await PaykitLinkNative.putPublic(sessionAlias, receiverJsonPubkyUrl(ownerPubky), body, origin);
    return 'success';
  } catch (error) {
    if (isTerminalAdvertiseError(error)) return 'terminal';
    return 'transient';
  }
}

function isTerminalAdvertiseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === 'auth' ||
    code === 'validation' ||
    code === 'protocol' ||
    code === 'consumed' ||
    code === 'invalid_alias'
  );
}

function retryDelayMs(attempts: number): number {
  return Math.min(ADVERTISE_RETRY_BASE_MS * 2 ** attempts, ADVERTISE_RETRY_MAX_MS);
}

async function clearAdvertiseRetry(ownerPubky: PubkyKey): Promise<void> {
  advertiseRetryOwners.delete(ownerPubky);
  if (typeof StorageService.clearChatKindsAdvertiseRetry === 'function') {
    await StorageService.clearChatKindsAdvertiseRetry(ownerPubky);
  }
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
