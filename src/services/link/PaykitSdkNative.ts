import { NativeModules } from 'react-native';
import {
  createLinkNativeError,
  toLinkNativeError,
  type LinkNativeErrorCode,
} from './PaykitLinkNative';

/**
 * JS seam for the Paykit SDK link runtime.
 *
 * Handshake role, restore, and recovery belong to `ensureLinkWithPeer` and
 * `observeEncryptedLinkRecoveryMarker`. This module does not expose
 * initiate, accept, advance, or clear-outbox.
 */

export const SDK_LINK_STATES = [
  'NOT_LINKED',
  'LINKING',
  'LINKED',
  'RECOVERY_REQUIRED',
  'BLOCKED',
  'UNKNOWN',
] as const;

export type SdkLinkState = (typeof SDK_LINK_STATES)[number];
export type SdkLinkRole = 'INITIATOR' | 'RESPONDER' | 'UNKNOWN';

export type SdkOperationCode = LinkNativeErrorCode | 'recovery_required';

export class SdkOperationError extends Error {
  readonly code: SdkOperationCode;

  constructor(code: SdkOperationCode, message: string) {
    super(message);
    this.name = 'SdkOperationError';
    this.code = code;
  }
}

export function isSdkOperationError(err: unknown): err is SdkOperationError {
  return err instanceof SdkOperationError;
}

export interface SdkEnsureResult {
  counterparty: string;
  path: string;
  state?: SdkLinkState;
  generation?: string;
  role?: SdkLinkRole;
  leaseSkipped: boolean;
}

export interface SdkMarkerObservation {
  state: SdkLinkState;
  remoteMarkerChanged: boolean;
  localAttemptId?: string | null;
  remoteAttemptId?: string | null;
}

export interface SdkEnqueueResult {
  queueId: string;
}

export interface SdkOutboundFailure {
  queueId: string;
  category: string;
}

export interface SdkProcessResult {
  sent: string[];
  failed: SdkOutboundFailure[];
}

export interface SdkReceiveResult {
  receiveBatchId: string;
  streamItemIds: string[];
}

export interface SdkStreamItem {
  streamItemId: string;
  counterparty: string;
  path: string;
  kind: string;
  rawJson: string;
  eventId: string;
}

export interface PaykitSdkNativeApi {
  isAvailable(): boolean;
  bindOwner(input: {
    ownerPubky: string;
    sessionAlias: string;
    receiverAlias: string;
    receiverPath: string;
  }): Promise<void>;
  ensureLinkWithPeer(
    ownerPubky: string,
    peerPubky: string,
    receiverPath: string,
  ): Promise<SdkEnsureResult>;
  observeEncryptedLinkRecoveryMarker(
    ownerPubky: string,
    peerPubky: string,
    receiverPath: string,
  ): Promise<SdkMarkerObservation>;
  enqueueOpaquePrivateApplicationMessageJson(
    ownerPubky: string,
    peerPubky: string,
    receiverPath: string,
    rawJson: string,
  ): Promise<SdkEnqueueResult>;
  processOutboundPrivateMessages(
    ownerPubky: string,
    peerPubky: string,
    receiverPath: string,
  ): Promise<SdkProcessResult>;
  receivePrivateMessages(
    ownerPubky: string,
    peerPubky: string,
    receiverPath: string,
  ): Promise<SdkReceiveResult>;
  privateStreamItems(ownerPubky: string, streamItemIds: string[]): Promise<SdkStreamItem[]>;
  deleteOwnerState(ownerPubky: string): Promise<void>;
}

const { PaykitSdkModule } = NativeModules;

function requireModule(): Record<string, (...args: unknown[]) => Promise<unknown>> {
  if (PaykitSdkModule == null) {
    throw new SdkOperationError('unavailable', 'PaykitSdkModule native module is not available');
  }
  return PaykitSdkModule as Record<string, (...args: unknown[]) => Promise<unknown>>;
}

function asState(value: unknown): SdkLinkState {
  if (typeof value === 'string' && (SDK_LINK_STATES as readonly string[]).includes(value)) {
    return value as SdkLinkState;
  }
  return 'UNKNOWN';
}

function asRole(value: unknown): SdkLinkRole {
  if (value === 'INITIATOR' || value === 'RESPONDER' || value === 'UNKNOWN') return value;
  return 'UNKNOWN';
}

async function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
  const mod = requireModule();
  const fn = mod[method];
  if (typeof fn !== 'function') {
    throw new SdkOperationError('unavailable', `PaykitSdkModule.${method} is not available`);
  }
  try {
    return (await fn(...args)) as T;
  } catch (err) {
    throw toSdkOperationError(err);
  }
}

export function toSdkOperationError(err: unknown): SdkOperationError {
  if (isSdkOperationError(err)) return err;
  const rec = err as { code?: unknown; message?: unknown };
  if (rec?.code === 'recovery_required') {
    return new SdkOperationError('recovery_required', 'recovery required');
  }
  const mapped = toLinkNativeError(err);
  return new SdkOperationError(mapped.code, mapped.message);
}

function readEnsure(raw: unknown): SdkEnsureResult {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const result: SdkEnsureResult = {
    counterparty: typeof rec.counterparty === 'string' ? rec.counterparty : '',
    path: typeof rec.path === 'string' ? rec.path : '',
    leaseSkipped: rec.leaseSkipped === true,
  };
  if (rec.state != null) result.state = asState(rec.state);
  if (typeof rec.generation === 'string') result.generation = rec.generation;
  if (rec.role != null) result.role = asRole(rec.role);
  return result;
}

export const PaykitSdkNative: PaykitSdkNativeApi = {
  isAvailable(): boolean {
    return PaykitSdkModule != null;
  },

  bindOwner(input): Promise<void> {
    return invoke(
      'bindOwner',
      input.ownerPubky,
      input.sessionAlias,
      input.receiverAlias,
      input.receiverPath,
    );
  },

  async ensureLinkWithPeer(ownerPubky, peerPubky, receiverPath): Promise<SdkEnsureResult> {
    return readEnsure(await invoke('ensureLinkWithPeer', ownerPubky, peerPubky, receiverPath));
  },

  async observeEncryptedLinkRecoveryMarker(
    ownerPubky,
    peerPubky,
    receiverPath,
  ): Promise<SdkMarkerObservation> {
    const raw = await invoke<Record<string, unknown>>(
      'observeEncryptedLinkRecoveryMarker',
      ownerPubky,
      peerPubky,
      receiverPath,
    );
    return {
      state: asState(raw.state),
      remoteMarkerChanged: raw.remoteMarkerChanged === true,
      localAttemptId: typeof raw.localAttemptId === 'string' ? raw.localAttemptId : null,
      remoteAttemptId: typeof raw.remoteAttemptId === 'string' ? raw.remoteAttemptId : null,
    };
  },

  enqueueOpaquePrivateApplicationMessageJson(
    ownerPubky,
    peerPubky,
    receiverPath,
    rawJson,
  ): Promise<SdkEnqueueResult> {
    return invoke(
      'enqueueOpaquePrivateApplicationMessageJson',
      ownerPubky,
      peerPubky,
      receiverPath,
      rawJson,
    );
  },

  processOutboundPrivateMessages(ownerPubky, peerPubky, receiverPath): Promise<SdkProcessResult> {
    return invoke('processOutboundPrivateMessages', ownerPubky, peerPubky, receiverPath);
  },

  receivePrivateMessages(ownerPubky, peerPubky, receiverPath): Promise<SdkReceiveResult> {
    return invoke('receivePrivateMessages', ownerPubky, peerPubky, receiverPath);
  },

  privateStreamItems(ownerPubky, streamItemIds): Promise<SdkStreamItem[]> {
    return invoke('privateStreamItems', ownerPubky, streamItemIds);
  },

  deleteOwnerState(ownerPubky): Promise<void> {
    return invoke('deleteOwnerState', ownerPubky);
  },
};

export function unavailableSdk(method: string): SdkOperationError {
  return new SdkOperationError('unavailable', createLinkNativeError('unavailable', method).message);
}
