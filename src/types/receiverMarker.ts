/**
 * Additive receiver.json advertisement for chat kinds v1 (kinds-v1.md R7).
 * `chat_kinds_v` is a top-level integer; absent or 0 means pre-v1.
 * Unknown fields on the marker document are ignored.
 */

export const CHAT_KINDS_V = 1;
export const CHAT_KINDS_V_KEY = 'chat_kinds_v';
/** Public document used to advertise v1 (additive; not the Paykit FFI marker struct). */
export const RECEIVER_JSON_STORAGE_PATH = '/pub/paykit.app/v0/receiver.json';

export function receiverJsonPubkyUrl(ownerPubky: string): string {
  return `pubky://${ownerPubky}${RECEIVER_JSON_STORAGE_PATH}`;
}

/** Absent, non-finite, or below 1 → 0 (pre-v1). */
export function normalizeChatKindsV(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1 ? Math.floor(value) : 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n >= 1 ? Math.floor(n) : 0;
  }
  return 0;
}

export type ParsedReceiverMarkerDoc = {
  chatKindsV: number;
  noisePublicKey: string | null;
};

/**
 * Parse a receiver.json body. Unknown keys are ignored. Missing
 * `chat_kinds_v` is pre-v1 (0).
 */
export function parseReceiverMarkerJson(raw: string): ParsedReceiverMarkerDoc | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const noise =
    typeof rec.noisePublicKey === 'string'
      ? rec.noisePublicKey
      : typeof rec.noise_public_key === 'string'
        ? rec.noise_public_key
        : null;
  return {
    chatKindsV: normalizeChatKindsV(rec[CHAT_KINDS_V_KEY]),
    noisePublicKey: noise && noise.length > 0 ? noise : null,
  };
}

export function buildReceiverMarkerPutBody(input: { noisePublicKey: string }): string {
  return JSON.stringify({
    noisePublicKey: input.noisePublicKey,
    [CHAT_KINDS_V_KEY]: CHAT_KINDS_V,
  });
}

/**
 * Additive RMW: keep every existing field (including unknown keys) and only
 * insert `chat_kinds_v` when it is absent. Returns null when `raw` is not a
 * JSON object — callers must not PUT a partial replacement.
 */
export function addChatKindsVToReceiverJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (rec[CHAT_KINDS_V_KEY] === CHAT_KINDS_V) return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  if (Object.prototype.hasOwnProperty.call(rec, CHAT_KINDS_V_KEY)) {
    return JSON.stringify({ ...rec, [CHAT_KINDS_V_KEY]: CHAT_KINDS_V });
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return `{"${CHAT_KINDS_V_KEY}":${CHAT_KINDS_V}}`;
  const withoutTrailingComma = inner.endsWith(',') ? inner.slice(0, -1) : inner;
  return `{${withoutTrailingComma},"${CHAT_KINDS_V_KEY}":${CHAT_KINDS_V}}`;
}

export function chatKindsVFromMarker(marker: {
  chatKindsV?: unknown;
  capabilitiesJson?: string;
}): number {
  const direct = normalizeChatKindsV(marker.chatKindsV);
  if (direct >= 1) return direct;
  if (typeof marker.capabilitiesJson === 'string' && marker.capabilitiesJson.length > 0) {
    const parsed = parseReceiverMarkerJson(marker.capabilitiesJson);
    if (parsed && parsed.chatKindsV >= 1) return parsed.chatKindsV;
  }
  return 0;
}
