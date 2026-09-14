import type { PubkyKey } from '../../types';
import {
  CHAT_KINDS_V,
  HYPERCOLOR_RECEIVER_PATH,
  LEGACY_RECEIVER_JSON_STORAGE_PATH,
  buildCapabilityDocument,
  capabilityPubkyUrl,
  normalizeChatKindsV,
  parseCapabilityDocument,
  parseLegacyChatKindsVDetailed,
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

export async function putChatKindsVReceiverJson(
  sessionAlias: string,
  ownerPubky: PubkyKey,
  noisePublicKey: string,
): Promise<void> {
  const outcome = await advertiseCapability(sessionAlias, ownerPubky, noisePublicKey);
  if (outcome === 'success' || outcome === 'terminal') {
    await clearAdvertiseRetry(ownerPubky);
    return;
  }
  advertiseRetryOwners.add(ownerPubky);
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

export async function drainChatKindsAdvertiseRetry(
  ownerPubky: PubkyKey,
  activeSessionAlias?: string,
): Promise<void> {
  if (typeof StorageService.getChatKindsAdvertiseRetry !== 'function') return;
  const retry = await StorageService.getChatKindsAdvertiseRetry(ownerPubky);
  if (!retry) return;
  if (
    !activeSessionAlias ||
    retry.ownerPubky !== ownerPubky ||
    retry.attempts >= MAX_ADVERTISE_RETRY_ATTEMPTS
  ) {
    await clearAdvertiseRetry(ownerPubky);
    return;
  }
  if (retry.nextRetryAt > Date.now()) return;
  const alias = activeSessionAlias;
  if (
    retry.sessionAlias !== alias &&
    typeof StorageService.saveChatKindsAdvertiseRetry === 'function'
  ) {
    await StorageService.saveChatKindsAdvertiseRetry({
      ownerPubky,
      sessionAlias: alias,
      noisePublicKey: retry.noisePublicKey,
      nextRetryAt: retry.nextRetryAt,
    });
  }
  const outcome = await advertiseCapability(alias, ownerPubky, retry.noisePublicKey);
  if (outcome === 'success' || outcome === 'terminal') {
    await clearAdvertiseRetry(ownerPubky);
    return;
  }
  if (typeof StorageService.recordChatKindsAdvertiseRetryFailure === 'function') {
    const attempts = await StorageService.recordChatKindsAdvertiseRetryFailure(
      ownerPubky,
      Date.now() + retryDelayMs(retry.attempts),
    );
    if (attempts >= MAX_ADVERTISE_RETRY_ATTEMPTS) await clearAdvertiseRetry(ownerPubky);
  }
}

type AdvertiseOutcome = 'success' | 'transient' | 'terminal';
type PublicDocument = { status: number; body: string | null };

async function advertiseCapability(
  sessionAlias: string,
  ownerPubky: PubkyKey,
  noisePublicKey: string,
): Promise<AdvertiseOutcome> {
  try {
    const origin = await resolveHomeserverOrigin(ownerPubky);
    const url = capabilityPubkyUrl(ownerPubky, noisePublicKey);
    const current = await getPublicDocument(ownerPubky, new URL(url).pathname, origin);
    if (current === null) return 'transient';
    if (current.status >= 200 && current.status < 300 && current.body !== null) {
      const parsed = parseCapabilityDocument(current.body);
      // Unlike web's PUBLISH_UNKNOWN, invalid own-path capability documents are terminal here because retrying cannot advertise an incorrect capability.
      if (!parsed) return 'terminal';
      if (parsed.chatKindsV >= CHAT_KINDS_V) return 'success';
    } else if (current.status !== 404 && current.status !== 410) {
      return current.status >= 500 ? 'transient' : 'terminal';
    }
    const marker = await PaykitLinkNative.getReceiverMarker(ownerPubky, HYPERCOLOR_RECEIVER_PATH);
    if (!marker || marker.noisePublicKey !== noisePublicKey) return 'terminal';
    await PaykitLinkNative.putPublic(sessionAlias, url, buildCapabilityDocument(), origin);
    const reconciled = await getPublicDocument(ownerPubky, new URL(url).pathname, origin);
    const markerAfter = await PaykitLinkNative.getReceiverMarker(
      ownerPubky,
      HYPERCOLOR_RECEIVER_PATH,
    );
    const reconciledCapability = reconciled?.body ? parseCapabilityDocument(reconciled.body) : null;
    if (
      reconciledCapability &&
      reconciledCapability.chatKindsV >= CHAT_KINDS_V &&
      markerAfter?.noisePublicKey === noisePublicKey
    ) {
      return 'success';
    }
    if (
      reconciled === null ||
      reconciled.status === 404 ||
      reconciled.status === 410 ||
      reconciled.status >= 500
    ) {
      return 'transient';
    }
    if (reconciled.status >= 200 && reconciled.status < 300 && !reconciledCapability) {
      return 'transient';
    }
    return 'terminal';
  } catch (error) {
    return isTerminalAdvertiseError(error) ? 'terminal' : 'transient';
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

async function getPublicDocument(
  ownerPubky: PubkyKey,
  path: string,
  origin: string,
): Promise<PublicDocument | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(`${origin.replace(/\/+$/, '')}${path}?pubky-host=${ownerPubky}`);
    return { status: res.status, body: res.ok ? await res.text() : null };
  } catch {
    return null;
  }
}

export type ChatKindsVResolution =
  | { source: 'http' | 'legacy'; value: number }
  | { source: 'unavailable' };

async function fetchPeerCapability(
  peerPubky: PubkyKey,
  noisePublicKey: string,
): Promise<ChatKindsVResolution> {
  const origin = await resolveHomeserverOrigin(peerPubky);
  const capability = await getPublicDocument(
    peerPubky,
    new URL(capabilityPubkyUrl(peerPubky, noisePublicKey)).pathname,
    origin,
  );
  if (capability === null || (capability.status >= 500 && capability.status <= 599))
    return { source: 'unavailable' };
  if (capability.status >= 200 && capability.status < 300 && capability.body !== null) {
    const parsed = parseCapabilityDocument(capability.body);
    return parsed ? { source: 'http', value: parsed.chatKindsV } : { source: 'http', value: 0 };
  }
  if (capability.status !== 404 && capability.status !== 410) return { source: 'http', value: 0 };
  const legacy = await getPublicDocument(peerPubky, LEGACY_RECEIVER_JSON_STORAGE_PATH, origin);
  if (legacy === null || legacy.status >= 500) return { source: 'unavailable' };
  if (legacy.status === 404 || legacy.status === 410) return { source: 'legacy', value: 0 };
  if (legacy.status < 200 || legacy.status >= 300 || legacy.body === null) {
    return { source: 'unavailable' };
  }
  const legacyChatKindsV = parseLegacyChatKindsVDetailed(legacy.body);
  return legacyChatKindsV === null
    ? { source: 'unavailable' }
    : { source: 'legacy', value: legacyChatKindsV };
}

export async function resolvePeerChatKindsV(
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
): Promise<number> {
  const detailed = await resolvePeerChatKindsVDetailed(peerPubky, marker);
  return detailed.source === 'unavailable' ? 0 : detailed.value;
}

export async function resolvePeerChatKindsVDetailed(
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
): Promise<ChatKindsVResolution> {
  return fetchPeerCapability(peerPubky, marker.noisePublicKey);
}

export async function persistPeerChatKindsVFromMarker(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  onUpgrade: (owner: PubkyKey, peer: PubkyKey) => Promise<void>,
): Promise<number> {
  const resolved = await resolvePeerChatKindsVDetailed(peerPubky, marker);
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  const previous = stored ? normalizeChatKindsV(stored.chatKindsV) : 0;
  if (resolved.source === 'unavailable') return previous;
  const next = resolved.value;
  if (stored && typeof StorageService.recordPeerChatKindsV === 'function') {
    await StorageService.recordPeerChatKindsV(ownerPubky, peerPubky, next);
  }
  const upgradeKey = `${ownerPubky}:${peerPubky}`;
  if (
    previous < CHAT_KINDS_V &&
    next >= CHAT_KINDS_V &&
    !chatKindsUpgradeReplayed.has(upgradeKey)
  ) {
    chatKindsUpgradeReplayed.add(upgradeKey);
    queueMicrotask(() => void onUpgrade(ownerPubky, peerPubky));
  }
  return next;
}
