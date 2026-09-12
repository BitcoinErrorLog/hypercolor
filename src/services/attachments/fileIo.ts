/**
 * File helpers for attachment plaintext. The native AEAD speaks base64url
 * (no padding); expo-file-system legacy reads/writes standard base64.
 *
 * Loaded via `require` so `tsc` (exactOptionalPropertyTypes) does not
 * typecheck expo-file-system's own .ts sources in node_modules.
 */
type ExpoFileSystemLegacy = {
  cacheDirectory: string | null;
  documentDirectory: string | null;
  EncodingType: { Base64: string; UTF8: string };
  getInfoAsync: (uri: string) => Promise<{
    exists: boolean;
    isDirectory?: boolean;
    size?: number;
    modificationTime?: number;
  }>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
  readAsStringAsync: (uri: string, options: { encoding: string }) => Promise<string>;
  writeAsStringAsync: (
    uri: string,
    contents: string,
    options: { encoding: string },
  ) => Promise<void>;
  makeDirectoryAsync: (uri: string, options?: { intermediates?: boolean }) => Promise<void>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSystem = require('expo-file-system/legacy') as ExpoFileSystemLegacy;

export function toBase64Url(standardB64: string): string {
  return standardB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(urlB64: string): string {
  const std = urlB64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  return std + pad;
}

export function decodedBase64Bytes(standardOrUrlB64: string): number {
  const std = fromBase64Url(
    standardOrUrlB64.includes('+') || standardOrUrlB64.includes('/')
      ? toBase64Url(standardOrUrlB64)
      : standardOrUrlB64,
  );
  const pad = (std.match(/=+$/) ?? [''])[0].length;
  return Math.floor((std.length * 3) / 4) - pad;
}

export async function readFileAsStandardBase64(
  uri: string,
): Promise<{ base64: string; size: number }> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) {
    throw new Error(`attachment file not found: ${uri}`);
  }
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  // Size from the actual decoded bytes, never filesystem metadata (sparse
  // files / host reports can disagree with the bytes we encrypt).
  const size = decodedBase64Bytes(base64);
  return { base64, size };
}

export async function writeFileFromStandardBase64(
  path: string,
  standardB64: string,
): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir.length > 0) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  await FileSystem.writeAsStringAsync(path, standardB64, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export function appCacheDirectory(): string {
  const root = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!root) {
    throw new Error('no app cache directory');
  }
  return root.endsWith('/') ? root : `${root}/`;
}

export function gifStagingDirectory(): string {
  const root = appCacheDirectory();
  return `${root}hypercolor-gif`;
}

export function gifStagingPath(uniqueName: string): string {
  return `${gifStagingDirectory()}/${uniqueName}`;
}

export const GIF_STAGING_MAX_AGE_MS = 60 * 60 * 1000;

export async function sweepStaleGifStaging(
  nowMs: number = Date.now(),
  maxAgeMs: number = GIF_STAGING_MAX_AGE_MS,
): Promise<void> {
  let dir: string;
  try {
    dir = gifStagingDirectory();
  } catch {
    return;
  }
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists || info.isDirectory !== true) return;
    const names = await FileSystem.readDirectoryAsync(dir);
    const stale: string[] = [];
    const cutoffMs = nowMs - maxAgeMs;
    for (const name of names) {
      if (!name) continue;
      const path = `${dir}/${name}`;
      const file = await FileSystem.getInfoAsync(path);
      if (!file.exists || file.isDirectory === true) continue;
      const modifiedMs =
        typeof file.modificationTime === 'number' && Number.isFinite(file.modificationTime)
          ? file.modificationTime * 1000
          : 0;
      if (modifiedMs <= cutoffMs) stale.push(path);
    }
    await deleteCacheFiles(stale);
  } catch {
    // Best-effort boot/send sweep.
  }
}

export function attachmentCacheDirectory(ownerPubky: string): string {
  return `${appCacheDirectory()}hypercolor-attachments/${ownerPubky}/`;
}

export function attachmentCachePath(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): string {
  return `${attachmentCacheDirectory(ownerPubky)}${senderPubky}/${eventId}`;
}

export function attachmentThumbCachePath(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): string {
  return `${attachmentCachePath(ownerPubky, senderPubky, eventId)}.thumb`;
}

export function cachePathsForAttachment(row: {
  ownerPubky: string;
  senderPubky: string;
  eventId: string;
  localCachePath: string | null;
}): string[] {
  const primary = attachmentCachePath(row.ownerPubky, row.senderPubky, row.eventId);
  const paths = new Set<string>([primary, `${primary}.thumb`]);
  if (row.localCachePath) {
    paths.add(row.localCachePath);
    if (!row.localCachePath.endsWith('.thumb')) {
      paths.add(`${row.localCachePath}.thumb`);
    }
  }
  return [...paths];
}

export async function cacheFileExists(path: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(path);
  return info.exists === true && info.isDirectory !== true;
}

export async function deleteCacheFiles(
  paths: readonly (string | null | undefined)[],
): Promise<void> {
  for (const path of paths) {
    if (!path) continue;
    await FileSystem.deleteAsync(path, { idempotent: true });
  }
}
