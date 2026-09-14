export const CHAT_KINDS_V = 1;
export const CHAT_KINDS_V_KEY = 'chat_kinds_v';
export const HYPERCOLOR_RECEIVER_PATH = 'hypercolor/wallet';
export const HYPERCOLOR_CAPABILITIES_PATH_PREFIX = '/pub/hypercolor.app/v1/receivers/';
export const LEGACY_RECEIVER_JSON_STORAGE_PATH = '/pub/paykit.app/v0/receiver.json';
export const MAX_CAPABILITIES_BYTES = 512;

export function capabilityPubkyUrl(ownerPubky: string, noisePublicKey: string): string {
  return `pubky://${ownerPubky}${HYPERCOLOR_CAPABILITIES_PATH_PREFIX}${noisePublicKey}/capabilities.json`;
}

export function legacyReceiverJsonPubkyUrl(ownerPubky: string): string {
  return `pubky://${ownerPubky}${LEGACY_RECEIVER_JSON_STORAGE_PATH}`;
}

export type ParsedCapabilityDocument = { chatKindsV: number };

export function normalizeChatKindsV(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 0;
}

function parseObject(raw: string, maxBytes?: number): Record<string, unknown> | null {
  if (maxBytes !== undefined && Buffer.byteLength(raw, 'utf8') > maxBytes) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const objects: Set<string>[] = [];
    let inString = false;
    let escaped = false;
    let token = '';
    for (let i = 0; i < raw.length; i += 1) {
      const char = raw[i];
      if (inString) {
        if (escaped) {
          token += char;
          escaped = false;
        } else if (char === '\\') {
          token += char;
          escaped = true;
        } else if (char === '"') {
          inString = false;
          let j = i + 1;
          while (/\s/.test(raw[j] ?? '')) j += 1;
          if (raw[j] === ':') {
            const key = JSON.parse(`${token}"`) as string;
            const current = objects.at(-1);
            if (current?.has(key)) return null;
            current?.add(key);
          }
          token = '';
        } else {
          token += char;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        token = '"';
      } else if (char === '{') {
        objects.push(new Set());
      } else if (char === '}') {
        objects.pop();
      }
    }
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseCapabilityDocument(raw: string): ParsedCapabilityDocument | null {
  if (Buffer.byteLength(raw, 'utf8') > MAX_CAPABILITIES_BYTES) return null;
  const parsed = parseObject(raw, MAX_CAPABILITIES_BYTES);
  if (!parsed || Object.keys(parsed).length !== 4) return null;
  if (
    parsed.version !== 1 ||
    parsed.kind !== 'hypercolor.receiver.capabilities' ||
    parsed.receiver_path !== HYPERCOLOR_RECEIVER_PATH ||
    normalizeChatKindsV(parsed[CHAT_KINDS_V_KEY]) < 1
  ) {
    return null;
  }
  return { chatKindsV: parsed[CHAT_KINDS_V_KEY] as number };
}

export function buildCapabilityDocument(): string {
  return JSON.stringify({
    version: 1,
    kind: 'hypercolor.receiver.capabilities',
    receiver_path: HYPERCOLOR_RECEIVER_PATH,
    [CHAT_KINDS_V_KEY]: CHAT_KINDS_V,
  });
}

export function parseLegacyChatKindsV(raw: string): number {
  return parseLegacyChatKindsVDetailed(raw) ?? 0;
}

export function parseLegacyChatKindsVDetailed(raw: string): number | null {
  const parsed = parseObject(raw);
  return parsed ? normalizeChatKindsV(parsed[CHAT_KINDS_V_KEY]) : null;
}
