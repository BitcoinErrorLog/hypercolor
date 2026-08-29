import {
  createClientManager,
  createServerManager,
  initiateConnection,
  acceptConnection,
  completeConnection,
  encrypt,
  decrypt,
  destroyManager,
  deriveNoiseSeed,
  deriveX25519ForDeviceEpoch,
} from '../utils/PubkyNoiseModule';
import {
  MeshTransport,
  type PeerDiscoveredEvent,
  type PeerLostEvent,
  type MessageReceivedEvent,
} from '../../modules/mesh-transport/src';
import { KeyStore } from './KeyStore';
import { StorageService } from './StorageService';
import type { MeshPeer, PubkyKey } from '../types';

/**
 * MeshService manages BLE peer sessions with end-to-end Noise Protocol encryption.
 *
 * Frame protocol (all payloads base64-encoded over BLE):
 *   Byte 0  = frame type
 *   Bytes 1+ = payload (raw binary, NOT UTF-8 text)
 *
 * Frame types:
 *   0x00  KEY_EXCHANGE  — Noise static public key (32 bytes hex, 64 chars ASCII)
 *   0x01  NOISE_INIT    — Noise handshake first message (binary ciphertext)
 *   0x02  NOISE_RESP    — Noise handshake second message (binary ciphertext)
 *   0x03  APP_MSG       — Encrypted application payload (post-handshake)
 *
 * Role determination: the peer with the lexicographically SMALLER pubkyHash
 * is the Noise client (initiates handshake). The other is the server.
 */

// ─── Frame type constants ──────────────────────────────────────────────────

const FRAME_KEY_EXCHANGE = 0x00;
const FRAME_NOISE_INIT = 0x01;
const FRAME_NOISE_RESP = 0x02;
const FRAME_APP_MSG = 0x03;

// ─── Per-peer session state ────────────────────────────────────────────────

type HandshakeState = 'idle' | 'key_sent' | 'noise_initiated' | 'established';
type PeerRole = 'client' | 'server';

interface PeerState {
  pubkyHash: string;
  pubky?: string;
  rssi: number;
  lastSeenAt: number;
  connected: boolean;
  noisePk: string | null;
  managerId: string | null;
  sessionId: string | null;
  pendingSessionId: string | null;
  role: PeerRole | null;
  handshake: HandshakeState;
}

// ─── Module state ──────────────────────────────────────────────────────────

const peerStates = new Map<string, PeerState>();

type MessageCallback = (senderPubky: PubkyKey | undefined, payloadBase64: string) => void;
const messageCallbacks: MessageCallback[] = [];

let started = false;
let localPubkyHash: string | null = null;
let localNoiseSeedHex: string | null = null;
let localNoisePkHex: string | null = null;

let discoveredSub: { remove: () => void } | null = null;
let lostSub: { remove: () => void } | null = null;
let receivedSub: { remove: () => void } | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export const MeshService = {
  /**
   * Starts BLE advertising and scanning. Uses the TransportKeypair from
   * pubky-ring handoff for Noise sessions (key separation per §4.7).
   */
  async start(localPubky: PubkyKey): Promise<void> {
    if (started) return;
    started = true;

    const transportKeypair = await KeyStore.getTransportKeypair();
    if (!transportKeypair) {
      throw new Error(
        'MeshService: no TransportKeypair in KeyStore. Authorize with pubky-ring first.',
      );
    }

    localPubkyHash = truncatedSha256Hex(localPubky);

    // Derive noise seed from the transport secret key (not the AppKey —
    // TransportKey is for Noise sessions per PUBKY_CRYPTO_SPEC §4.7)
    const noiseSeed = await deriveNoiseSeed(transportKeypair.secretKey, localPubkyHash);
    localNoiseSeedHex = noiseSeed;

    const keypair = await deriveX25519ForDeviceEpoch(noiseSeed, localPubkyHash, 0);
    localNoisePkHex = keypair.publicKey;

    discoveredSub = MeshTransport.addPeerDiscoveredListener(onPeerDiscovered);
    lostSub = MeshTransport.addPeerLostListener(onPeerLost);
    receivedSub = MeshTransport.addMessageReceivedListener(onMessageReceived);

    await MeshTransport.startAdvertising(localPubkyHash);
  },

  async stop(): Promise<void> {
    if (!started) return;
    started = false;

    discoveredSub?.remove();
    lostSub?.remove();
    receivedSub?.remove();
    discoveredSub = lostSub = receivedSub = null;

    for (const state of peerStates.values()) {
      if (state.managerId) {
        destroyManager(state.managerId).catch(() => {});
      }
    }
    peerStates.clear();

    localNoiseSeedHex = null;
    localNoisePkHex = null;
    localPubkyHash = null;

    await MeshTransport.stopAll();
  },

  isPeerNearby(pubky: PubkyKey): boolean {
    const hash = truncatedSha256Hex(pubky);
    const state = peerStates.get(hash);
    return state?.handshake === 'established' && state.connected;
  },

  /**
   * Encrypts and sends an application payload to a BLE peer.
   */
  async sendToPeer(pubky: PubkyKey, payloadBase64: string): Promise<boolean> {
    const hash = truncatedSha256Hex(pubky);
    const state = peerStates.get(hash);
    if (!state || state.handshake !== 'established' || !state.managerId || !state.sessionId) {
      return false;
    }

    try {
      const plaintextHex = Buffer.from(payloadBase64, 'base64').toString('hex');
      const { ciphertext } = await encrypt(state.managerId, state.sessionId, plaintextHex);
      const frame = buildFrame(FRAME_APP_MSG, ciphertext);
      return MeshTransport.sendToPeer(hash, frame);
    } catch (err) {
      console.warn('[MeshService] sendToPeer encrypt/send failed:', (err as Error).message);
      return false;
    }
  },

  getKnownPeers(): MeshPeer[] {
    return Array.from(peerStates.values()).map(s => ({
      pubkyHash: s.pubkyHash,
      ...(s.pubky !== undefined ? { pubky: s.pubky } : {}),
      rssi: s.rssi,
      lastSeenAt: s.lastSeenAt,
      connected: s.connected,
    }));
  },

  onMessageReceived(callback: MessageCallback): () => void {
    messageCallbacks.push(callback);
    return () => {
      const idx = messageCallbacks.indexOf(callback);
      if (idx !== -1) messageCallbacks.splice(idx, 1);
    };
  },
};

// ─── BLE event handlers ────────────────────────────────────────────────────

function onPeerDiscovered(event: PeerDiscoveredEvent): void {
  const existing = peerStates.get(event.pubkyHash);
  const state: PeerState = existing ?? {
    pubkyHash: event.pubkyHash,
    rssi: event.rssi,
    lastSeenAt: Date.now(),
    connected: true,
    noisePk: null,
    managerId: null,
    sessionId: null,
    pendingSessionId: null,
    role: null,
    handshake: 'idle',
  };

  state.rssi = event.rssi;
  state.lastSeenAt = Date.now();
  state.connected = true;
  if (event.pubky && !state.pubky) state.pubky = event.pubky;
  peerStates.set(event.pubkyHash, state);

  if (state.pubky) {
    StorageService.upsertContact({
      pubky: state.pubky,
      trustScore: 0.1,
      firstSeenAt: Date.now(),
      lastInteractionAt: Date.now(),
    }).catch(() => {});
  }

  if (state.handshake === 'idle' && localNoisePkHex) {
    state.handshake = 'key_sent';
    const frame = buildFrame(FRAME_KEY_EXCHANGE, localNoisePkHex);
    MeshTransport.sendToPeer(event.pubkyHash, frame).catch(() => {});
  }
}

function onPeerLost(event: PeerLostEvent): void {
  const state = peerStates.get(event.pubkyHash);
  if (state) {
    peerStates.set(event.pubkyHash, { ...state, connected: false, lastSeenAt: Date.now() });
  }
}

async function onMessageReceived(event: MessageReceivedEvent): Promise<void> {
  const { pubkyHash, payloadBase64 } = event;
  const state = peerStates.get(pubkyHash);
  if (!state) return;

  try {
    const { frameType, payload } = parseFrame(payloadBase64);

    switch (frameType) {
      case FRAME_KEY_EXCHANGE:
        await handleKeyExchange(state, payload);
        break;
      case FRAME_NOISE_INIT:
        await handleNoiseInit(state, payload);
        break;
      case FRAME_NOISE_RESP:
        await handleNoiseResponse(state, payload);
        break;
      case FRAME_APP_MSG:
        await handleAppMsg(state, payload);
        break;
      default:
        console.warn(
          `[MeshService] Unknown frame type 0x${frameType.toString(16)} from ${pubkyHash}`,
        );
    }
  } catch (err) {
    console.warn(`[MeshService] Error processing frame from ${pubkyHash}:`, (err as Error).message);
  }
}

// ─── Handshake handlers ────────────────────────────────────────────────────

async function handleKeyExchange(state: PeerState, peerNoisePkHex: string): Promise<void> {
  if (!localPubkyHash || !localNoiseSeedHex || !localNoisePkHex) return;

  state.noisePk = peerNoisePkHex;

  if (state.handshake === 'idle') {
    state.handshake = 'key_sent';
    const frame = buildFrame(FRAME_KEY_EXCHANGE, localNoisePkHex);
    MeshTransport.sendToPeer(state.pubkyHash, frame).catch(() => {});
  }

  const amClient = localPubkyHash < state.pubkyHash;
  state.role = amClient ? 'client' : 'server';

  if (amClient) {
    const { managerId } = await createClientManager(
      localNoiseSeedHex,
      localPubkyHash,
      localPubkyHash,
      'default',
    );
    state.managerId = managerId;

    const { sessionId: pendingId, firstMessage } = await initiateConnection(
      managerId,
      peerNoisePkHex,
      null,
    );
    state.pendingSessionId = pendingId;
    state.handshake = 'noise_initiated';

    const frame = buildFrame(FRAME_NOISE_INIT, firstMessage);
    MeshTransport.sendToPeer(state.pubkyHash, frame).catch(() => {});
  } else {
    const { managerId } = await createServerManager(
      localNoiseSeedHex,
      localPubkyHash,
      localPubkyHash,
      'default',
    );
    state.managerId = managerId;
    state.handshake = 'noise_initiated';
  }

  peerStates.set(state.pubkyHash, state);
}

async function handleNoiseInit(state: PeerState, firstMessageHex: string): Promise<void> {
  if (state.role !== 'server' || !state.managerId) return;

  const { sessionId, responseMessage } = await acceptConnection(state.managerId, firstMessageHex);
  state.sessionId = sessionId;
  state.handshake = 'established';
  peerStates.set(state.pubkyHash, state);

  const frame = buildFrame(FRAME_NOISE_RESP, responseMessage);
  MeshTransport.sendToPeer(state.pubkyHash, frame).catch(() => {});
}

async function handleNoiseResponse(state: PeerState, responseHex: string): Promise<void> {
  if (state.role !== 'client' || !state.managerId || !state.pendingSessionId) return;

  const { sessionId } = await completeConnection(
    state.managerId,
    state.pendingSessionId,
    responseHex,
  );
  state.sessionId = sessionId;
  state.pendingSessionId = null;
  state.handshake = 'established';
  peerStates.set(state.pubkyHash, state);
}

async function handleAppMsg(state: PeerState, ciphertextHex: string): Promise<void> {
  if (state.handshake !== 'established' || !state.managerId || !state.sessionId) return;

  const { plaintext: plaintextHex } = await decrypt(
    state.managerId,
    state.sessionId,
    ciphertextHex,
  );
  const payloadBase64 = Buffer.from(plaintextHex, 'hex').toString('base64');

  for (const cb of messageCallbacks) {
    try {
      cb(state.pubky as PubkyKey | undefined, payloadBase64);
    } catch (err) {
      console.warn('[MeshService] Callback error:', (err as Error).message);
    }
  }
}

// ─── Frame helpers ─────────────────────────────────────────────────────────
// Payloads are hex strings from the Noise layer. We encode them as raw binary
// bytes in the frame (not UTF-8 text of the hex string).

/**
 * Builds a BLE frame: [frameType: 1 byte] + payload bytes, base64-encoded.
 * For KEY_EXCHANGE, payload is an ASCII hex string (64 chars).
 * For NOISE_INIT/RESP/APP_MSG, payload is a hex-encoded ciphertext
 * converted to raw bytes.
 */
function buildFrame(frameType: number, payloadHex: string): string {
  if (frameType === FRAME_KEY_EXCHANGE) {
    // Key exchange payload is an ASCII hex string — encode as UTF-8
    const payloadBytes = Buffer.from(payloadHex, 'utf8');
    const frame = Buffer.alloc(1 + payloadBytes.length);
    frame.writeUInt8(frameType, 0);
    payloadBytes.copy(frame, 1);
    return frame.toString('base64');
  }
  // All other frames carry binary ciphertext — decode hex to raw bytes
  const payloadBytes = Buffer.from(payloadHex, 'hex');
  const frame = Buffer.alloc(1 + payloadBytes.length);
  frame.writeUInt8(frameType, 0);
  payloadBytes.copy(frame, 1);
  return frame.toString('base64');
}

/**
 * Parses a BLE frame from base64 into frame type + payload hex string.
 */
function parseFrame(payloadBase64: string): { frameType: number; payload: string } {
  const buf = Buffer.from(payloadBase64, 'base64');
  const frameType = buf.readUInt8(0);
  const data = buf.subarray(1);
  if (frameType === FRAME_KEY_EXCHANGE) {
    // Key exchange payload is ASCII hex — read as UTF-8
    return { frameType, payload: data.toString('utf8') };
  }
  // All other frames carry raw binary — encode to hex for the Noise layer
  return { frameType, payload: data.toString('hex') };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Produces a truncated hash of the pubky key for BLE peer identification.
 * Uses djb2 — this is for BLE advertisement routing only, not crypto.
 * The Noise handshake provides the actual authenticated key exchange.
 */
function truncatedSha256Hex(pubky: string): string {
  let h = 5381;
  for (let i = 0; i < pubky.length; i++) {
    h = ((h << 5) + h) ^ pubky.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0').repeat(4);
}
