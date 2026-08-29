import { NativeModulesProxy, EventEmitter } from 'expo-modules-core';

/**
 * MeshTransportModule — TypeScript interface to the native BLE mesh layer.
 *
 * BLE mesh is a best-effort transport. Every failure mode here must be handled
 * gracefully — if BLE is unavailable the MessageRouter falls back to Pubky
 * outbox delivery automatically.
 *
 * Fragmentation protocol:
 * Each GATT write carries a 9-byte header:
 *   [4 bytes: message_id_hash] [2 bytes: fragment_index] [2 bytes: total_fragments] [1 byte: reserved]
 * followed by the payload slice. MTU is negotiated per-connection; the
 * native layer handles reassembly and calls `onMessageReceived` only after
 * all fragments have been collected.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NativeMeshTransport = NativeModulesProxy.MeshTransport as any;

if (!NativeMeshTransport) {
  throw new Error(
    'MeshTransport native module not found. ' + 'Run `expo prebuild` and rebuild the native app.',
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PeerDiscoveredEvent {
  /** 16-byte truncated pubky hash, hex-encoded — present before handshake */
  pubkyHash: string;
  /** z-base-32 pubky key — present after capability handshake */
  pubky?: string;
  /** Received signal strength indicator in dBm */
  rssi: number;
}

export interface PeerLostEvent {
  pubkyHash: string;
}

export interface MessageReceivedEvent {
  /** Hash of the sending peer */
  pubkyHash: string;
  /** z-base-32 pubky of the sender (resolved after handshake) */
  senderPubky?: string;
  /** Raw message payload bytes, base64-encoded */
  payloadBase64: string;
}

// ─── GATT service / characteristic UUIDs ─────────────────────────────────────
// These are fixed Hypercolor UUIDs. Both platforms must agree on the same UUIDs.
export const MESH_SERVICE_UUID = '6BA7B810-9DAD-11D1-80B4-00C04FD430C8';
export const MESH_WRITE_CHARACTERISTIC_UUID = '6BA7B811-9DAD-11D1-80B4-00C04FD430C8';
export const MESH_NOTIFY_CHARACTERISTIC_UUID = '6BA7B812-9DAD-11D1-80B4-00C04FD430C8';

// ─── Module ──────────────────────────────────────────────────────────────────

const emitter = new EventEmitter(NativeMeshTransport);

export const MeshTransport = {
  /**
   * Starts BLE advertising (peripheral mode) with the local pubky hash in the
   * service data. Also starts scanning for peers advertising the same service
   * UUID. Both operations run concurrently.
   *
   * `pubkyHashHex` — 16-byte truncated hash of the local pubky, hex-encoded.
   */
  startAdvertising(pubkyHashHex: string): Promise<void> {
    return NativeMeshTransport.startAdvertising(pubkyHashHex);
  },

  /**
   * Starts BLE scanning only (no advertising). Used when the user wants to
   * discover peers without announcing their presence.
   */
  startScanning(): Promise<void> {
    return NativeMeshTransport.startScanning();
  },

  /**
   * Stops all BLE advertising and scanning. Existing GATT connections are
   * preserved until the OS drops them.
   */
  stopAll(): Promise<void> {
    return NativeMeshTransport.stopAll();
  },

  /**
   * Sends a message payload to a peer identified by their pubky hash.
   * The native layer fragments the payload across GATT writes if it exceeds
   * the negotiated MTU.
   *
   * Returns true if the write was queued successfully; false if the peer is
   * not currently connected (caller should fall back to Pubky delivery).
   */
  sendToPeer(pubkyHashHex: string, payloadBase64: string): Promise<boolean> {
    return NativeMeshTransport.sendToPeer(pubkyHashHex, payloadBase64);
  },

  /**
   * Returns the list of currently connected peer pubky hashes.
   */
  getConnectedPeers(): Promise<string[]> {
    return NativeMeshTransport.getConnectedPeers();
  },

  /**
   * Fired when a new peer is discovered via BLE scan.
   */
  addPeerDiscoveredListener(callback: (event: PeerDiscoveredEvent) => void): {
    remove: () => void;
  } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (emitter as any).addListener('onPeerDiscovered', callback) as { remove: () => void };
  },

  /**
   * Fired when a previously discovered peer is no longer visible.
   */
  addPeerLostListener(callback: (event: PeerLostEvent) => void): { remove: () => void } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (emitter as any).addListener('onPeerLost', callback) as { remove: () => void };
  },

  /**
   * Fired when a complete, reassembled message is received from a BLE peer.
   */
  addMessageReceivedListener(callback: (event: MessageReceivedEvent) => void): {
    remove: () => void;
  } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (emitter as any).addListener('onMessageReceived', callback) as { remove: () => void };
  },
};
