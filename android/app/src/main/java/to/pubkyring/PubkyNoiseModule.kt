package to.pubkyring

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.pubky.noise.FfiConnectionStatus
import com.pubky.noise.FfiMobileConfig
import com.pubky.noise.FfiNoiseManager
import com.pubky.noise.FfiSessionState
import com.pubky.noise.batterySaverConfig
import com.pubky.noise.defaultConfig
import com.pubky.noise.deriveDeviceKey
import com.pubky.noise.performanceConfig
import com.pubky.noise.publicKeyFromSecret
import com.pubky.noise.sealedBlobDecrypt
import com.pubky.noise.sealedBlobEncrypt
import com.pubky.noise.x25519GenerateKeypair
import com.pubky.noise.x25519PublicFromSecret
import com.pubky.noise.ed25519Sign
import com.pubky.noise.ed25519Verify
import com.pubky.noise.generateAppKeypair
import com.pubky.noise.issueAppCert
import com.pubky.noise.verifyAppCert
import com.pubky.noise.signTypedContent
import com.pubky.noise.verifyTypedContent
import com.pubky.noise.sb2IsSb2
import com.pubky.noise.sb2Encrypt
import com.pubky.noise.sb2Decrypt
import com.pubky.noise.sb2Sign
import com.pubky.noise.sb2VerifySignature
import com.pubky.noise.sb2DecodeHeader
import com.pubky.noise.sb2GenerateContextId
import kotlinx.coroutines.CoroutineScope
import java.security.MessageDigest
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * React Native native module for pubky-noise
 * Bridges the Rust FFI to React Native JavaScript
 */
class PubkyNoiseModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val managers = ConcurrentHashMap<String, FfiNoiseManager>()

    override fun getName(): String = "PubkyNoiseModule"

    /**
     * Derive X25519 key pair from seed, device ID, and epoch
     */
    @ReactMethod
    fun deriveX25519ForDeviceEpoch(
        seedHex: String,
        deviceIdHex: String,
        epoch: Int,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val seed = hexStringToByteArray(seedHex)
                if (seed.size != 32) {
                    promise.reject("INVALID_SEED", "Seed must be 32 bytes")
                    return@launch
                }

                val deviceId = hexStringToByteArray(deviceIdHex)
                if (deviceId.isEmpty()) {
                    promise.reject("INVALID_DEVICE_ID", "Device ID must be valid hex string")
                    return@launch
                }

                // Use pubky-noise FFI to derive the key
                val secretKey = deriveDeviceKey(seed, deviceId, epoch.toUInt())
                val publicKey = publicKeyFromSecret(secretKey)

                val result = Arguments.createMap().apply {
                    putString("secretKey", byteArrayToHexString(secretKey))
                    putString("publicKey", byteArrayToHexString(publicKey))
                }

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to derive key: ${e.message}", e)
            }
        }
    }

    /**
     * Get the public key from a secret key
     */
    @ReactMethod
    fun getPublicKey(secretKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                val secretKey = hexStringToByteArray(secretKeyHex)
                if (secretKey.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes")
                    return@launch
                }

                val publicKey = publicKeyFromSecret(secretKey)
                promise.resolve(byteArrayToHexString(publicKey))
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to get public key: ${e.message}", e)
            }
        }
    }

    // MARK: - Sealed Blob v2 (v1 backward compatible for decryption)

    /**
     * Generate a new X25519 keypair for sealed blob encryption
     */
    @ReactMethod
    fun x25519GenerateKeypair(promise: Promise) {
        scope.launch {
            try {
                val keypair = x25519GenerateKeypair()
                val result = Arguments.createMap().apply {
                    putString("secretKey", byteArrayToHexString(keypair.secretKey))
                    putString("publicKey", byteArrayToHexString(keypair.publicKey))
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("KEYGEN_ERROR", "Failed to generate keypair: ${e.message}", e)
            }
        }
    }

    /**
     * Derive X25519 public key from secret key
     */
    @ReactMethod
    fun x25519PublicFromSecret(secretKeyHex: String, promise: Promise) {
        scope.launch {
            try {
                val secretKey = hexStringToByteArray(secretKeyHex)
                if (secretKey.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes")
                    return@launch
                }

                val publicKey = x25519PublicFromSecret(secretKey)
                promise.resolve(byteArrayToHexString(publicKey))
            } catch (e: Exception) {
                promise.reject("KEY_ERROR", "Failed to derive public key: ${e.message}", e)
            }
        }
    }

    /**
     * Encrypt plaintext using Paykit Sealed Blob v2 format (XChaCha20-Poly1305)
     */
    @ReactMethod
    fun sealedBlobEncrypt(
        recipientPkHex: String,
        plaintextHex: String,
        aad: String,
        purpose: String?,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val recipientPk = hexStringToByteArray(recipientPkHex)
                if (recipientPk.size != 32) {
                    promise.reject("INVALID_RECIPIENT_PK", "Recipient public key must be 32 bytes")
                    return@launch
                }

                val plaintext = hexStringToByteArray(plaintextHex)
                val envelope = sealedBlobEncrypt(recipientPk, plaintext, aad, purpose)
                promise.resolve(envelope)
            } catch (e: Exception) {
                promise.reject("ENCRYPT_ERROR", "Failed to encrypt sealed blob: ${e.message}", e)
            }
        }
    }

    /**
     * Decrypt a Paykit Sealed Blob v1 or v2 envelope (auto-detects version)
     */
    @ReactMethod
    fun sealedBlobDecrypt(
        recipientSkHex: String,
        envelopeJson: String,
        aad: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val recipientSk = hexStringToByteArray(recipientSkHex)
                if (recipientSk.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Recipient secret key must be 32 bytes")
                    return@launch
                }

                val plaintext = sealedBlobDecrypt(recipientSk, envelopeJson, aad)
                promise.resolve(byteArrayToHexString(plaintext))
            } catch (e: Exception) {
                promise.reject("DECRYPT_ERROR", "Failed to decrypt sealed blob: ${e.message}", e)
            }
        }
    }

    /**
     * Check if a JSON string looks like a sealed blob envelope (v1 or v2)
     */
    @ReactMethod
    fun isSealedBlob(json: String, promise: Promise) {
        try {
            val result = com.pubky.noise.isSealedBlob(json)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CHECK_ERROR", "Failed to check sealed blob: ${e.message}", e)
        }
    }

    /**
     * Encrypt using Sealed Blob v2 with spec-compliant AAD construction.
     * 
     * This function computes AAD internally per PUBKY_CRYPTO_SPEC Section 7.5:
     * aad = "pubky-envelope/v2:" || owner_peerid_bytes || canonical_path_bytes || header_bytes
     *
     * @param recipientPkHex Recipient's X25519 public key as hex (64 chars)
     * @param plaintextHex Plaintext to encrypt as hex
     * @param ownerPeeridHex Storage owner's Ed25519 public key as hex (64 chars)
     * @param canonicalPath Canonical storage path (e.g., "/pub/paykit.app/v0/handoff/{id}")
     * @param purpose Optional purpose hint ("handoff", "request", "proposal")
     * @returns Promise resolving to JSON-encoded sealed blob v2 envelope
     */
    @ReactMethod
    fun sealedBlobEncryptWithContext(
        recipientPkHex: String,
        plaintextHex: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        purpose: String?,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val recipientPk = hexStringToByteArray(recipientPkHex)
                if (recipientPk.size != 32) {
                    promise.reject("INVALID_RECIPIENT_PK", "Recipient public key must be 32 bytes")
                    return@launch
                }

                val ownerPeerid = hexStringToByteArray(ownerPeeridHex)
                if (ownerPeerid.size != 32) {
                    promise.reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes")
                    return@launch
                }

                val plaintext = hexStringToByteArray(plaintextHex)
                val envelope = com.pubky.noise.sealedBlobEncryptWithContext(
                    recipientPk,
                    plaintext,
                    ownerPeerid,
                    canonicalPath,
                    purpose,
                )
                promise.resolve(envelope)
            } catch (e: Exception) {
                promise.reject("ENCRYPT_ERROR", "Failed to encrypt sealed blob: ${e.message}", e)
            }
        }
    }

    /**
     * Decrypt Sealed Blob v2 with spec-compliant AAD construction.
     *
     * This function computes AAD internally per PUBKY_CRYPTO_SPEC Section 7.5.
     *
     * @param recipientSkHex Recipient's X25519 secret key as hex (64 chars)
     * @param envelopeJson JSON-encoded sealed blob v2 envelope
     * @param ownerPeeridHex Storage owner's Ed25519 public key as hex (64 chars)
     * @param canonicalPath Canonical storage path (must match encryption)
     * @returns Promise resolving to decrypted plaintext as hex
     */
    @ReactMethod
    fun sealedBlobDecryptWithContext(
        recipientSkHex: String,
        envelopeJson: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val recipientSk = hexStringToByteArray(recipientSkHex)
                if (recipientSk.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Recipient secret key must be 32 bytes")
                    return@launch
                }

                val ownerPeerid = hexStringToByteArray(ownerPeeridHex)
                if (ownerPeerid.size != 32) {
                    promise.reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes")
                    return@launch
                }

                val plaintext = com.pubky.noise.sealedBlobDecryptWithContext(
                    recipientSk,
                    envelopeJson,
                    ownerPeerid,
                    canonicalPath,
                )
                promise.resolve(byteArrayToHexString(plaintext))
            } catch (e: Exception) {
                promise.reject("DECRYPT_ERROR", "Failed to decrypt sealed blob: ${e.message}", e)
            }
        }
    }

    /**
     * Derive Ed25519 public key from secret key
     *
     * @param ed25519SecretHex Ed25519 secret key as hex string (64 chars / 32 bytes)
     * @returns Promise resolving to Ed25519 public key as hex string (64 chars)
     */
    @ReactMethod
    fun ed25519PublicFromSecret(
        ed25519SecretHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val publicKeyHex = com.pubky.noise.ed25519PublicFromSecret(ed25519SecretHex)
                promise.resolve(publicKeyHex)
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to derive Ed25519 public key: ${e.message}", e)
            }
        }
    }

    /**
     * Derive noise seed from Ed25519 secret key using HKDF-SHA256
     *
     * @param ed25519SecretHex Ed25519 secret key as hex string (64 chars)
     * @param deviceIdHex Device ID as hex string
     * @returns Promise resolving to 32-byte noise seed as hex string (64 chars)
     */
    @ReactMethod
    fun deriveNoiseSeed(
        ed25519SecretHex: String,
        deviceIdHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val seedHex = com.pubky.noise.deriveNoiseSeed(ed25519SecretHex, deviceIdHex)
                promise.resolve(seedHex)
            } catch (e: Exception) {
                promise.reject("DERIVATION_ERROR", "Failed to derive noise seed: ${e.message}", e)
            }
        }
    }

    // MARK: - Ed25519 Signing

    /**
     * Sign a message with Ed25519 secret key
     */
    @ReactMethod
    fun ed25519Sign(
        ed25519SecretHex: String,
        messageHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val signature = ed25519Sign(ed25519SecretHex, messageHex)
                promise.resolve(signature)
            } catch (e: Exception) {
                promise.reject("SIGNING_ERROR", "Failed to sign message: ${e.message}", e)
            }
        }
    }

    /**
     * Verify an Ed25519 signature
     */
    @ReactMethod
    fun ed25519Verify(
        ed25519PublicHex: String,
        messageHex: String,
        signatureHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val isValid = ed25519Verify(ed25519PublicHex, messageHex, signatureHex)
                promise.resolve(isValid)
            } catch (e: Exception) {
                promise.reject("VERIFY_ERROR", "Failed to verify signature: ${e.message}", e)
            }
        }
    }

    // MARK: - Noise Manager (Client)

    /**
     * Create a new client noise manager
     */
    @ReactMethod
    fun createClientManager(
        clientSeedHex: String,
        clientKid: String,
        deviceIdHex: String,
        configType: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val clientSeed = hexStringToByteArray(clientSeedHex)
                if (clientSeed.size != 32) {
                    promise.reject("INVALID_CLIENT_SEED", "Client seed must be 32 bytes")
                    return@launch
                }

                val deviceId = hexStringToByteArray(deviceIdHex)
                if (deviceId.isEmpty()) {
                    promise.reject("INVALID_DEVICE_ID", "Device ID must be valid hex string")
                    return@launch
                }

                val config = getConfig(configType)
                val manager = FfiNoiseManager.newClient(config, clientSeed, clientKid, deviceId)
                val managerId = UUID.randomUUID().toString()
                managers[managerId] = manager

                val result = Arguments.createMap().apply {
                    putString("managerId", managerId)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("MANAGER_ERROR", "Failed to create client noise manager: ${e.message}", e)
            }
        }
    }

    /**
     * Initiate a connection as a client
     */
    @ReactMethod
    fun initiateConnection(
        managerId: String,
        serverPkHex: String,
        hint: String?,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val serverPk = hexStringToByteArray(serverPkHex)
                if (serverPk.isEmpty()) {
                    promise.reject("INVALID_SERVER_PK", "Server public key must be valid hex string")
                    return@launch
                }

                if (hint != null && hint.length > 256) {
                    promise.reject("HINT_TOO_LONG", "Hint must be <= 256 characters")
                    return@launch
                }

                val result = manager.initiateConnection(serverPk, hint)
                val response = Arguments.createMap().apply {
                    putString("sessionId", result.sessionId)
                    putString("firstMessage", byteArrayToHexString(result.firstMessage))
                }
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("CONNECTION_ERROR", "Failed to initiate connection: ${e.message}", e)
            }
        }
    }

    /**
     * Complete a connection as a client
     */
    @ReactMethod
    fun completeConnection(
        managerId: String,
        sessionId: String,
        serverResponseHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val serverResponse = hexStringToByteArray(serverResponseHex)
                if (serverResponse.isEmpty()) {
                    promise.reject("INVALID_SERVER_RESPONSE", "Server response must be valid hex string")
                    return@launch
                }

                val finalSessionId = manager.completeConnection(sessionId, serverResponse)
                val response = Arguments.createMap().apply {
                    putString("sessionId", finalSessionId)
                }
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("CONNECTION_ERROR", "Failed to complete connection: ${e.message}", e)
            }
        }
    }

    // MARK: - Noise Manager (Server)

    /**
     * Create a new server noise manager
     */
    @ReactMethod
    fun createServerManager(
        serverSeedHex: String,
        serverKid: String,
        deviceIdHex: String,
        configType: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val serverSeed = hexStringToByteArray(serverSeedHex)
                if (serverSeed.size != 32) {
                    promise.reject("INVALID_SERVER_SEED", "Server seed must be 32 bytes")
                    return@launch
                }

                val deviceId = hexStringToByteArray(deviceIdHex)
                if (deviceId.isEmpty()) {
                    promise.reject("INVALID_DEVICE_ID", "Device ID must be valid hex string")
                    return@launch
                }

                val config = getConfig(configType)
                val manager = FfiNoiseManager.newServer(config, serverSeed, serverKid, deviceId)
                val managerId = UUID.randomUUID().toString()
                managers[managerId] = manager

                val result = Arguments.createMap().apply {
                    putString("managerId", managerId)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("MANAGER_ERROR", "Failed to create server noise manager: ${e.message}", e)
            }
        }
    }

    /**
     * Accept a connection as a server
     */
    @ReactMethod
    fun acceptConnection(
        managerId: String,
        firstMsgHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val firstMsg = hexStringToByteArray(firstMsgHex)
                if (firstMsg.isEmpty()) {
                    promise.reject("INVALID_FIRST_MSG", "First message must be valid hex string")
                    return@launch
                }

                val result = manager.acceptConnection(firstMsg)
                val response = Arguments.createMap().apply {
                    putString("sessionId", result.sessionId)
                    putString("responseMessage", byteArrayToHexString(result.responseMessage))
                }
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("CONNECTION_ERROR", "Failed to accept connection: ${e.message}", e)
            }
        }
    }

    // MARK: - Common Noise Manager Operations

    /**
     * Encrypt data
     */
    @ReactMethod
    fun encrypt(
        managerId: String,
        sessionId: String,
        plaintextHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val plaintext = hexStringToByteArray(plaintextHex)
                val ciphertext = manager.encrypt(sessionId, plaintext)
                val result = Arguments.createMap().apply {
                    putString("ciphertext", byteArrayToHexString(ciphertext))
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("ENCRYPTION_ERROR", "Failed to encrypt data: ${e.message}", e)
            }
        }
    }

    /**
     * Decrypt data
     */
    @ReactMethod
    fun decrypt(
        managerId: String,
        sessionId: String,
        ciphertextHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val ciphertext = hexStringToByteArray(ciphertextHex)
                val plaintext = manager.decrypt(sessionId, ciphertext)
                val result = Arguments.createMap().apply {
                    putString("plaintext", byteArrayToHexString(plaintext))
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("DECRYPTION_ERROR", "Failed to decrypt data: ${e.message}", e)
            }
        }
    }

    /**
     * Get current session status
     */
    @ReactMethod
    fun getSessionStatus(
        managerId: String,
        sessionId: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val status = manager.getStatus(sessionId)
                val result = Arguments.createMap().apply {
                    if (status != null) {
                        putString("status", status.name.lowercase())
                    } else {
                        putNull("status")
                    }
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("STATUS_ERROR", "Failed to get session status: ${e.message}", e)
            }
        }
    }

    /**
     * Set session status
     */
    @ReactMethod
    fun setSessionStatus(
        managerId: String,
        sessionId: String,
        status: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val ffiStatus = when (status.uppercase()) {
                    "CONNECTED" -> FfiConnectionStatus.CONNECTED
                    "RECONNECTING" -> FfiConnectionStatus.RECONNECTING
                    "DISCONNECTED" -> FfiConnectionStatus.DISCONNECTED
                    "ERROR" -> FfiConnectionStatus.ERROR
                    else -> {
                        promise.reject("INVALID_STATUS", "Invalid status string: $status")
                        return@launch
                    }
                }

                manager.setStatus(sessionId, ffiStatus)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("STATUS_ERROR", "Failed to set session status: ${e.message}", e)
            }
        }
    }

    /**
     * List all active session IDs
     */
    @ReactMethod
    fun listSessions(managerId: String, promise: Promise) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val sessions = manager.listSessions()
                val sessionsArray = Arguments.createArray()
                sessions.forEach { sessionsArray.pushString(it) }
                val result = Arguments.createMap().apply {
                    putArray("sessions", sessionsArray)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("SESSION_ERROR", "Failed to list sessions: ${e.message}", e)
            }
        }
    }

    /**
     * Save session state
     */
    @ReactMethod
    fun saveSessionState(
        managerId: String,
        sessionId: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val state = manager.saveState(sessionId)
                val result = Arguments.createMap().apply {
                    putString("sessionId", state.sessionId)
                    putString("peerStaticPk", byteArrayToHexString(state.peerStaticPk))
                    putDouble("writeCounter", state.writeCounter.toDouble())
                    putDouble("readCounter", state.readCounter.toDouble())
                    putString("status", state.status.name.lowercase())
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("STATE_ERROR", "Failed to save session state: ${e.message}", e)
            }
        }
    }

    /**
     * Restore session state
     */
    @ReactMethod
    fun restoreSessionState(
        managerId: String,
        sessionId: String,
        peerStaticPkHex: String,
        writeCounter: Double,
        readCounter: Double,
        status: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                val ffiStatus = when (status.uppercase()) {
                    "CONNECTED" -> FfiConnectionStatus.CONNECTED
                    "RECONNECTING" -> FfiConnectionStatus.RECONNECTING
                    "DISCONNECTED" -> FfiConnectionStatus.DISCONNECTED
                    "ERROR" -> FfiConnectionStatus.ERROR
                    else -> {
                        promise.reject("INVALID_STATUS", "Invalid status string: $status")
                        return@launch
                    }
                }

                val state = FfiSessionState(
                    sessionId = sessionId,
                    peerStaticPk = hexStringToByteArray(peerStaticPkHex),
                    writeCounter = writeCounter.toULong(),
                    readCounter = readCounter.toULong(),
                    status = ffiStatus,
                )

                manager.restoreState(state)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("STATE_ERROR", "Failed to restore session state: ${e.message}", e)
            }
        }
    }

    /**
     * Remove a session
     */
    @ReactMethod
    fun removeSession(
        managerId: String,
        sessionId: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val manager = managers[managerId]
                if (manager == null) {
                    promise.reject("INVALID_MANAGER", "Manager not found")
                    return@launch
                }

                manager.removeSession(sessionId)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("SESSION_ERROR", "Failed to remove session: ${e.message}", e)
            }
        }
    }

    /**
     * Destroy a noise manager
     */
    @ReactMethod
    fun destroyManager(managerId: String, promise: Promise) {
        managers.remove(managerId)
        promise.resolve(true)
    }

    // MARK: - Unified Key Delegation (UKD) APIs

    /**
     * Generate a new Ed25519 keypair for use as an AppKey.
     *
     * @returns Promise resolving to { secretKey: string, publicKey: string } (both 64 hex chars)
     */
    @ReactMethod
    fun generateAppKeypair(promise: Promise) {
        scope.launch {
            try {
                val keypair = generateAppKeypair()
                val result = Arguments.createMap().apply {
                    putString("secretKey", keypair.secretKeyHex)
                    putString("publicKey", keypair.publicKeyHex)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("KEYGEN_ERROR", "Failed to generate app keypair: ${e.message}", e)
            }
        }
    }

    /**
     * Issue an AppCert by signing with the root Ed25519 secret key.
     *
     * @param rootSkHex Root PKARR Ed25519 secret key as hex (64 chars)
     * @param appId Application identifier (e.g., "pubky.app", "paykit")
     * @param appEd25519PubHex Delegated signing key as hex (64 chars)
     * @param transportX25519PubHex Delegated Noise static key as hex (64 chars)
     * @param inboxX25519PubHex Delegated inbox encryption key as hex (64 chars)
     * @param deviceIdHex Optional device ID as hex
     * @param scopes Optional capability scopes
     * @param expiresAt Optional expiration timestamp (Unix seconds)
     * @returns Promise resolving to { certBodyHex, sigHex, certIdHex }
     */
    @ReactMethod
    fun issueAppCert(
        rootSkHex: String,
        appId: String,
        appEd25519PubHex: String,
        transportX25519PubHex: String,
        inboxX25519PubHex: String,
        deviceIdHex: String?,
        scopes: com.facebook.react.bridge.ReadableArray?,
        expiresAt: Double?,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val scopesList: List<String>? = scopes?.let { arr ->
                    (0 until arr.size()).mapNotNull { arr.getString(it) }
                }
                val expiresAtLong: ULong? = expiresAt?.takeIf { it > 0 }?.toLong()?.toULong()

                val certResult = issueAppCert(
                    rootSkHex,
                    appId,
                    appEd25519PubHex,
                    transportX25519PubHex,
                    inboxX25519PubHex,
                    deviceIdHex,
                    scopesList,
                    expiresAtLong,
                )
                val result = Arguments.createMap().apply {
                    putString("certBodyHex", certResult.certBodyHex)
                    putString("sigHex", certResult.sigHex)
                    putString("certIdHex", certResult.certIdHex)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("CERT_ERROR", "Failed to issue AppCert: ${e.message}", e)
            }
        }
    }

    /**
     * Verify an AppCert signature.
     *
     * @param issuerPeeridHex Root PKARR Ed25519 public key as hex (64 chars)
     * @param certBodyHex Raw cert_body bytes as hex
     * @param sigHex Ed25519 signature as hex (128 chars)
     * @returns Promise resolving to certIdHex if valid
     */
    @ReactMethod
    fun verifyAppCert(
        issuerPeeridHex: String,
        certBodyHex: String,
        sigHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val certIdHex = verifyAppCert(issuerPeeridHex, certBodyHex, sigHex)
                promise.resolve(certIdHex)
            } catch (e: Exception) {
                promise.reject("VERIFY_ERROR", "AppCert verification failed: ${e.message}", e)
            }
        }
    }

    /**
     * Sign typed content with an AppKey per UKD spec.
     *
     * This is a TYPED signing function, not a generic "sign anything" API.
     * The contentType parameter constrains what is being signed.
     *
     * @param appSkHex AppKey Ed25519 secret key as hex (64 chars)
     * @param issuerPeeridHex Root PKARR Ed25519 public key as hex (64 chars)
     * @param certIdHex AppCert identifier as hex (32 chars)
     * @param contentType ASCII label describing what is signed (e.g., "pubky.post")
     * @param payloadHex Content payload as hex
     * @returns Promise resolving to 64-byte Ed25519 signature as hex (128 chars)
     */
    @ReactMethod
    fun signTypedContent(
        appSkHex: String,
        issuerPeeridHex: String,
        certIdHex: String,
        contentType: String,
        payloadHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val signatureHex = signTypedContent(
                    appSkHex,
                    issuerPeeridHex,
                    certIdHex,
                    contentType,
                    payloadHex,
                )
                promise.resolve(signatureHex)
            } catch (e: Exception) {
                promise.reject("SIGNING_ERROR", "Failed to sign typed content: ${e.message}", e)
            }
        }
    }

    /**
     * Verify typed content signature.
     *
     * @param appEd25519PubHex AppKey Ed25519 public key as hex (64 chars)
     * @param issuerPeeridHex Root PKARR Ed25519 public key as hex (64 chars)
     * @param certIdHex AppCert identifier as hex (32 chars)
     * @param contentType ASCII label describing what is signed
     * @param payloadHex Content payload as hex
     * @param sigHex Signature to verify as hex (128 chars)
     * @returns Promise resolving to true if valid
     */
    @ReactMethod
    fun verifyTypedContent(
        appEd25519PubHex: String,
        issuerPeeridHex: String,
        certIdHex: String,
        contentType: String,
        payloadHex: String,
        sigHex: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val isValid = verifyTypedContent(
                    appEd25519PubHex,
                    issuerPeeridHex,
                    certIdHex,
                    contentType,
                    payloadHex,
                    sigHex,
                )
                promise.resolve(isValid)
            } catch (e: Exception) {
                promise.reject("VERIFY_ERROR", "Failed to verify typed content: ${e.message}", e)
            }
        }
    }

    /**
     * Compute the inbox_kid for a given inbox public key.
     *
     * inbox_kid = SHA256(inbox_pk)[0..16] (first 16 bytes)
     *
     * This is used for KeyBinding discovery per PUBKY_CRYPTO_SPEC v2.5.
     *
     * @param inboxPkHex Inbox X25519 public key as hex (64 chars / 32 bytes)
     * @returns Promise resolving to inbox_kid as hex (32 chars / 16 bytes)
     */
    @ReactMethod
    fun computeInboxKid(inboxPkHex: String, promise: Promise) {
        scope.launch {
            try {
                val inboxPk = hexStringToByteArray(inboxPkHex)
                if (inboxPk.size != 32) {
                    promise.reject("INVALID_INBOX_PK", "Inbox public key must be 32 bytes")
                    return@launch
                }

                val digest = MessageDigest.getInstance("SHA-256")
                val hash = digest.digest(inboxPk)
                val kid = hash.copyOfRange(0, 16)
                promise.resolve(byteArrayToHexString(kid))
            } catch (e: Exception) {
                promise.reject("KID_ERROR", "Failed to compute inbox_kid: ${e.message}", e)
            }
        }
    }

    // MARK: - SB2 Binary Wire Format (PUBKY_CRYPTO_SPEC v2.5 Section 7.2)

    /**
     * Check if data starts with SB2 magic bytes ("SB2").
     */
    @ReactMethod
    fun sb2IsSb2(dataBase64: String, promise: Promise) {
        scope.launch {
            try {
                val data = Base64.decode(dataBase64, Base64.DEFAULT)
                val isSb2 = sb2IsSb2(data)
                promise.resolve(isSb2)
            } catch (e: Exception) {
                promise.reject("SB2_ERROR", "Failed to check SB2 format: ${e.message}", e)
            }
        }
    }

    /**
     * Encrypt plaintext to SB2 binary format.
     */
    @ReactMethod
    fun sb2Encrypt(
        recipientInboxPkHex: String,
        plaintextHex: String,
        contextIdHex: String,
        msgId: String?,
        purpose: String?,
        ownerPeeridHex: String,
        senderPeeridHex: String,
        recipientPeeridHex: String,
        canonicalPath: String,
        createdAt: Double?,
        expiresAt: Double?,
        certIdHex: String?,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val recipientInboxPk = hexStringToByteArray(recipientInboxPkHex)
                if (recipientInboxPk.size != 32) {
                    promise.reject("INVALID_RECIPIENT_PK", "Recipient inbox public key must be 32 bytes")
                    return@launch
                }

                val plaintext = hexStringToByteArray(plaintextHex)
                val contextId = hexStringToByteArray(contextIdHex)
                if (contextId.size != 32) {
                    promise.reject("INVALID_CONTEXT_ID", "Context ID must be 32 bytes")
                    return@launch
                }

                val ownerPeerid = hexStringToByteArray(ownerPeeridHex)
                if (ownerPeerid.size != 32) {
                    promise.reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes")
                    return@launch
                }

                val senderPeerid = hexStringToByteArray(senderPeeridHex)
                if (senderPeerid.size != 32) {
                    promise.reject("INVALID_SENDER_PEERID", "Sender peerid must be 32 bytes")
                    return@launch
                }

                val recipientPeerid = hexStringToByteArray(recipientPeeridHex)
                if (recipientPeerid.size != 32) {
                    promise.reject("INVALID_RECIPIENT_PEERID", "Recipient peerid must be 32 bytes")
                    return@launch
                }

                val certId: ByteArray? = certIdHex?.let {
                    val arr = hexStringToByteArray(it)
                    if (arr.size != 16) {
                        promise.reject("INVALID_CERT_ID", "Cert ID must be 16 bytes")
                        return@launch
                    }
                    arr
                }

                val envelope = sb2Encrypt(
                    recipientInboxPk,
                    plaintext,
                    contextId,
                    msgId,
                    purpose,
                    ownerPeerid,
                    senderPeerid,
                    recipientPeerid,
                    canonicalPath,
                    createdAt?.toLong()?.toULong(),
                    expiresAt?.toLong()?.toULong(),
                    certId,
                )
                val base64Envelope = Base64.encodeToString(envelope, Base64.NO_WRAP)
                promise.resolve(base64Envelope)
            } catch (e: Exception) {
                promise.reject("SB2_ENCRYPT_ERROR", "Failed to encrypt SB2: ${e.message}", e)
            }
        }
    }

    /**
     * Decrypt an SB2 binary envelope.
     */
    @ReactMethod
    fun sb2Decrypt(
        envelopeBase64: String,
        recipientInboxSkHex: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val envelope = Base64.decode(envelopeBase64, Base64.DEFAULT)
                val recipientInboxSk = hexStringToByteArray(recipientInboxSkHex)
                if (recipientInboxSk.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Recipient inbox secret key must be 32 bytes")
                    return@launch
                }

                val ownerPeerid = hexStringToByteArray(ownerPeeridHex)
                if (ownerPeerid.size != 32) {
                    promise.reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes")
                    return@launch
                }

                val result = sb2Decrypt(
                    envelope,
                    recipientInboxSk,
                    ownerPeerid,
                    canonicalPath,
                )

                val headerMap = Arguments.createMap().apply {
                    putString("contextIdHex", result.header.contextIdHex)
                    result.header.createdAt?.let { putDouble("createdAt", it.toDouble()) } ?: putNull("createdAt")
                    result.header.expiresAt?.let { putDouble("expiresAt", it.toDouble()) } ?: putNull("expiresAt")
                    putString("inboxKidHex", result.header.inboxKidHex)
                    result.header.msgId?.let { putString("msgId", it) } ?: putNull("msgId")
                    putString("nonceHex", result.header.nonceHex)
                    result.header.purpose?.let { putString("purpose", it) } ?: putNull("purpose")
                    putString("recipientPeeridHex", result.header.recipientPeeridHex)
                    putString("senderEphemeralPubHex", result.header.senderEphemeralPubHex)
                    putString("senderPeeridHex", result.header.senderPeeridHex)
                    result.header.sigHex?.let { putString("sigHex", it) } ?: putNull("sigHex")
                    result.header.certIdHex?.let { putString("certIdHex", it) } ?: putNull("certIdHex")
                }

                val responseMap = Arguments.createMap().apply {
                    putMap("header", headerMap)
                    putString("plaintext", byteArrayToHexString(result.plaintext))
                }
                promise.resolve(responseMap)
            } catch (e: Exception) {
                promise.reject("SB2_DECRYPT_ERROR", "Failed to decrypt SB2: ${e.message}", e)
            }
        }
    }

    /**
     * Sign an SB2 envelope with sender's Ed25519 private key.
     */
    @ReactMethod
    fun sb2Sign(
        envelopeBase64: String,
        senderEd25519SkHex: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val envelope = Base64.decode(envelopeBase64, Base64.DEFAULT)
                val senderSk = hexStringToByteArray(senderEd25519SkHex)
                if (senderSk.size != 32) {
                    promise.reject("INVALID_SECRET_KEY", "Sender Ed25519 secret key must be 32 bytes")
                    return@launch
                }

                val ownerPeerid = hexStringToByteArray(ownerPeeridHex)
                if (ownerPeerid.size != 32) {
                    promise.reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes")
                    return@launch
                }

                val signedEnvelope = sb2Sign(
                    envelope,
                    senderSk,
                    ownerPeerid,
                    canonicalPath,
                )
                val base64Envelope = Base64.encodeToString(signedEnvelope, Base64.NO_WRAP)
                promise.resolve(base64Envelope)
            } catch (e: Exception) {
                promise.reject("SB2_SIGN_ERROR", "Failed to sign SB2: ${e.message}", e)
            }
        }
    }

    /**
     * Verify the signature on an SB2 envelope.
     */
    @ReactMethod
    fun sb2VerifySignature(
        envelopeBase64: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                val envelope = Base64.decode(envelopeBase64, Base64.DEFAULT)
                val ownerPeerid = hexStringToByteArray(ownerPeeridHex)
                if (ownerPeerid.size != 32) {
                    promise.reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes")
                    return@launch
                }

                val isValid = sb2VerifySignature(
                    envelope,
                    ownerPeerid,
                    canonicalPath,
                )
                promise.resolve(isValid)
            } catch (e: Exception) {
                promise.reject("SB2_VERIFY_ERROR", "Failed to verify SB2 signature: ${e.message}", e)
            }
        }
    }

    /**
     * Decode an SB2 envelope and return its header without decrypting.
     */
    @ReactMethod
    fun sb2DecodeHeader(envelopeBase64: String, promise: Promise) {
        scope.launch {
            try {
                val envelope = Base64.decode(envelopeBase64, Base64.DEFAULT)
                val header = sb2DecodeHeader(envelope)

                val headerMap = Arguments.createMap().apply {
                    putString("contextIdHex", header.contextIdHex)
                    header.createdAt?.let { putDouble("createdAt", it.toDouble()) } ?: putNull("createdAt")
                    header.expiresAt?.let { putDouble("expiresAt", it.toDouble()) } ?: putNull("expiresAt")
                    putString("inboxKidHex", header.inboxKidHex)
                    header.msgId?.let { putString("msgId", it) } ?: putNull("msgId")
                    putString("nonceHex", header.nonceHex)
                    header.purpose?.let { putString("purpose", it) } ?: putNull("purpose")
                    putString("recipientPeeridHex", header.recipientPeeridHex)
                    putString("senderEphemeralPubHex", header.senderEphemeralPubHex)
                    putString("senderPeeridHex", header.senderPeeridHex)
                    header.sigHex?.let { putString("sigHex", it) } ?: putNull("sigHex")
                    header.certIdHex?.let { putString("certIdHex", it) } ?: putNull("certIdHex")
                }
                promise.resolve(headerMap)
            } catch (e: Exception) {
                promise.reject("SB2_DECODE_ERROR", "Failed to decode SB2 header: ${e.message}", e)
            }
        }
    }

    /**
     * Generate a random 32-byte context ID for new conversation threads.
     */
    @ReactMethod
    fun sb2GenerateContextId(promise: Promise) {
        scope.launch {
            try {
                val contextId = sb2GenerateContextId()
                promise.resolve(byteArrayToHexString(contextId))
            } catch (e: Exception) {
                promise.reject("SB2_CONTEXT_ERROR", "Failed to generate context ID: ${e.message}", e)
            }
        }
    }

    // MARK: - Private Helpers

    private fun getConfig(configType: String): FfiMobileConfig {
        return when (configType) {
            "batterySaver" -> batterySaverConfig()
            "performance" -> performanceConfig()
            else -> defaultConfig()
        }
    }

    private fun hexStringToByteArray(hex: String): ByteArray {
        val cleanHex = hex.replace(" ", "")
        if (cleanHex.length % 2 != 0) return ByteArray(0)

        return ByteArray(cleanHex.length / 2) { i ->
            cleanHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }

    private fun byteArrayToHexString(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
