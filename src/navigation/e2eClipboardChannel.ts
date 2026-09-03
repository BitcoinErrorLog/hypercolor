import { Clipboard } from 'react-native';
import { handleE2eDeepLink, takeE2eClipboardReply } from './e2eDeepLinks';

export const E2E_CLIPBOARD_SENTINEL = 'HC_E2E:';
export const E2E_CLIPBOARD_DONE = 'HC_E2E_DONE';
export const E2E_CLIPBOARD_TEST_ID = 'e2eClipboardChannel';
export const E2E_CMD_FILE = 'hc_e2e_cmd.txt';

const POLL_MS = 750;

type ExpoFileSystemLegacy = {
  documentDirectory: string | null;
  EncodingType: { UTF8: string };
  getInfoAsync: (uri: string) => Promise<{ exists: boolean }>;
  readAsStringAsync: (uri: string, options: { encoding: string }) => Promise<string>;
  writeAsStringAsync: (
    uri: string,
    contents: string,
    options: { encoding: string },
  ) => Promise<void>;
};

let started = false;
let busy = false;
let timer: ReturnType<typeof setInterval> | null = null;
let fs: ExpoFileSystemLegacy | null | undefined;

function fileSystem(): ExpoFileSystemLegacy | null {
  if (fs !== undefined) return fs;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs = require('expo-file-system/legacy') as ExpoFileSystemLegacy;
  } catch {
    fs = null;
  }
  return fs;
}

function cmdUri(): string | null {
  const dir = fileSystem()?.documentDirectory;
  return dir ? `${dir}${E2E_CMD_FILE}` : null;
}

function commandUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text.startsWith(E2E_CLIPBOARD_SENTINEL)) return null;
  const url = text.slice(E2E_CLIPBOARD_SENTINEL.length).trim();
  if (!url.toLowerCase().startsWith('hypercolor://e2e/')) return null;
  return url;
}

async function readHostCommand(): Promise<string> {
  // File first. iOS 18 Clipboard.getString of a simctl pbcopy hangs the JS
  // thread (paste privacy) and never reaches the file sidecar.
  const api = fileSystem();
  const uri = cmdUri();
  if (api && uri) {
    try {
      const info = await api.getInfoAsync(uri);
      if (info.exists) {
        const text = await api.readAsStringAsync(uri, { encoding: api.EncodingType.UTF8 });
        if (commandUrl(text)) return text;
      }
    } catch {
      // Host still writes simctl pbcopy; file is the reliable inbound.
    }
  }
  return '';
}

function isVrtBuild(): boolean {
  return process.env.E2E_VRT === '1' || process.env.EXPO_PUBLIC_E2E_VRT === '1';
}

async function writeDone(reply: string): Promise<void> {
  // Android 13+ shows a system clipboard toast on setString — that bubble is
  // harness chrome and must never appear in VRT captures.
  if (!isVrtBuild()) {
    Clipboard.setString(reply);
  }
  const api = fileSystem();
  const uri = cmdUri();
  if (!api || !uri) return;
  try {
    await api.writeAsStringAsync(uri, reply, { encoding: api.EncodingType.UTF8 });
  } catch {
    // Host still has simctl pbpaste for replies the handler wrote.
  }
}

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const raw = await readHostCommand();
    const url = commandUrl(raw);
    if (!url) return;
    if (__DEV__) {
      console.log('[e2e-clipboard] command', url.split('?')[0] ?? url);
    }
    await handleE2eDeepLink(url);
    await writeDone(takeE2eClipboardReply() || E2E_CLIPBOARD_DONE);
  } finally {
    busy = false;
  }
}

/** __DEV__-only host command channel. Safe to call more than once. */
export function startE2eClipboardChannel(): void {
  if (!__DEV__ || started) return;
  started = true;
  void (async () => {
    const pending = await readHostCommand();
    // Fast Refresh / remount must not wipe an inbound command or a liveproof reply.
    // In VRT mode skip the channel-up handshake entirely — file writes only,
    // no clipboard toast, and do not overwrite a pending HC_E2E command.
    if (!commandUrl(pending)) {
      const raw = pending.trim();
      const keepReply =
        raw.startsWith(E2E_CLIPBOARD_DONE) && !raw.startsWith(`${E2E_CLIPBOARD_DONE}:channel-up`);
      if (!keepReply && !isVrtBuild()) {
        await writeDone(`${E2E_CLIPBOARD_DONE}:channel-up`);
      }
    }
    await tick();
  })();
  timer = setInterval(() => {
    void tick();
  }, POLL_MS);
}

export function stopE2eClipboardChannelForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  busy = false;
}
