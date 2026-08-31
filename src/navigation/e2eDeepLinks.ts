import { Clipboard, Linking } from 'react-native';
import { completeDebugSignup } from '../screens/auth/debugSignupController';
import { ContactsService } from '../services/ContactsService';
import { KeyStore } from '../services/KeyStore';
import { LinkService } from '../services/link/LinkService';
import { PaykitLinkNative } from '../services/link/PaykitLinkNative';
import { PaymentService } from '../services/payments/PaymentService';
import { useContactStore } from '../stores/contactStore';
import {
  defaultRandomBytes,
  identitySecretHex,
  parseNamedLiveProofRows,
  redactLiveProofForLog,
} from '../services/link/liveProofShared';
import { runNamedLiveProofs } from '../services/link/liveProofRun';
import { StorageService } from '../services/StorageService';
import { useAuthStore } from '../stores/authStore';
import { buildDmConversationId, threadRouteParams } from '../types/link';
import type { PubkyKey } from '../types';
import { parsePubky } from '../utils/pubkyId';
import { getE2eIdentity, saveE2eIdentity, setE2eSignupHud } from './e2eSignupResult';
import { navigateRoot, navigationRef } from './navigationRef';

const E2E_CLIPBOARD_DONE = 'HC_E2E_DONE';

let lastE2eReply = '';

function writeE2eReply(payload?: string): void {
  lastE2eReply =
    payload != null && payload.length > 0 ? `${E2E_CLIPBOARD_DONE}:${payload}` : E2E_CLIPBOARD_DONE;
  Clipboard.setString(lastE2eReply);
}

export function takeE2eClipboardReply(): string {
  const value = lastE2eReply;
  lastE2eReply = '';
  return value;
}

let lastE2ePeer: PubkyKey | null = null;

export function isE2eDeepLinkUrl(url: string): boolean {
  return url.toLowerCase().startsWith('hypercolor://e2e/');
}

/**
 * React Navigation must not consume `hypercolor://e2e/*`. On Android a VIEW
 * intent is treated as the linking initial URL; forwarding it keeps or
 * resets the Auth/Welcome stack after `setAuthenticated`.
 */
export function linkingUrlForReactNavigation(url: string | null): string | null {
  if (!url) return null;
  return isE2eDeepLinkUrl(url) ? null : url;
}

function expandPackedE2eParams(path: string, params: URLSearchParams): void {
  const packed = params.get('p');
  if (packed === null || packed.length === 0) return;
  // `|` is a shell pipe on Android `am start -d`. `~` can be dropped by
  // some VIEW parsers. `_` is safe for homeserver, invite tokens, slots,
  // and `0.001` amounts. Accept all three.
  const parts = packed.split(/[|~_]/);
  const setIfEmpty = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    if ((params.get(key) ?? '').length > 0) return;
    params.set(key, value);
  };
  if (path === 'e2e/debug-signup') {
    setIfEmpty('homeserver', parts[0]);
    setIfEmpty('token', parts[1]);
    setIfEmpty('slot', parts[2]);
    return;
  }
  if (path === 'e2e/switch') {
    setIfEmpty('slot', parts[0]);
    setIfEmpty('thenThreadSlot', parts[1]);
    return;
  }
  if (path === 'e2e/add-contact') {
    setIfEmpty('slot', parts[0]);
    setIfEmpty('body', parts[1]);
    setIfEmpty('amount', parts[2]);
  }
}

function parseE2eUrl(url: string): { path: string; params: URLSearchParams } {
  const withoutScheme = url.replace(/^hypercolor:\/\//i, '');
  const q = withoutScheme.indexOf('?');
  const path = (q === -1 ? withoutScheme : withoutScheme.slice(0, q)).replace(/\/+$/, '');
  const query = q === -1 ? '' : withoutScheme.slice(q + 1);
  const params = new URLSearchParams(query);
  expandPackedE2eParams(path, params);
  return { path, params };
}

/** Lengths only — never token, secret, or pubky values. */
export function e2eParamDigest(url: string): string {
  try {
    const { path, params } = parseE2eUrl(url);
    return [
      `path=${path}`,
      `hs=${(params.get('homeserver') ?? '').length}`,
      `token=${(params.get('token') ?? '').length}`,
      `slot=${(params.get('slot') ?? '').length}`,
    ].join(' ');
  } catch {
    return '';
  }
}

function requirePeer(params: URLSearchParams): PubkyKey {
  const peer = parsePubky((params.get('peer') ?? '').replace(/\s+/g, ''));
  if (!peer) {
    throw new Error('e2e deep link: peer must be a 52-character z-base-32 pubky');
  }
  return peer;
}

function requirePeerOrSlot(params: URLSearchParams): PubkyKey {
  const slot = (params.get('slot') ?? '').trim();
  if (slot.length === 0) return requirePeer(params);
  const saved = getE2eIdentity(slot);
  if (!saved) throw new Error(`e2e deep link: no saved identity for slot ${slot}`);
  const peer = parsePubky(saved.pubky.replace(/\s+/g, ''));
  if (!peer) throw new Error(`e2e deep link: saved slot ${slot} pubky is invalid`);
  return peer;
}

function ownerPubky(): PubkyKey | null {
  return useAuthStore.getState().pubky ?? KeyStore.getPubky();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNavigation(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (navigationRef.isReady()) return true;
    await sleep(100);
  }
  return navigationRef.isReady();
}

async function openThread(peer: PubkyKey): Promise<void> {
  lastE2ePeer = peer;
  if (!(await waitForNavigation())) {
    throw new Error('e2e deep link: navigation is not ready');
  }
  navigateRoot('Thread', threadRouteParams(peer));
}

async function addContactBestEffort(peer: PubkyKey): Promise<void> {
  const owner = ownerPubky();
  if (!owner) return;
  try {
    await Promise.race([
      ContactsService.addManualContact(owner, peer),
      sleep(5000).then(() => {
        throw new Error('e2e add-contact timed out');
      }),
    ]);
  } catch {
    // Homeserver/pkarr lookup can lag; sendDm still initiates the link.
  }
}

async function syncPeerIntoThread(peer: PubkyKey): Promise<void> {
  await addContactBestEffort(peer);
  const owner = ownerPubky();
  if (!owner) throw new Error('e2e sync: no local pubky');
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await LinkService.syncInbox();
    } catch {
      // Inbox can lag after an account switch; keep polling.
    }
    const msgs = await StorageService.getLinkMessagesForConversation(
      owner,
      buildDmConversationId(peer),
      50,
    );
    if (msgs.length > 0) {
      await openThread(peer);
      return;
    }
    const pending = await StorageService.listMessageRequests(owner, 'pending');
    if (pending.some(row => row.peerPubky === peer)) {
      await LinkService.acceptMessageRequest(peer);
      continue;
    }
    await sleep(2000);
  }
  await openThread(peer);
}

async function sendDmProductPath(peer: PubkyKey, body: string): Promise<void> {
  await addContactBestEffort(peer);
  lastE2ePeer = peer;
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const status = await LinkService.ensureLinkWith(peer);
      if (
        status === 'not-enrolled' ||
        status === 'needs-enable' ||
        status === 'native-missing' ||
        status === 'session-offline' ||
        status === 'error'
      ) {
        lastError = new Error(`ensureLinkWith=${status}`);
        await sleep(1500);
        continue;
      }
      await LinkService.sendDm(peer, body);
      return;
    } catch (err) {
      lastError = err;
      await sleep(1500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * __DEV__-only Encrypted-Link DM interop hooks.
 * Production builds compile this out of the Linking listener.
 *
 * Also installed on `globalThis.__e2eDeepLink` so the interop orchestrator can
 * invoke the same path when iOS shows an "Open in hypercolor?" sheet that
 * Maestro cannot tap (Main-tab taps are dead; system-sheet taps are also
 * outside the app process).
 */
const recentE2eUrls = new Map<string, number>();
const E2E_URL_DEBOUNCE_MS = 15_000;
let inflightE2e: { url: string; promise: Promise<boolean> } | null = null;

export async function handleE2eDeepLink(url: string): Promise<boolean> {
  if (!__DEV__) return false;
  if (!isE2eDeepLinkUrl(url)) return false;
  if (inflightE2e && inflightE2e.url === url) return inflightE2e.promise;
  const last = recentE2eUrls.get(url) ?? 0;
  if (Date.now() - last < E2E_URL_DEBOUNCE_MS) return true;
  recentE2eUrls.set(url, Date.now());
  const promise = handleE2eDeepLinkOnce(url);
  inflightE2e = { url, promise };
  try {
    return await promise;
  } finally {
    if (inflightE2e?.promise === promise) inflightE2e = null;
  }
}

async function handleE2eDeepLinkOnce(url: string): Promise<boolean> {
  try {
    const { path, params } = parseE2eUrl(url);
    if (path === 'e2e/send-dm') {
      const peer = requirePeerOrSlot(params);
      const body = (params.get('body') ?? '').trim();
      if (!body) throw new Error('e2e send-dm: body is required');
      await sendDmProductPath(peer, body);
      await openThread(peer);
      return true;
    }
    if (path === 'e2e/sync-inbox') {
      await LinkService.syncInbox();
      if (params.get('open') === '0') return true;
      const peer = parsePubky((params.get('peer') ?? '').replace(/\s+/g, '')) ?? lastE2ePeer;
      if (peer) await openThread(peer);
      return true;
    }
    if (path === 'e2e/add-contact') {
      const peer = requirePeerOrSlot(params);
      const owner = ownerPubky();
      if (!owner) throw new Error('e2e add-contact: no local pubky');
      const result = await ContactsService.addManualContact(owner, peer);
      if (!result.ok) throw new Error(result.message);
      useContactStore.getState().upsertContact(result.contact);
      lastE2ePeer = peer;
      const body = (params.get('body') ?? '').trim();
      if (body.length > 0 && body !== 'undefined' && !body.startsWith('${')) {
        await sendDmProductPath(peer, body);
      }
      const amount = (params.get('amount') ?? '').trim();
      if (amount.length > 0 && amount !== 'undefined' && !amount.startsWith('${')) {
        const reference = (params.get('reference') ?? 'maestro-p7').trim();
        await PaymentService.requestPayment(peer, { value: amount }, reference);
      }
      await openThread(peer);
      return true;
    }
    if (path === 'e2e/request-payment') {
      const peer = requirePeerOrSlot(params);
      const amount = (params.get('amount') ?? '0.001').trim();
      const reference = (params.get('reference') ?? 'maestro-p7').trim();
      await addContactBestEffort(peer);
      await PaymentService.requestPayment(peer, { value: amount }, reference);
      await openThread(peer);
      return true;
    }
    if (path === 'e2e/open-thread') {
      await openThread(requirePeerOrSlot(params));
      return true;
    }
    if (path === 'e2e/whoami') {
      const pubky = ownerPubky();
      if (!pubky) throw new Error('e2e whoami: no local pubky');
      writeE2eReply(pubky);
      return true;
    }
    if (path === 'e2e/ping') {
      writeE2eReply('pong');
      return true;
    }
    if (path === 'e2e/debug-signup') {
      const rawSecret = params.get('secret') ?? '';
      const identitySecret =
        rawSecret === '' || rawSecret === 'undefined' || rawSecret.startsWith('${')
          ? ''
          : rawSecret;
      const rawToken = params.get('token') ?? '';
      const signupToken =
        rawToken === '' || rawToken === 'undefined' || rawToken.startsWith('${') ? '' : rawToken;
      const result = await completeDebugSignup(
        {
          signupWithSecret: (secret, homeserver, token) =>
            PaykitLinkNative.signupWithSecret(secret, homeserver, token),
          signinWithSecret: secret => LinkService.signinWithSecret(secret),
          adoptHarnessSession: (alias, pubky) => LinkService.adoptHarnessSession(alias, pubky),
          provisionHarnessReceiver: () => LinkService.provisionHarnessReceiver(),
          generateSecret: () => identitySecretHex(defaultRandomBytes),
        },
        {
          homeserverPubky: params.get('homeserver') ?? '',
          signupToken,
          identitySecret,
        },
      );
      KeyStore.setHomeserver(result.homeserverPubky);
      useAuthStore.getState().setAuthenticated(result.pubky as PubkyKey, result.homeserverPubky);
      const slot = (params.get('slot') ?? '').trim();
      if (slot.length > 0) {
        saveE2eIdentity(slot, {
          pubky: result.pubky,
          secretHex: result.secretHex,
          homeserverPubky: result.homeserverPubky,
        });
      }
      setE2eSignupHud({
        pubky: result.pubky,
        secretHex: result.secretHex,
        homeserverPubky: result.homeserverPubky,
      });
      writeE2eReply(result.pubky);
      return true;
    }
    if (path === 'e2e/switch') {
      const slot = (params.get('slot') ?? '').trim();
      const saved = getE2eIdentity(slot);
      if (!saved) throw new Error(`e2e switch: no saved identity for slot ${slot || '(empty)'}`);
      const result = await completeDebugSignup(
        {
          signupWithSecret: (secret, homeserver, token) =>
            PaykitLinkNative.signupWithSecret(secret, homeserver, token),
          signinWithSecret: secret => LinkService.signinWithSecret(secret),
          adoptHarnessSession: (alias, pubky) => LinkService.adoptHarnessSession(alias, pubky),
          provisionHarnessReceiver: () => LinkService.provisionHarnessReceiver(),
          generateSecret: () => identitySecretHex(defaultRandomBytes),
        },
        {
          homeserverPubky: saved.homeserverPubky,
          signupToken: '',
          identitySecret: saved.secretHex,
        },
      );
      KeyStore.setHomeserver(result.homeserverPubky);
      useAuthStore.getState().setAuthenticated(result.pubky as PubkyKey, result.homeserverPubky);
      const thenSlot = (params.get('thenThreadSlot') ?? '').trim();
      if (thenSlot.length > 0 && thenSlot !== 'undefined' && !thenSlot.startsWith('${')) {
        await syncPeerIntoThread(requirePeerOrSlot(new URLSearchParams(`slot=${thenSlot}`)));
      }
      setE2eSignupHud({
        pubky: result.pubky,
        secretHex: result.secretHex,
        homeserverPubky: result.homeserverPubky,
      });
      writeE2eReply(result.pubky);
      return true;
    }
    if (path === 'e2e/liveproof') {
      const homeserverPubky = params.get('homeserver') ?? '';
      const signupTokenA = params.get('tokenA') ?? '';
      const signupTokenB = params.get('tokenB') ?? '';
      const signupTokenC = params.get('tokenC') ?? '';
      const rows = parseNamedLiveProofRows(params.get('rows') ?? undefined);
      const result = await runNamedLiveProofs(
        {
          homeserverPubky,
          signupTokenA,
          signupTokenB,
          ...(signupTokenC.length > 0 ? { signupTokenC } : {}),
          rows,
        },
        {
          openWalletUri: uri => Linking.openURL(uri),
          canOpenWalletUri: uri => Linking.canOpenURL(uri),
          openAuthUrl: url => Linking.openURL(url),
        },
      );
      const summary = {
        ok: result.ok,
        rows: result.rows.map(entry => ({
          row: entry.row,
          ok: entry.report.ok,
          steps: entry.report.steps.map(step => ({
            step: step.step,
            ok: step.ok,
            elapsedMs: step.elapsedMs,
            detail: step.detail,
          })),
        })),
      };
      writeE2eReply(
        redactLiveProofForLog(JSON.stringify(summary), [signupTokenA, signupTokenB, signupTokenC]),
      );
      return true;
    }
    if (path === 'e2e/last-bodies') {
      const owner = ownerPubky();
      if (!owner) throw new Error('e2e last-bodies: no local pubky');
      const peer = parsePubky(params.get('peer') ?? '') ?? lastE2ePeer;
      if (!peer) throw new Error('e2e last-bodies: peer is required');
      const msgs = await StorageService.getLinkMessagesForConversation(
        owner,
        buildDmConversationId(peer),
        50,
      );
      writeE2eReply(
        JSON.stringify({
          peer,
          bodies: msgs.map(m => m.body),
          kinds: msgs.map(m => m.kind),
        }),
      );
      return true;
    }
    throw new Error(`e2e deep link: unknown path ${path}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const digest = e2eParamDigest(url);
    const labeled = digest.length > 0 ? `${message} (${digest})` : message;
    setE2eSignupHud({
      pubky: `error:${labeled}`,
      secretHex: 'error',
      homeserverPubky: '',
      error: true,
    });
    writeE2eReply(`error:${labeled}`);
    return true;
  }
}

if (__DEV__) {
  (globalThis as unknown as { __e2eDeepLink?: typeof handleE2eDeepLink }).__e2eDeepLink =
    handleE2eDeepLink;
}
