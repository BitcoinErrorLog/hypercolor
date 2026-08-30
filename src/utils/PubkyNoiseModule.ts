/**
 * PubkyNoiseModule — TypeScript wrapper over the native pubky-noise FFI.
 *
 * Product scope (v1): Ring-auth interop only. `PubkyRingAuthService` uses
 * sealed-blob encrypt/decrypt for the Ring callback handoff. Do not use
 * this module for DM/channel envelopes — those go through Paykit Encrypted
 * Links (`PaykitLinkNative`). Mesh Noise sessions remain in `MeshService`
 * (quarantined, flag off). Native ios/android sources are not modified here.
 */

import { NativeModules } from 'react-native';

const { PubkyNoiseModule: NativePubkyNoiseModule } = NativeModules;

// ============================================================================
// Types - Key Derivation
// ============================================================================

export interface KeypairResult {
  secretKey: string;
  publicKey: string;
}

// ============================================================================
// Types - Noise Manager
// ============================================================================

export interface NoiseManagerResult {
  managerId: string;
}

export interface InitiateConnectionResult {
  sessionId: string;
  firstMessage: string;
}

export interface AcceptConnectionResult {
  sessionId: string;
  responseMessage: string;
}

export interface CompleteConnectionResult {
  sessionId: string;
}

export interface EncryptResult {
  ciphertext: string;
}

export interface DecryptResult {
  plaintext: string;
}

export interface SessionStateResult {
  sessionId: string;
  peerStaticPk: string;
  writeCounter: number;
  readCounter: number;
  status: 'connected' | 'reconnecting' | 'disconnected' | 'error';
}

export interface X25519KeypairResult {
  secretKey: string;
  publicKey: string;
}

export type NoiseConfigType = 'default' | 'batterySaver' | 'performance';
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected' | 'error';

// ============================================================================
// Types - Unified Key Delegation (UKD)
// ============================================================================

export interface AppKeypairResult {
  secretKey: string;
  publicKey: string;
}

export interface AppCertResult {
  certBodyHex: string;
  sigHex: string;
  certIdHex: string;
}

// ============================================================================
// Types - SB2 Binary Wire Format (PUBKY_CRYPTO_SPEC v2.5 Section 7.2)
// ============================================================================

export interface Sb2Header {
  contextIdHex: string;
  createdAt: number | null;
  expiresAt: number | null;
  inboxKidHex: string;
  msgId: string | null;
  nonceHex: string;
  purpose: string | null;
  recipientPeeridHex: string;
  senderEphemeralPubHex: string;
  senderPeeridHex: string;
  sigHex: string | null;
  certIdHex: string | null;
}

export interface Sb2DecryptResult {
  header: Sb2Header;
  plaintext: string; // hex-encoded
}

// ============================================================================
// Availability Check
// ============================================================================

/**
 * Check if the native module is available
 */
export const isNativeModuleAvailable = (): boolean => {
  return NativePubkyNoiseModule != null;
};

// ============================================================================
// Key Derivation Functions
// ============================================================================

/**
 * Derive X25519 keypair from seed, device ID, and epoch
 * Uses pubky-noise HKDF-SHA512 key derivation
 *
 * @param seedHex - 32-byte seed as hex string (Ed25519 secret key)
 * @param deviceIdHex - Device ID as hex string
 * @param epoch - Epoch number for key rotation
 * @returns Promise resolving to keypair with secretKey and publicKey as hex strings
 */
export const deriveX25519ForDeviceEpoch = async (
  seedHex: string,
  deviceIdHex: string,
  epoch: number,
): Promise<KeypairResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.deriveX25519ForDeviceEpoch(seedHex, deviceIdHex, epoch);
};

/**
 * Get the X25519 public key from a secret key
 *
 * @param secretKeyHex - 32-byte secret key as hex string
 * @returns Promise resolving to public key as hex string
 */
export const getPublicKey = async (secretKeyHex: string): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.getPublicKey(secretKeyHex);
};

// ============================================================================
// Noise Manager - Lifecycle
// ============================================================================

/**
 * Create a client Noise Protocol manager
 *
 * @param clientSeedHex - 32-byte client seed as hex string
 * @param clientKid - Client key ID string
 * @param deviceIdHex - Device ID as hex string
 * @param configType - Config type: "default", "batterySaver", or "performance"
 * @returns Promise resolving to manager info with managerId
 */
export const createClientManager = async (
  clientSeedHex: string,
  clientKid: string,
  deviceIdHex: string,
  configType: NoiseConfigType = 'default',
): Promise<NoiseManagerResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.createClientManager(
    clientSeedHex,
    clientKid,
    deviceIdHex,
    configType,
  );
};

/**
 * Create a server Noise Protocol manager
 *
 * @param serverSeedHex - 32-byte server seed as hex string
 * @param serverKid - Server key ID string
 * @param deviceIdHex - Device ID as hex string
 * @param configType - Config type: "default", "batterySaver", or "performance"
 * @returns Promise resolving to manager info with managerId
 */
export const createServerManager = async (
  serverSeedHex: string,
  serverKid: string,
  deviceIdHex: string,
  configType: NoiseConfigType = 'default',
): Promise<NoiseManagerResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.createServerManager(
    serverSeedHex,
    serverKid,
    deviceIdHex,
    configType,
  );
};

/**
 * Destroy a Noise Protocol manager and free resources
 *
 * @param managerId - The manager ID from createClientManager/createServerManager
 * @returns Promise resolving to true on success
 */
export const destroyManager = async (managerId: string): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.destroyManager(managerId);
};

// ============================================================================
// Noise Manager - Connection Handshake
// ============================================================================

/**
 * Initiate a connection (client-side, step 1 of handshake)
 *
 * @param managerId - The manager ID
 * @param serverPkHex - Server public key as hex string
 * @param hint - Optional hint string
 * @returns Promise resolving to session ID and first message
 */
export const initiateConnection = async (
  managerId: string,
  serverPkHex: string,
  hint?: string | null,
): Promise<InitiateConnectionResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.initiateConnection(managerId, serverPkHex, hint);
};

/**
 * Accept a connection (server-side)
 *
 * @param managerId - The manager ID
 * @param firstMessageHex - First handshake message as hex string
 * @returns Promise resolving to session ID and response message
 */
export const acceptConnection = async (
  managerId: string,
  firstMessageHex: string,
): Promise<AcceptConnectionResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.acceptConnection(managerId, firstMessageHex);
};

/**
 * Complete a connection (client-side, step 2 of handshake)
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID from initiateConnection
 * @param serverResponseHex - Server response message as hex string
 * @returns Promise resolving to final session ID
 */
export const completeConnection = async (
  managerId: string,
  sessionId: string,
  serverResponseHex: string,
): Promise<CompleteConnectionResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.completeConnection(managerId, sessionId, serverResponseHex);
};

// ============================================================================
// Noise Manager - Encryption/Decryption
// ============================================================================

/**
 * Encrypt data for a session
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @param plaintextHex - Plaintext as hex string
 * @returns Promise resolving to ciphertext as hex string
 */
export const encrypt = async (
  managerId: string,
  sessionId: string,
  plaintextHex: string,
): Promise<EncryptResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.encrypt(managerId, sessionId, plaintextHex);
};

/**
 * Decrypt data for a session
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @param ciphertextHex - Ciphertext as hex string
 * @returns Promise resolving to plaintext as hex string
 */
export const decrypt = async (
  managerId: string,
  sessionId: string,
  ciphertextHex: string,
): Promise<DecryptResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.decrypt(managerId, sessionId, ciphertextHex);
};

// ============================================================================
// Noise Manager - Session Management
// ============================================================================

/**
 * List all active session IDs
 *
 * @param managerId - The manager ID
 * @returns Promise resolving to array of session IDs
 */
export const listSessions = async (managerId: string): Promise<string[]> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  const result = await NativePubkyNoiseModule.listSessions(managerId);
  return result.sessions;
};

/**
 * Get session status
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @returns Promise resolving to status string or null if session not found
 */
export const getSessionStatus = async (
  managerId: string,
  sessionId: string,
): Promise<ConnectionStatus | null> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  const result = await NativePubkyNoiseModule.getSessionStatus(managerId, sessionId);
  return result.status ?? null;
};

/**
 * Remove a session
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID to remove
 * @returns Promise resolving to true on success
 */
export const removeSession = async (managerId: string, sessionId: string): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.removeSession(managerId, sessionId);
};

/**
 * Save session state for persistence
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @returns Promise resolving to session state for persistence
 */
export const saveSessionState = async (
  managerId: string,
  sessionId: string,
): Promise<SessionStateResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.saveSessionState(managerId, sessionId);
};

/**
 * Restore session state from persistence
 *
 * @param managerId - The manager ID
 * @param sessionId - Session ID
 * @param peerStaticPkHex - Peer's static public key as hex string
 * @param writeCounter - Write counter value
 * @param readCounter - Read counter value
 * @param status - Connection status
 * @returns Promise resolving to true on success
 */
export const restoreSessionState = async (
  managerId: string,
  sessionId: string,
  peerStaticPkHex: string,
  writeCounter: number,
  readCounter: number,
  status: ConnectionStatus,
): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.restoreSessionState(
    managerId,
    sessionId,
    peerStaticPkHex,
    writeCounter,
    readCounter,
    status,
  );
};

// ============================================================================
// Sealed Blob Functions (v1/v2 auto-detected on decrypt)
// ============================================================================

/**
 * Generate a new X25519 keypair for sealed blob encryption
 *
 * @returns Promise resolving to keypair with secretKey and publicKey as hex strings
 */
export const x25519GenerateKeypair = async (): Promise<X25519KeypairResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.x25519GenerateKeypair();
};

/**
 * Derive X25519 public key from a secret key
 *
 * @param secretKeyHex - 32-byte secret key as hex string
 * @returns Promise resolving to public key as hex string
 */
export const x25519PublicFromSecret = async (secretKeyHex: string): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.x25519PublicFromSecret(secretKeyHex);
};

/**
 * Derive noise seed from Ed25519 secret key using HKDF-SHA256
 *
 * This is used to derive future X25519 epoch keys locally without
 * needing to call Ring again. The seed is domain-separated and
 * cannot be used for signing.
 *
 * HKDF parameters:
 * - salt: "paykit-noise-seed-v1"
 * - ikm: Ed25519 secret key (32 bytes)
 * - info: device ID
 * - output: 32 bytes
 *
 * @param ed25519SecretHex - Ed25519 secret key as hex string (64 chars)
 * @param deviceIdHex - Device ID as hex string
 * @returns Promise resolving to 32-byte noise seed as hex string (64 chars)
 */
export const deriveNoiseSeed = async (
  ed25519SecretHex: string,
  deviceIdHex: string,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.deriveNoiseSeed(ed25519SecretHex, deviceIdHex);
};

/**
 * Encrypt plaintext using Paykit Sealed Blob v2 format (XChaCha20-Poly1305)
 *
 * @param recipientPkHex - Recipient's X25519 public key as hex string (32 bytes)
 * @param plaintextHex - Plaintext to encrypt as hex string
 * @param aad - Associated authenticated data (owner-bound format for v2)
 * @param purpose - Optional purpose hint ("handoff", "request", "proposal")
 * @returns Promise resolving to JSON-encoded sealed blob envelope (v=2)
 */
export const sealedBlobEncrypt = async (
  recipientPkHex: string,
  plaintextHex: string,
  aad: string,
  purpose?: string | null,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sealedBlobEncrypt(recipientPkHex, plaintextHex, aad, purpose);
};

/**
 * Decrypt a Paykit Sealed Blob envelope (v1 or v2 auto-detected)
 *
 * @param recipientSkHex - Recipient's X25519 secret key as hex string (32 bytes)
 * @param envelopeJson - JSON-encoded sealed blob envelope
 * @param aad - Associated authenticated data (must match encryption)
 * @returns Promise resolving to decrypted plaintext as hex string
 */
export const sealedBlobDecrypt = async (
  recipientSkHex: string,
  envelopeJson: string,
  aad: string,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sealedBlobDecrypt(recipientSkHex, envelopeJson, aad);
};

/**
 * Check if a JSON string looks like a sealed blob envelope
 *
 * @param json - JSON string to check
 * @returns Promise resolving to boolean indicating if it's a sealed blob
 */
export const isSealedBlob = async (json: string): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.isSealedBlob(json);
};

// ============================================================================
// Sealed Blob v2 with Spec-Compliant AAD (PUBKY_CRYPTO_SPEC Section 7.5)
// ============================================================================

/**
 * Encrypt using Sealed Blob v2 with spec-compliant AAD construction.
 *
 * This function computes AAD internally per PUBKY_CRYPTO_SPEC Section 7.5:
 * aad = "pubky-envelope/v2:" || owner_peerid_bytes || canonical_path_bytes || header_bytes
 *
 * Use this instead of sealedBlobEncrypt for new code to ensure spec compliance.
 *
 * @param recipientPkHex - Recipient's X25519 public key as hex string (32 bytes)
 * @param plaintextHex - Plaintext to encrypt as hex string
 * @param ownerPeeridHex - Storage owner's Ed25519 public key as hex string (32 bytes)
 * @param canonicalPath - Canonical storage path (e.g., "/pub/paykit.app/v0/handoff/{id}")
 * @param purpose - Optional purpose hint ("handoff", "request", "proposal")
 * @returns Promise resolving to JSON-encoded sealed blob v2 envelope
 */
export const sealedBlobEncryptWithContext = async (
  recipientPkHex: string,
  plaintextHex: string,
  ownerPeeridHex: string,
  canonicalPath: string,
  purpose?: string | null,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sealedBlobEncryptWithContext(
    recipientPkHex,
    plaintextHex,
    ownerPeeridHex,
    canonicalPath,
    purpose,
  );
};

/**
 * Decrypt Sealed Blob v2 with spec-compliant AAD construction.
 *
 * This function computes AAD internally per PUBKY_CRYPTO_SPEC Section 7.5.
 *
 * @param recipientSkHex - Recipient's X25519 secret key as hex string (32 bytes)
 * @param envelopeJson - JSON-encoded sealed blob v2 envelope
 * @param ownerPeeridHex - Storage owner's Ed25519 public key as hex string (32 bytes)
 * @param canonicalPath - Canonical storage path (must match encryption)
 * @returns Promise resolving to decrypted plaintext as hex string
 */
export const sealedBlobDecryptWithContext = async (
  recipientSkHex: string,
  envelopeJson: string,
  ownerPeeridHex: string,
  canonicalPath: string,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sealedBlobDecryptWithContext(
    recipientSkHex,
    envelopeJson,
    ownerPeeridHex,
    canonicalPath,
  );
};

// ============================================================================
// Ed25519 Key Derivation
// ============================================================================

/**
 * Derive Ed25519 public key from secret key.
 *
 * Useful for obtaining the owner peerid (Ed25519 public key) needed
 * for spec-compliant AAD construction.
 *
 * @param ed25519SecretHex - Ed25519 secret key as hex string (64 chars / 32 bytes)
 * @returns Promise resolving to Ed25519 public key as hex string (64 chars)
 */
export const ed25519PublicFromSecret = async (ed25519SecretHex: string): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.ed25519PublicFromSecret(ed25519SecretHex);
};

// ============================================================================
// Ed25519 Signing Functions
// ============================================================================

/**
 * Sign an arbitrary message with an Ed25519 secret key
 *
 * @param ed25519SecretHex - Ed25519 secret key as hex string (64 chars / 32 bytes)
 * @param messageHex - Message to sign as hex string
 * @returns Promise resolving to 64-byte signature as hex string (128 chars)
 */
export const ed25519Sign = async (
  ed25519SecretHex: string,
  messageHex: string,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.ed25519Sign(ed25519SecretHex, messageHex);
};

/**
 * Verify an Ed25519 signature
 *
 * @param ed25519PublicHex - Ed25519 public key as hex string (64 chars / 32 bytes)
 * @param messageHex - Original message as hex string
 * @param signatureHex - Signature to verify as hex string (128 chars / 64 bytes)
 * @returns Promise resolving to true if signature is valid
 */
export const ed25519Verify = async (
  ed25519PublicHex: string,
  messageHex: string,
  signatureHex: string,
): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.ed25519Verify(ed25519PublicHex, messageHex, signatureHex);
};

// ============================================================================
// Unified Key Delegation (UKD) APIs - PUBKY_UNIFIED_KEY_DELEGATION_SPEC v0.2
// ============================================================================

/**
 * Generate a new Ed25519 keypair for use as an AppKey.
 *
 * @returns Promise resolving to keypair with secretKey and publicKey as hex strings (64 chars each)
 */
export const generateAppKeypair = async (): Promise<AppKeypairResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.generateAppKeypair();
};

/**
 * Issue an AppCert by signing with the root Ed25519 secret key.
 *
 * Creates a delegated certificate that allows an app-specific key to sign
 * on behalf of the root identity within specified scopes.
 *
 * @param rootSkHex - Root PKARR Ed25519 secret key as hex (64 chars)
 * @param appId - Application identifier (e.g., "pubky.app", "paykit")
 * @param appEd25519PubHex - Delegated signing key as hex (64 chars)
 * @param transportX25519PubHex - Delegated Noise static key as hex (64 chars)
 * @param inboxX25519PubHex - Delegated inbox encryption key as hex (64 chars)
 * @param deviceIdHex - Optional device ID as hex
 * @param scopes - Optional capability scopes (e.g., ["write:posts", "read:profile"])
 * @param expiresAt - Optional expiration timestamp (Unix seconds)
 * @returns Promise resolving to { certBodyHex, sigHex, certIdHex }
 */
export const issueAppCert = async (
  rootSkHex: string,
  appId: string,
  appEd25519PubHex: string,
  transportX25519PubHex: string,
  inboxX25519PubHex: string,
  deviceIdHex?: string | null,
  scopes?: string[] | null,
  expiresAt?: number | null,
): Promise<AppCertResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.issueAppCert(
    rootSkHex,
    appId,
    appEd25519PubHex,
    transportX25519PubHex,
    inboxX25519PubHex,
    deviceIdHex,
    scopes,
    expiresAt,
  );
};

/**
 * Verify an AppCert signature.
 *
 * Validates that the certificate was issued by the claimed root identity.
 *
 * @param issuerPeeridHex - Root PKARR Ed25519 public key as hex (64 chars)
 * @param certBodyHex - Raw cert_body bytes as hex
 * @param sigHex - Ed25519 signature as hex (128 chars)
 * @returns Promise resolving to certIdHex if valid
 */
export const verifyAppCert = async (
  issuerPeeridHex: string,
  certBodyHex: string,
  sigHex: string,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.verifyAppCert(issuerPeeridHex, certBodyHex, sigHex);
};

/**
 * Sign typed content with an AppKey per UKD spec.
 *
 * This is a TYPED signing function that creates domain-separated signatures.
 * The contentType parameter constrains what is being signed, preventing
 * cross-domain signature reuse attacks.
 *
 * @param appSkHex - AppKey Ed25519 secret key as hex (64 chars)
 * @param issuerPeeridHex - Root PKARR Ed25519 public key as hex (64 chars)
 * @param certIdHex - AppCert identifier as hex (32 chars)
 * @param contentType - ASCII label describing what is signed (e.g., "pubky.post", "paykit.ack")
 * @param payloadHex - Content payload as hex
 * @returns Promise resolving to 64-byte Ed25519 signature as hex (128 chars)
 */
export const signTypedContent = async (
  appSkHex: string,
  issuerPeeridHex: string,
  certIdHex: string,
  contentType: string,
  payloadHex: string,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.signTypedContent(
    appSkHex,
    issuerPeeridHex,
    certIdHex,
    contentType,
    payloadHex,
  );
};

/**
 * Verify typed content signature.
 *
 * Validates that content was signed by an AppKey with the claimed certificate.
 *
 * @param appEd25519PubHex - AppKey Ed25519 public key as hex (64 chars)
 * @param issuerPeeridHex - Root PKARR Ed25519 public key as hex (64 chars)
 * @param certIdHex - AppCert identifier as hex (32 chars)
 * @param contentType - ASCII label describing what is signed
 * @param payloadHex - Content payload as hex
 * @param sigHex - Signature to verify as hex (128 chars)
 * @returns Promise resolving to true if valid
 */
export const verifyTypedContent = async (
  appEd25519PubHex: string,
  issuerPeeridHex: string,
  certIdHex: string,
  contentType: string,
  payloadHex: string,
  sigHex: string,
): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.verifyTypedContent(
    appEd25519PubHex,
    issuerPeeridHex,
    certIdHex,
    contentType,
    payloadHex,
    sigHex,
  );
};

/**
 * Compute the inbox_kid for a given inbox public key.
 *
 * inbox_kid = SHA256(inbox_pk)[0..16] (first 16 bytes)
 *
 * This is used for KeyBinding discovery per PUBKY_CRYPTO_SPEC v2.5.
 * The inbox_kid serves as a short identifier for inbox keys in PKARR records.
 *
 * @param inboxPkHex - Inbox X25519 public key as hex (64 chars / 32 bytes)
 * @returns Promise resolving to inbox_kid as hex (32 chars / 16 bytes)
 */
export const computeInboxKid = async (inboxPkHex: string): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.computeInboxKid(inboxPkHex);
};

// ============================================================================
// SB2 Binary Wire Format Functions (PUBKY_CRYPTO_SPEC v2.5 Section 7.2)
// ============================================================================

/**
 * Check if data starts with SB2 magic bytes ("SB2").
 *
 * Use this to detect whether data is SB2 binary format or legacy JSON.
 *
 * @param dataBase64 - Base64-encoded bytes to check
 * @returns Promise resolving to true if data starts with SB2 magic
 */
export const sb2IsSb2 = async (dataBase64: string): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sb2IsSb2(dataBase64);
};

/**
 * Encrypt plaintext to SB2 binary format.
 *
 * Creates an SB2 envelope per PUBKY_CRYPTO_SPEC v2.5 Section 7.2.
 * For signed messages, call sb2Sign after encryption.
 *
 * @param recipientInboxPkHex - Recipient's InboxKey X25519 public key (32 bytes, 64 hex chars)
 * @param plaintextHex - Data to encrypt (hex-encoded)
 * @param contextIdHex - Thread identifier (32 bytes, 64 hex chars - random for new threads)
 * @param msgId - Optional idempotency key (ASCII, max 128 chars)
 * @param purpose - Optional purpose hint ("request", "proposal", "ack")
 * @param ownerPeeridHex - Storage owner's Ed25519 public key (32 bytes, 64 hex chars)
 * @param senderPeeridHex - Sender's Ed25519 public key (32 bytes, 64 hex chars)
 * @param recipientPeeridHex - Recipient's Ed25519 public key (32 bytes, 64 hex chars)
 * @param canonicalPath - Canonical storage path (e.g., "/pub/paykit.app/v0/requests/abc/req_001")
 * @param createdAt - Optional Unix timestamp (seconds)
 * @param expiresAt - Optional Unix timestamp (seconds)
 * @param certIdHex - Optional AppCert identifier (16 bytes, 32 hex chars) for delegated signing
 * @returns Promise resolving to SB2 binary envelope as base64
 */
export const sb2Encrypt = async (
  recipientInboxPkHex: string,
  plaintextHex: string,
  contextIdHex: string,
  msgId: string | null,
  purpose: string | null,
  ownerPeeridHex: string,
  senderPeeridHex: string,
  recipientPeeridHex: string,
  canonicalPath: string,
  createdAt: number | null,
  expiresAt: number | null,
  certIdHex: string | null,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sb2Encrypt(
    recipientInboxPkHex,
    plaintextHex,
    contextIdHex,
    msgId,
    purpose,
    ownerPeeridHex,
    senderPeeridHex,
    recipientPeeridHex,
    canonicalPath,
    createdAt,
    expiresAt,
    certIdHex,
  );
};

/**
 * Decrypt an SB2 binary envelope.
 *
 * @param envelopeBase64 - SB2 binary envelope as base64
 * @param recipientInboxSkHex - Recipient's InboxKey X25519 secret key (32 bytes, 64 hex chars)
 * @param ownerPeeridHex - Storage owner's Ed25519 public key (32 bytes, 64 hex chars)
 * @param canonicalPath - Canonical storage path (must match encryption)
 * @returns Promise resolving to Sb2DecryptResult with header and plaintext
 */
export const sb2Decrypt = async (
  envelopeBase64: string,
  recipientInboxSkHex: string,
  ownerPeeridHex: string,
  canonicalPath: string,
): Promise<Sb2DecryptResult> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sb2Decrypt(
    envelopeBase64,
    recipientInboxSkHex,
    ownerPeeridHex,
    canonicalPath,
  );
};

/**
 * Sign an SB2 envelope with sender's Ed25519 private key.
 *
 * Per PUBKY_CRYPTO_SPEC Section 7.2.1, the signature input is:
 * sig_input = BLAKE3("pubky-envelope-sig/v2" || aad || header_no_sig || ciphertext)
 *
 * @param envelopeBase64 - SB2 binary envelope as base64
 * @param senderEd25519SkHex - Sender's Ed25519 secret key (32 bytes, 64 hex chars)
 * @param ownerPeeridHex - Storage owner's Ed25519 public key (32 bytes, 64 hex chars)
 * @param canonicalPath - Canonical storage path
 * @returns Promise resolving to signed SB2 binary envelope as base64
 */
export const sb2Sign = async (
  envelopeBase64: string,
  senderEd25519SkHex: string,
  ownerPeeridHex: string,
  canonicalPath: string,
): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sb2Sign(
    envelopeBase64,
    senderEd25519SkHex,
    ownerPeeridHex,
    canonicalPath,
  );
};

/**
 * Verify the signature on an SB2 envelope.
 *
 * @param envelopeBase64 - SB2 binary envelope as base64
 * @param ownerPeeridHex - Storage owner's Ed25519 public key (32 bytes, 64 hex chars)
 * @param canonicalPath - Canonical storage path
 * @returns Promise resolving to true if signature is valid, false if no signature present
 */
export const sb2VerifySignature = async (
  envelopeBase64: string,
  ownerPeeridHex: string,
  canonicalPath: string,
): Promise<boolean> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sb2VerifySignature(envelopeBase64, ownerPeeridHex, canonicalPath);
};

/**
 * Decode an SB2 envelope and return its header without decrypting.
 *
 * Useful for inspecting metadata (sender, expiry, etc.) before decryption.
 *
 * @param envelopeBase64 - SB2 binary envelope as base64
 * @returns Promise resolving to Sb2Header with all metadata fields
 */
export const sb2DecodeHeader = async (envelopeBase64: string): Promise<Sb2Header> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sb2DecodeHeader(envelopeBase64);
};

/**
 * Generate a random 32-byte context ID for new conversation threads.
 *
 * Per Paykit protocol, new threads should use random context IDs
 * rather than pair-derived IDs.
 *
 * @returns Promise resolving to random 32 bytes as hex (64 chars)
 */
export const sb2GenerateContextId = async (): Promise<string> => {
  if (!isNativeModuleAvailable()) {
    throw new Error('PubkyNoiseModule native module is not available');
  }
  return NativePubkyNoiseModule.sb2GenerateContextId();
};

// ============================================================================
// Default Export
// ============================================================================

export default {
  // Availability
  isNativeModuleAvailable,
  // Key Derivation
  deriveX25519ForDeviceEpoch,
  getPublicKey,
  deriveNoiseSeed,
  // Sealed Blob (v2 encrypt, v1/v2 auto-detect decrypt)
  x25519GenerateKeypair,
  x25519PublicFromSecret,
  sealedBlobEncrypt,
  sealedBlobDecrypt,
  isSealedBlob,
  // Sealed Blob v2 with Spec-Compliant AAD (PUBKY_CRYPTO_SPEC Section 7.5)
  sealedBlobEncryptWithContext,
  sealedBlobDecryptWithContext,
  // Ed25519 Key Derivation
  ed25519PublicFromSecret,
  // Ed25519 Signing
  ed25519Sign,
  ed25519Verify,
  // Unified Key Delegation (UKD) - PUBKY_UNIFIED_KEY_DELEGATION_SPEC v0.2
  generateAppKeypair,
  issueAppCert,
  verifyAppCert,
  signTypedContent,
  verifyTypedContent,
  computeInboxKid,
  // SB2 Binary Wire Format (PUBKY_CRYPTO_SPEC v2.5 Section 7.2)
  sb2IsSb2,
  sb2Encrypt,
  sb2Decrypt,
  sb2Sign,
  sb2VerifySignature,
  sb2DecodeHeader,
  sb2GenerateContextId,
  // Manager Lifecycle
  createClientManager,
  createServerManager,
  destroyManager,
  // Connection Handshake
  initiateConnection,
  acceptConnection,
  completeConnection,
  // Encryption/Decryption
  encrypt,
  decrypt,
  // Session Management
  listSessions,
  getSessionStatus,
  removeSession,
  saveSessionState,
  restoreSessionState,
};
