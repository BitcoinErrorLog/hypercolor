//
//  PubkyNoiseModule.swift
//  pubkyring
//
//  React Native native module for pubky-noise
//  Bridges the Rust FFI to React Native JavaScript
//

import Foundation
import React
import CryptoKit

// MARK: - FFI Wrappers
// These wrap the global FFI functions to avoid name collisions with instance methods

private enum NoiseFFI {
    static func generateX25519Keypair() -> FfiX25519Keypair {
        hypercolor.x25519GenerateKeypair()
    }
    
    static func x25519PublicFromSecret(secret: Data) throws -> Data {
        try hypercolor.x25519PublicFromSecret(secret: secret)
    }
    
    static func sealedBlobEncrypt(recipientPk: Data, plaintext: Data, aad: String, purpose: String?) throws -> String {
        try hypercolor.sealedBlobEncrypt(recipientPk: recipientPk, plaintext: plaintext, aad: aad, purpose: purpose)
    }
    
    static func sealedBlobDecrypt(recipientSk: Data, envelopeJson: String, aad: String) throws -> Data {
        try hypercolor.sealedBlobDecrypt(recipientSk: recipientSk, envelopeJson: envelopeJson, aad: aad)
    }
    
    static func isSealedBlob(json: String) -> Bool {
        hypercolor.isSealedBlob(json: json)
    }
    
    static func sealedBlobEncryptWithContext(recipientPk: Data, plaintext: Data, ownerPeerid: Data, canonicalPath: String, purpose: String?) throws -> String {
        try hypercolor.sealedBlobEncryptWithContext(recipientPk: recipientPk, plaintext: plaintext, ownerPeerid: ownerPeerid, canonicalPath: canonicalPath, purpose: purpose)
    }
    
    static func sealedBlobDecryptWithContext(recipientSk: Data, envelopeJson: String, ownerPeerid: Data, canonicalPath: String) throws -> Data {
        try hypercolor.sealedBlobDecryptWithContext(recipientSk: recipientSk, envelopeJson: envelopeJson, ownerPeerid: ownerPeerid, canonicalPath: canonicalPath)
    }
    
    static func ed25519PublicFromSecret(ed25519SecretHex: String) throws -> String {
        try hypercolor.ed25519PublicFromSecret(ed25519SecretHex: ed25519SecretHex)
    }
    
    static func deriveNoiseSeed(ed25519SecretHex: String, deviceIdHex: String) throws -> String {
        try hypercolor.deriveNoiseSeed(ed25519SecretHex: ed25519SecretHex, deviceIdHex: deviceIdHex)
    }
    
    static func ed25519Sign(ed25519SecretHex: String, messageHex: String) throws -> String {
        try hypercolor.ed25519Sign(ed25519SecretHex: ed25519SecretHex, messageHex: messageHex)
    }
    
    static func ed25519Verify(ed25519PublicHex: String, messageHex: String, signatureHex: String) throws -> Bool {
        try hypercolor.ed25519Verify(ed25519PublicHex: ed25519PublicHex, messageHex: messageHex, signatureHex: signatureHex)
    }
    
    // MARK: - UKD APIs
    
    static func generateAppKeypair() -> FfiEd25519Keypair {
        hypercolor.generateAppKeypair()
    }
    
    static func issueAppCert(
        rootSkHex: String,
        appId: String,
        appEd25519PubHex: String,
        transportX25519PubHex: String,
        inboxX25519PubHex: String,
        deviceIdHex: String?,
        scopes: [String]?,
        expiresAt: UInt64?
    ) throws -> FfiAppCertResult {
        try hypercolor.issueAppCert(
            rootSkHex: rootSkHex,
            appId: appId,
            appEd25519PubHex: appEd25519PubHex,
            transportX25519PubHex: transportX25519PubHex,
            inboxX25519PubHex: inboxX25519PubHex,
            deviceIdHex: deviceIdHex,
            scopes: scopes,
            expiresAt: expiresAt
        )
    }
    
    static func verifyAppCert(issuerPeeridHex: String, certBodyHex: String, sigHex: String) throws -> String {
        try hypercolor.verifyAppCert(issuerPeeridHex: issuerPeeridHex, certBodyHex: certBodyHex, sigHex: sigHex)
    }
    
    static func signTypedContent(
        appSkHex: String,
        issuerPeeridHex: String,
        certIdHex: String,
        contentType: String,
        payloadHex: String
    ) throws -> String {
        try hypercolor.signTypedContent(
            appSkHex: appSkHex,
            issuerPeeridHex: issuerPeeridHex,
            certIdHex: certIdHex,
            contentType: contentType,
            payloadHex: payloadHex
        )
    }
    
    static func verifyTypedContent(
        appEd25519PubHex: String,
        issuerPeeridHex: String,
        certIdHex: String,
        contentType: String,
        payloadHex: String,
        sigHex: String
    ) throws -> Bool {
        try hypercolor.verifyTypedContent(
            appEd25519PubHex: appEd25519PubHex,
            issuerPeeridHex: issuerPeeridHex,
            certIdHex: certIdHex,
            contentType: contentType,
            payloadHex: payloadHex,
            sigHex: sigHex
        )
    }
    
    // MARK: - SB2 Binary Wire Format
    
    static func sb2IsSb2(data: Data) -> Bool {
        hypercolor.sb2IsSb2(data: data)
    }
    
    static func sb2Encrypt(
        recipientInboxPk: Data,
        plaintext: Data,
        contextId: Data,
        msgId: String?,
        purpose: String?,
        ownerPeerid: Data,
        senderPeerid: Data,
        recipientPeerid: Data,
        canonicalPath: String,
        createdAt: UInt64?,
        expiresAt: UInt64?,
        certId: Data?
    ) throws -> Data {
        try hypercolor.sb2Encrypt(
            recipientInboxPk: recipientInboxPk,
            plaintext: plaintext,
            contextId: contextId,
            msgId: msgId,
            purpose: purpose,
            ownerPeerid: ownerPeerid,
            senderPeerid: senderPeerid,
            recipientPeerid: recipientPeerid,
            canonicalPath: canonicalPath,
            createdAt: createdAt,
            expiresAt: expiresAt,
            certId: certId
        )
    }
    
    static func sb2Decrypt(
        envelopeBytes: Data,
        recipientInboxSk: Data,
        ownerPeerid: Data,
        canonicalPath: String
    ) throws -> FfiSb2DecryptResult {
        try hypercolor.sb2Decrypt(
            envelopeBytes: envelopeBytes,
            recipientInboxSk: recipientInboxSk,
            ownerPeerid: ownerPeerid,
            canonicalPath: canonicalPath
        )
    }
    
    static func sb2Sign(
        envelopeBytes: Data,
        senderEd25519Sk: Data,
        ownerPeerid: Data,
        canonicalPath: String
    ) throws -> Data {
        try hypercolor.sb2Sign(
            envelopeBytes: envelopeBytes,
            senderEd25519Sk: senderEd25519Sk,
            ownerPeerid: ownerPeerid,
            canonicalPath: canonicalPath
        )
    }
    
    static func sb2VerifySignature(
        envelopeBytes: Data,
        ownerPeerid: Data,
        canonicalPath: String
    ) throws -> Bool {
        try hypercolor.sb2VerifySignature(
            envelopeBytes: envelopeBytes,
            ownerPeerid: ownerPeerid,
            canonicalPath: canonicalPath
        )
    }
    
    static func sb2DecodeHeader(envelopeBytes: Data) throws -> FfiSb2Header {
        try hypercolor.sb2DecodeHeader(envelopeBytes: envelopeBytes)
    }
    
    static func sb2GenerateContextId() -> Data {
        hypercolor.sb2GenerateContextId()
    }
}

@objc(PubkyNoiseModule)
class PubkyNoiseModule: NSObject {
    
    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    // MARK: - Key Derivation
    
    /// Derive X25519 key pair from seed, device ID, and epoch
    @objc(deriveX25519ForDeviceEpoch:deviceIdHex:epoch:resolver:rejecter:)
    func deriveX25519ForDeviceEpoch(
        _ seedHex: String,
        deviceIdHex: String,
        epoch: UInt32,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let seed = Data(hexString: seedHex), seed.count == 32 else {
                reject("INVALID_SEED", "Seed must be 32 bytes hex string", nil)
                return
            }
            
            guard let deviceId = Data(hexString: deviceIdHex) else {
                reject("INVALID_DEVICE_ID", "Device ID must be valid hex string", nil)
                return
            }
            
            // Note: deriveDeviceKey and publicKeyFromSecret now throw in pubky-noise 1.1.0+
            let secretKey: Data
            let publicKey: Data
            do {
                secretKey = try deriveDeviceKey(seed: seed, deviceId: deviceId, epoch: epoch)
                publicKey = try publicKeyFromSecret(secret: secretKey)
            } catch {
                reject("KEY_DERIVATION_FAILED", "Failed to derive device key: \(error)", error)
                return
            }
            
            let result: [String: Any] = [
                "secretKey": secretKey.hexString,
                "publicKey": publicKey.hexString
            ]
            
            resolve(result)
        }
    }
    
    /// Get the public key from a secret key
    @objc(getPublicKey:resolver:rejecter:)
    func getPublicKey(
        _ secretKeyHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let secretKey = Data(hexString: secretKeyHex), secretKey.count == 32 else {
                reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes hex string", nil)
                return
            }
            
            do {
                let publicKey = try publicKeyFromSecret(secret: secretKey)
                resolve(publicKey.hexString)
            } catch {
                reject("PUBLIC_KEY_ERROR", "Failed to derive public key: \(error)", error)
            }
        }
    }
    
    // MARK: - Sealed Blob v1
    
    /// Generate a new X25519 keypair for sealed blob encryption
    @objc(x25519GenerateKeypair:rejecter:)
    func x25519GenerateKeypair(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            let keypair = NoiseFFI.generateX25519Keypair()
            let result: [String: Any] = [
                "secretKey": keypair.secretKey.hexString,
                "publicKey": keypair.publicKey.hexString
            ]
            resolve(result)
        }
    }
    
    /// Derive X25519 public key from secret key
    @objc(x25519PublicFromSecret:resolver:rejecter:)
    func x25519PublicFromSecret(
        _ secretKeyHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let secretKey = Data(hexString: secretKeyHex), secretKey.count == 32 else {
                reject("INVALID_SECRET_KEY", "Secret key must be 32 bytes hex string", nil)
                return
            }
            
            do {
                let publicKey = try NoiseFFI.x25519PublicFromSecret(secret: secretKey)
                resolve(publicKey.hexString)
            } catch {
                reject("KEY_ERROR", "Failed to derive public key: \(error)", error)
            }
        }
    }
    
    /// Encrypt plaintext using Paykit Sealed Blob v1 format
    @objc(sealedBlobEncrypt:plaintextHex:aad:purpose:resolver:rejecter:)
    func sealedBlobEncrypt(
        _ recipientPkHex: String,
        plaintextHex: String,
        aad: String,
        purpose: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let recipientPk = Data(hexString: recipientPkHex), recipientPk.count == 32 else {
                reject("INVALID_RECIPIENT_PK", "Recipient public key must be 32 bytes hex string", nil)
                return
            }
            
            guard let plaintext = Data(hexString: plaintextHex) else {
                reject("INVALID_PLAINTEXT", "Plaintext must be valid hex string", nil)
                return
            }
            
            do {
                let envelope = try NoiseFFI.sealedBlobEncrypt(
                    recipientPk: recipientPk,
                    plaintext: plaintext,
                    aad: aad,
                    purpose: purpose
                )
                resolve(envelope)
            } catch {
                reject("ENCRYPT_ERROR", "Failed to encrypt sealed blob: \(error)", error)
            }
        }
    }
    
    /// Decrypt a Paykit Sealed Blob v1 envelope
    @objc(sealedBlobDecrypt:envelopeJson:aad:resolver:rejecter:)
    func sealedBlobDecrypt(
        _ recipientSkHex: String,
        envelopeJson: String,
        aad: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let recipientSk = Data(hexString: recipientSkHex), recipientSk.count == 32 else {
                reject("INVALID_SECRET_KEY", "Recipient secret key must be 32 bytes hex string", nil)
                return
            }
            
            do {
                let plaintext = try NoiseFFI.sealedBlobDecrypt(
                    recipientSk: recipientSk,
                    envelopeJson: envelopeJson,
                    aad: aad
                )
                resolve(plaintext.hexString)
            } catch {
                reject("DECRYPT_ERROR", "Failed to decrypt sealed blob: \(error)", error)
            }
        }
    }
    
    /// Check if a JSON string looks like a sealed blob envelope
    @objc(isSealedBlob:resolver:rejecter:)
    func isSealedBlob(
        _ json: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let result = NoiseFFI.isSealedBlob(json: json)
        resolve(result)
    }
    
    /// Encrypt using Sealed Blob v2 with spec-compliant AAD construction
    /// AAD is computed internally per PUBKY_CRYPTO_SPEC Section 7.5
    @objc(sealedBlobEncryptWithContext:plaintextHex:ownerPeeridHex:canonicalPath:purpose:resolver:rejecter:)
    func sealedBlobEncryptWithContext(
        _ recipientPkHex: String,
        plaintextHex: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        purpose: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let recipientPk = Data(hexString: recipientPkHex), recipientPk.count == 32 else {
                reject("INVALID_RECIPIENT_PK", "Recipient public key must be 32 bytes hex string", nil)
                return
            }
            
            guard let ownerPeerid = Data(hexString: ownerPeeridHex), ownerPeerid.count == 32 else {
                reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes hex string", nil)
                return
            }
            
            guard let plaintext = Data(hexString: plaintextHex) else {
                reject("INVALID_PLAINTEXT", "Plaintext must be valid hex string", nil)
                return
            }
            
            do {
                let envelope = try NoiseFFI.sealedBlobEncryptWithContext(
                    recipientPk: recipientPk,
                    plaintext: plaintext,
                    ownerPeerid: ownerPeerid,
                    canonicalPath: canonicalPath,
                    purpose: purpose
                )
                resolve(envelope)
            } catch {
                reject("ENCRYPT_ERROR", "Failed to encrypt sealed blob: \(error)", error)
            }
        }
    }
    
    /// Decrypt Sealed Blob v2 with spec-compliant AAD construction
    /// AAD is computed internally per PUBKY_CRYPTO_SPEC Section 7.5
    @objc(sealedBlobDecryptWithContext:envelopeJson:ownerPeeridHex:canonicalPath:resolver:rejecter:)
    func sealedBlobDecryptWithContext(
        _ recipientSkHex: String,
        envelopeJson: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let recipientSk = Data(hexString: recipientSkHex), recipientSk.count == 32 else {
                reject("INVALID_SECRET_KEY", "Recipient secret key must be 32 bytes hex string", nil)
                return
            }
            
            guard let ownerPeerid = Data(hexString: ownerPeeridHex), ownerPeerid.count == 32 else {
                reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes hex string", nil)
                return
            }
            
            do {
                let plaintext = try NoiseFFI.sealedBlobDecryptWithContext(
                    recipientSk: recipientSk,
                    envelopeJson: envelopeJson,
                    ownerPeerid: ownerPeerid,
                    canonicalPath: canonicalPath
                )
                resolve(plaintext.hexString)
            } catch {
                reject("DECRYPT_ERROR", "Failed to decrypt sealed blob: \(error)", error)
            }
        }
    }
    
    /// Derive Ed25519 public key from secret key
    @objc(ed25519PublicFromSecret:resolver:rejecter:)
    func ed25519PublicFromSecret(
        _ ed25519SecretHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let publicKeyHex = try NoiseFFI.ed25519PublicFromSecret(ed25519SecretHex: ed25519SecretHex)
                resolve(publicKeyHex)
            } catch {
                reject("DERIVATION_ERROR", "Failed to derive Ed25519 public key: \(error)", error)
            }
        }
    }
    
    /// Derive noise seed from Ed25519 secret key using HKDF-SHA256
    @objc(deriveNoiseSeed:deviceIdHex:resolver:rejecter:)
    func deriveNoiseSeed(
        _ ed25519SecretHex: String,
        deviceIdHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let seedHex = try NoiseFFI.deriveNoiseSeed(ed25519SecretHex: ed25519SecretHex, deviceIdHex: deviceIdHex)
                resolve(seedHex)
            } catch {
                reject("DERIVATION_ERROR", "Failed to derive noise seed: \(error)", error)
            }
        }
    }
    
    // MARK: - Ed25519 Signing
    
    /// Sign a message with Ed25519 secret key
    @objc(ed25519Sign:messageHex:resolver:rejecter:)
    func ed25519Sign(
        _ ed25519SecretHex: String,
        messageHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let signature = try NoiseFFI.ed25519Sign(ed25519SecretHex: ed25519SecretHex, messageHex: messageHex)
                resolve(signature)
            } catch {
                reject("SIGNING_ERROR", "Failed to sign message: \(error)", error)
            }
        }
    }
    
    /// Verify an Ed25519 signature
    @objc(ed25519Verify:messageHex:signatureHex:resolver:rejecter:)
    func ed25519Verify(
        _ ed25519PublicHex: String,
        messageHex: String,
        signatureHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let isValid = try NoiseFFI.ed25519Verify(ed25519PublicHex: ed25519PublicHex, messageHex: messageHex, signatureHex: signatureHex)
                resolve(isValid)
            } catch {
                reject("VERIFY_ERROR", "Failed to verify signature: \(error)", error)
            }
        }
    }
    
    // MARK: - Noise Manager Lifecycle
    
    /// Create a client noise manager
    @objc(createClientManager:clientKid:deviceIdHex:configType:resolver:rejecter:)
    func createClientManager(
        _ clientSeedHex: String,
        clientKid: String,
        deviceIdHex: String,
        configType: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let clientSeed = Data(hexString: clientSeedHex), clientSeed.count == 32 else {
                    reject("INVALID_SEED", "Client seed must be 32 bytes hex string", nil)
                    return
                }
                
                guard let deviceId = Data(hexString: deviceIdHex) else {
                    reject("INVALID_DEVICE_ID", "Device ID must be valid hex string", nil)
                    return
                }
                
                let config = self.getConfig(configType)
                let manager = try FfiNoiseManager.newClient(
                    config: config,
                    clientSeed: clientSeed,
                    clientKid: clientKid,
                    deviceId: deviceId
                )
                let managerId = NoiseManagerRegistry.shared.register(manager)
                
                resolve(["managerId": managerId])
            } catch {
                reject("MANAGER_ERROR", "Failed to create client manager: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Create a server noise manager
    @objc(createServerManager:serverKid:deviceIdHex:configType:resolver:rejecter:)
    func createServerManager(
        _ serverSeedHex: String,
        serverKid: String,
        deviceIdHex: String,
        configType: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let serverSeed = Data(hexString: serverSeedHex), serverSeed.count == 32 else {
                    reject("INVALID_SEED", "Server seed must be 32 bytes hex string", nil)
                    return
                }
                
                guard let deviceId = Data(hexString: deviceIdHex) else {
                    reject("INVALID_DEVICE_ID", "Device ID must be valid hex string", nil)
                    return
                }
                
                let config = self.getConfig(configType)
                let manager = try FfiNoiseManager.newServer(
                    config: config,
                    serverSeed: serverSeed,
                    serverKid: serverKid,
                    deviceId: deviceId
                )
                let managerId = NoiseManagerRegistry.shared.register(manager)
                
                resolve(["managerId": managerId])
            } catch {
                reject("MANAGER_ERROR", "Failed to create server manager: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Destroy a noise manager
    @objc(destroyManager:resolver:rejecter:)
    func destroyManager(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        NoiseManagerRegistry.shared.remove(managerId)
        resolve(true)
    }
    
    // MARK: - Connection Handshake
    
    /// Initiate a connection (client-side, step 1)
    @objc(initiateConnection:serverPkHex:hint:resolver:rejecter:)
    func initiateConnection(
        _ managerId: String,
        serverPkHex: String,
        hint: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let serverPk = Data(hexString: serverPkHex) else {
                    reject("INVALID_SERVER_PK", "Server public key must be valid hex string", nil)
                    return
                }
                
                if let hint = hint, hint.count > 256 {
                    reject("HINT_TOO_LONG", "Hint must be <= 256 characters", nil)
                    return
                }
                
                let result = try manager.initiateConnection(serverPk: serverPk, hint: hint)
                
                resolve([
                    "sessionId": result.sessionId,
                    "firstMessage": result.firstMessage.hexString
                ])
            } catch {
                reject("CONNECTION_ERROR", "Failed to initiate connection: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Accept a connection (server-side)
    @objc(acceptConnection:firstMessageHex:resolver:rejecter:)
    func acceptConnection(
        _ managerId: String,
        firstMessageHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let firstMsg = Data(hexString: firstMessageHex) else {
                    reject("INVALID_MESSAGE", "First message must be valid hex string", nil)
                    return
                }
                
                let result = try manager.acceptConnection(firstMsg: firstMsg)
                
                resolve([
                    "sessionId": result.sessionId,
                    "responseMessage": result.responseMessage.hexString
                ])
            } catch {
                reject("CONNECTION_ERROR", "Failed to accept connection: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Complete a connection (client-side, step 2)
    @objc(completeConnection:sessionId:serverResponseHex:resolver:rejecter:)
    func completeConnection(
        _ managerId: String,
        sessionId: String,
        serverResponseHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let serverResponse = Data(hexString: serverResponseHex) else {
                    reject("INVALID_RESPONSE", "Server response must be valid hex string", nil)
                    return
                }
                
                let finalSessionId = try manager.completeConnection(sessionId: sessionId, serverResponse: serverResponse)
                
                resolve(["sessionId": finalSessionId])
            } catch {
                reject("CONNECTION_ERROR", "Failed to complete connection: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// One-shot client connect (combines initiate + complete)
    @objc(connectClient:serverPkHex:hint:resolver:rejecter:)
    func connectClient(
        _ managerId: String,
        serverPkHex: String,
        hint: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let serverPk = Data(hexString: serverPkHex) else {
                    reject("INVALID_SERVER_PK", "Server public key must be valid hex string", nil)
                    return
                }
                
                if let hint = hint, hint.count > 256 {
                    reject("HINT_TOO_LONG", "Hint must be <= 256 characters", nil)
                    return
                }
                
                let sessionId = try manager.connectClient(serverPk: serverPk, hint: hint)
                
                resolve(["sessionId": sessionId])
            } catch {
                reject("CONNECTION_ERROR", "Failed to connect: \(error.localizedDescription)", error)
            }
        }
    }
    
    // MARK: - Encryption/Decryption
    
    /// Encrypt data for a session
    @objc(encrypt:sessionId:plaintextHex:resolver:rejecter:)
    func encrypt(
        _ managerId: String,
        sessionId: String,
        plaintextHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let plaintext = Data(hexString: plaintextHex) else {
                    reject("INVALID_PLAINTEXT", "Plaintext must be valid hex string", nil)
                    return
                }
                
                let ciphertext = try manager.encrypt(sessionId: sessionId, plaintext: plaintext)
                
                resolve(["ciphertext": ciphertext.hexString])
            } catch {
                reject("ENCRYPT_ERROR", "Failed to encrypt: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Decrypt data for a session
    @objc(decrypt:sessionId:ciphertextHex:resolver:rejecter:)
    func decrypt(
        _ managerId: String,
        sessionId: String,
        ciphertextHex: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let ciphertext = Data(hexString: ciphertextHex) else {
                    reject("INVALID_CIPHERTEXT", "Ciphertext must be valid hex string", nil)
                    return
                }
                
                let plaintext = try manager.decrypt(sessionId: sessionId, ciphertext: ciphertext)
                
                resolve(["plaintext": plaintext.hexString])
            } catch {
                reject("DECRYPT_ERROR", "Failed to decrypt: \(error.localizedDescription)", error)
            }
        }
    }
    
    // MARK: - Session Management
    
    /// List all active sessions
    @objc(listSessions:resolver:rejecter:)
    func listSessions(
        _ managerId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                reject("INVALID_MANAGER", "Manager not found", nil)
                return
            }
            
            let sessions = manager.listSessions()
            resolve(["sessions": sessions])
        }
    }
    
    /// Get session status
    @objc(getSessionStatus:sessionId:resolver:rejecter:)
    func getSessionStatus(
        _ managerId: String,
        sessionId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                reject("INVALID_MANAGER", "Manager not found", nil)
                return
            }
            
            if let status = manager.getStatus(sessionId: sessionId) {
                resolve(["status": self.statusToString(status)])
            } else {
                resolve(["status": NSNull()])
            }
        }
    }
    
    /// Remove a session
    @objc(removeSession:sessionId:resolver:rejecter:)
    func removeSession(
        _ managerId: String,
        sessionId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                reject("INVALID_MANAGER", "Manager not found", nil)
                return
            }
            
            manager.removeSession(sessionId: sessionId)
            resolve(true)
        }
    }
    
    /// Save session state for persistence
    @objc(saveSessionState:sessionId:resolver:rejecter:)
    func saveSessionState(
        _ managerId: String,
        sessionId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                let state = try manager.saveState(sessionId: sessionId)
                
                resolve([
                    "sessionId": state.sessionId,
                    "peerStaticPk": state.peerStaticPk.hexString,
                    "writeCounter": state.writeCounter,
                    "readCounter": state.readCounter,
                    "status": self.statusToString(state.status)
                ])
            } catch {
                reject("STATE_ERROR", "Failed to save session state: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Restore session state from persistence
    @objc(restoreSessionState:sessionId:peerStaticPkHex:writeCounter:readCounter:status:resolver:rejecter:)
    func restoreSessionState(
        _ managerId: String,
        sessionId: String,
        peerStaticPkHex: String,
        writeCounter: UInt64,
        readCounter: UInt64,
        status: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                guard let manager = NoiseManagerRegistry.shared.get(managerId) else {
                    reject("INVALID_MANAGER", "Manager not found", nil)
                    return
                }
                
                guard let peerStaticPk = Data(hexString: peerStaticPkHex) else {
                    reject("INVALID_PEER_PK", "Peer static public key must be valid hex string", nil)
                    return
                }
                
                let state = FfiSessionState(
                    sessionId: sessionId,
                    peerStaticPk: peerStaticPk,
                    writeCounter: writeCounter,
                    readCounter: readCounter,
                    status: self.stringToStatus(status)
                )
                
                try manager.restoreState(state: state)
                resolve(true)
            } catch {
                reject("STATE_ERROR", "Failed to restore session state: \(error.localizedDescription)", error)
            }
        }
    }
    
    private func stringToStatus(_ status: String) -> FfiConnectionStatus {
        switch status {
        case "connected":
            return .connected
        case "reconnecting":
            return .reconnecting
        case "disconnected":
            return .disconnected
        default:
            return .error
        }
    }
    
    // MARK: - Unified Key Delegation (UKD) APIs
    
    /// Generate a new Ed25519 keypair for use as an AppKey.
    ///
    /// - Returns: Promise resolving to { secretKey: string, publicKey: string } (both 64 hex chars)
    @objc
    func generateAppKeypair(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            let keypair = NoiseFFI.generateAppKeypair()
            resolve([
                "secretKey": keypair.secretKeyHex,
                "publicKey": keypair.publicKeyHex
            ])
        }
    }
    
    /// Issue an AppCert by signing with the root Ed25519 secret key.
    ///
    /// - Parameters:
    ///   - rootSkHex: Root PKARR Ed25519 secret key as hex (64 chars)
    ///   - appId: Application identifier (e.g., "pubky.app", "paykit")
    ///   - appEd25519PubHex: Delegated signing key as hex (64 chars)
    ///   - transportX25519PubHex: Delegated Noise static key as hex (64 chars)
    ///   - inboxX25519PubHex: Delegated inbox encryption key as hex (64 chars)
    ///   - deviceIdHex: Optional device ID as hex
    ///   - scopes: Optional capability scopes
    ///   - expiresAt: Optional expiration timestamp (Unix seconds)
    /// - Returns: Promise resolving to { certBodyHex, sigHex, certIdHex }
    @objc
    func issueAppCert(_ rootSkHex: String,
                      appId: String,
                      appEd25519PubHex: String,
                      transportX25519PubHex: String,
                      inboxX25519PubHex: String,
                      deviceIdHex: String?,
                      scopes: [String]?,
                      expiresAt: NSNumber?,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let expiresAtValue: UInt64? = expiresAt?.uint64Value
                let result = try NoiseFFI.issueAppCert(
                    rootSkHex: rootSkHex,
                    appId: appId,
                    appEd25519PubHex: appEd25519PubHex,
                    transportX25519PubHex: transportX25519PubHex,
                    inboxX25519PubHex: inboxX25519PubHex,
                    deviceIdHex: deviceIdHex,
                    scopes: scopes,
                    expiresAt: expiresAtValue
                )
                resolve([
                    "certBodyHex": result.certBodyHex,
                    "sigHex": result.sigHex,
                    "certIdHex": result.certIdHex
                ])
            } catch {
                reject("CERT_ERROR", "Failed to issue AppCert: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Verify an AppCert signature.
    ///
    /// - Parameters:
    ///   - issuerPeeridHex: Root PKARR Ed25519 public key as hex (64 chars)
    ///   - certBodyHex: Raw cert_body bytes as hex
    ///   - sigHex: Ed25519 signature as hex (128 chars)
    /// - Returns: Promise resolving to certIdHex if valid
    @objc
    func verifyAppCert(_ issuerPeeridHex: String,
                       certBodyHex: String,
                       sigHex: String,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let certIdHex = try NoiseFFI.verifyAppCert(
                    issuerPeeridHex: issuerPeeridHex,
                    certBodyHex: certBodyHex,
                    sigHex: sigHex
                )
                resolve(certIdHex)
            } catch {
                reject("VERIFY_ERROR", "AppCert verification failed: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Sign typed content with an AppKey per UKD spec.
    ///
    /// This is a TYPED signing function, not a generic "sign anything" API.
    /// The contentType parameter constrains what is being signed.
    ///
    /// - Parameters:
    ///   - appSkHex: AppKey Ed25519 secret key as hex (64 chars)
    ///   - issuerPeeridHex: Root PKARR Ed25519 public key as hex (64 chars)
    ///   - certIdHex: AppCert identifier as hex (32 chars)
    ///   - contentType: ASCII label describing what is signed (e.g., "pubky.post")
    ///   - payloadHex: Content payload as hex
    /// - Returns: Promise resolving to 64-byte Ed25519 signature as hex (128 chars)
    @objc
    func signTypedContent(_ appSkHex: String,
                          issuerPeeridHex: String,
                          certIdHex: String,
                          contentType: String,
                          payloadHex: String,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let signatureHex = try NoiseFFI.signTypedContent(
                    appSkHex: appSkHex,
                    issuerPeeridHex: issuerPeeridHex,
                    certIdHex: certIdHex,
                    contentType: contentType,
                    payloadHex: payloadHex
                )
                resolve(signatureHex)
            } catch {
                reject("SIGNING_ERROR", "Failed to sign typed content: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Verify typed content signature.
    ///
    /// - Parameters:
    ///   - appEd25519PubHex: AppKey Ed25519 public key as hex (64 chars)
    ///   - issuerPeeridHex: Root PKARR Ed25519 public key as hex (64 chars)
    ///   - certIdHex: AppCert identifier as hex (32 chars)
    ///   - contentType: ASCII label describing what is signed
    ///   - payloadHex: Content payload as hex
    ///   - sigHex: Signature to verify as hex (128 chars)
    /// - Returns: Promise resolving to true if valid
    @objc
    func verifyTypedContent(_ appEd25519PubHex: String,
                            issuerPeeridHex: String,
                            certIdHex: String,
                            contentType: String,
                            payloadHex: String,
                            sigHex: String,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let isValid = try NoiseFFI.verifyTypedContent(
                    appEd25519PubHex: appEd25519PubHex,
                    issuerPeeridHex: issuerPeeridHex,
                    certIdHex: certIdHex,
                    contentType: contentType,
                    payloadHex: payloadHex,
                    sigHex: sigHex
                )
                resolve(isValid)
            } catch {
                reject("VERIFY_ERROR", "Failed to verify typed content: \(error.localizedDescription)", error)
            }
        }
    }
    
    /// Compute the inbox_kid for a given inbox public key.
    ///
    /// inbox_kid = SHA256(inbox_pk)[0..16] (first 16 bytes)
    ///
    /// This is used for KeyBinding discovery per PUBKY_CRYPTO_SPEC v2.5.
    ///
    /// - Parameter inboxPkHex: Inbox X25519 public key as hex (64 chars / 32 bytes)
    /// - Returns: Promise resolving to inbox_kid as hex (32 chars / 16 bytes)
    @objc
    func computeInboxKid(_ inboxPkHex: String,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let inboxPk = Data(hexString: inboxPkHex), inboxPk.count == 32 else {
                reject("INVALID_INBOX_PK", "Inbox public key must be 32 bytes", nil)
                return
            }
            
            // SHA256(inbox_pk)[0..16]
            let hash = SHA256.hash(data: inboxPk)
            let hashData = Data(hash)
            let kid = hashData.prefix(16)
            resolve(kid.hexString)
        }
    }
    
    // MARK: - SB2 Binary Wire Format (PUBKY_CRYPTO_SPEC v2.5 Section 7.2)
    
    /// Check if data starts with SB2 magic bytes ("SB2")
    @objc(sb2IsSb2:resolver:rejecter:)
    func sb2IsSb2(
        _ dataBase64: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let data = Data(base64Encoded: dataBase64) else {
            reject("INVALID_DATA", "Data must be valid base64", nil)
            return
        }
        let isSb2 = NoiseFFI.sb2IsSb2(data: data)
        resolve(isSb2)
    }
    
    /// Encrypt plaintext to SB2 binary format
    @objc(sb2Encrypt:plaintextHex:contextIdHex:msgId:purpose:ownerPeeridHex:senderPeeridHex:recipientPeeridHex:canonicalPath:createdAt:expiresAt:certIdHex:resolver:rejecter:)
    func sb2Encrypt(
        _ recipientInboxPkHex: String,
        plaintextHex: String,
        contextIdHex: String,
        msgId: String?,
        purpose: String?,
        ownerPeeridHex: String,
        senderPeeridHex: String,
        recipientPeeridHex: String,
        canonicalPath: String,
        createdAt: NSNumber?,
        expiresAt: NSNumber?,
        certIdHex: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let recipientInboxPk = Data(hexString: recipientInboxPkHex), recipientInboxPk.count == 32 else {
                reject("INVALID_RECIPIENT_PK", "Recipient inbox public key must be 32 bytes", nil)
                return
            }
            guard let plaintext = Data(hexString: plaintextHex) else {
                reject("INVALID_PLAINTEXT", "Plaintext must be valid hex", nil)
                return
            }
            guard let contextId = Data(hexString: contextIdHex), contextId.count == 32 else {
                reject("INVALID_CONTEXT_ID", "Context ID must be 32 bytes", nil)
                return
            }
            guard let ownerPeerid = Data(hexString: ownerPeeridHex), ownerPeerid.count == 32 else {
                reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes", nil)
                return
            }
            guard let senderPeerid = Data(hexString: senderPeeridHex), senderPeerid.count == 32 else {
                reject("INVALID_SENDER_PEERID", "Sender peerid must be 32 bytes", nil)
                return
            }
            guard let recipientPeerid = Data(hexString: recipientPeeridHex), recipientPeerid.count == 32 else {
                reject("INVALID_RECIPIENT_PEERID", "Recipient peerid must be 32 bytes", nil)
                return
            }
            
            var certId: Data? = nil
            if let certIdHex = certIdHex {
                guard let cid = Data(hexString: certIdHex), cid.count == 16 else {
                    reject("INVALID_CERT_ID", "Cert ID must be 16 bytes", nil)
                    return
                }
                certId = cid
            }
            
            do {
                let envelope = try NoiseFFI.sb2Encrypt(
                    recipientInboxPk: recipientInboxPk,
                    plaintext: plaintext,
                    contextId: contextId,
                    msgId: msgId,
                    purpose: purpose,
                    ownerPeerid: ownerPeerid,
                    senderPeerid: senderPeerid,
                    recipientPeerid: recipientPeerid,
                    canonicalPath: canonicalPath,
                    createdAt: createdAt?.uint64Value,
                    expiresAt: expiresAt?.uint64Value,
                    certId: certId
                )
                resolve(envelope.base64EncodedString())
            } catch {
                reject("SB2_ENCRYPT_ERROR", "Failed to encrypt SB2: \(error)", error)
            }
        }
    }
    
    /// Decrypt an SB2 binary envelope
    @objc(sb2Decrypt:recipientInboxSkHex:ownerPeeridHex:canonicalPath:resolver:rejecter:)
    func sb2Decrypt(
        _ envelopeBase64: String,
        recipientInboxSkHex: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let envelope = Data(base64Encoded: envelopeBase64) else {
                reject("INVALID_ENVELOPE", "Envelope must be valid base64", nil)
                return
            }
            guard let recipientInboxSk = Data(hexString: recipientInboxSkHex), recipientInboxSk.count == 32 else {
                reject("INVALID_SECRET_KEY", "Recipient inbox secret key must be 32 bytes", nil)
                return
            }
            guard let ownerPeerid = Data(hexString: ownerPeeridHex), ownerPeerid.count == 32 else {
                reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes", nil)
                return
            }
            
            do {
                let result = try NoiseFFI.sb2Decrypt(
                    envelopeBytes: envelope,
                    recipientInboxSk: recipientInboxSk,
                    ownerPeerid: ownerPeerid,
                    canonicalPath: canonicalPath
                )
                
                let header: [String: Any?] = [
                    "contextIdHex": result.header.contextIdHex,
                    "createdAt": result.header.createdAt,
                    "expiresAt": result.header.expiresAt,
                    "inboxKidHex": result.header.inboxKidHex,
                    "msgId": result.header.msgId,
                    "nonceHex": result.header.nonceHex,
                    "purpose": result.header.purpose,
                    "recipientPeeridHex": result.header.recipientPeeridHex,
                    "senderEphemeralPubHex": result.header.senderEphemeralPubHex,
                    "senderPeeridHex": result.header.senderPeeridHex,
                    "sigHex": result.header.sigHex,
                    "certIdHex": result.header.certIdHex
                ]
                
                resolve([
                    "header": header,
                    "plaintext": result.plaintext.hexString
                ])
            } catch {
                reject("SB2_DECRYPT_ERROR", "Failed to decrypt SB2: \(error)", error)
            }
        }
    }
    
    /// Sign an SB2 envelope with sender's Ed25519 private key
    @objc(sb2Sign:senderEd25519SkHex:ownerPeeridHex:canonicalPath:resolver:rejecter:)
    func sb2Sign(
        _ envelopeBase64: String,
        senderEd25519SkHex: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let envelope = Data(base64Encoded: envelopeBase64) else {
                reject("INVALID_ENVELOPE", "Envelope must be valid base64", nil)
                return
            }
            guard let senderSk = Data(hexString: senderEd25519SkHex), senderSk.count == 32 else {
                reject("INVALID_SECRET_KEY", "Sender Ed25519 secret key must be 32 bytes", nil)
                return
            }
            guard let ownerPeerid = Data(hexString: ownerPeeridHex), ownerPeerid.count == 32 else {
                reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes", nil)
                return
            }
            
            do {
                let signedEnvelope = try NoiseFFI.sb2Sign(
                    envelopeBytes: envelope,
                    senderEd25519Sk: senderSk,
                    ownerPeerid: ownerPeerid,
                    canonicalPath: canonicalPath
                )
                resolve(signedEnvelope.base64EncodedString())
            } catch {
                reject("SB2_SIGN_ERROR", "Failed to sign SB2: \(error)", error)
            }
        }
    }
    
    /// Verify the signature on an SB2 envelope
    @objc(sb2VerifySignature:ownerPeeridHex:canonicalPath:resolver:rejecter:)
    func sb2VerifySignature(
        _ envelopeBase64: String,
        ownerPeeridHex: String,
        canonicalPath: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let envelope = Data(base64Encoded: envelopeBase64) else {
                reject("INVALID_ENVELOPE", "Envelope must be valid base64", nil)
                return
            }
            guard let ownerPeerid = Data(hexString: ownerPeeridHex), ownerPeerid.count == 32 else {
                reject("INVALID_OWNER_PEERID", "Owner peerid must be 32 bytes", nil)
                return
            }
            
            do {
                let isValid = try NoiseFFI.sb2VerifySignature(
                    envelopeBytes: envelope,
                    ownerPeerid: ownerPeerid,
                    canonicalPath: canonicalPath
                )
                resolve(isValid)
            } catch {
                reject("SB2_VERIFY_ERROR", "Failed to verify SB2 signature: \(error)", error)
            }
        }
    }
    
    /// Decode an SB2 envelope and return its header without decrypting
    @objc(sb2DecodeHeader:resolver:rejecter:)
    func sb2DecodeHeader(
        _ envelopeBase64: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let envelope = Data(base64Encoded: envelopeBase64) else {
                reject("INVALID_ENVELOPE", "Envelope must be valid base64", nil)
                return
            }
            
            do {
                let header = try NoiseFFI.sb2DecodeHeader(envelopeBytes: envelope)
                
                let result: [String: Any?] = [
                    "contextIdHex": header.contextIdHex,
                    "createdAt": header.createdAt,
                    "expiresAt": header.expiresAt,
                    "inboxKidHex": header.inboxKidHex,
                    "msgId": header.msgId,
                    "nonceHex": header.nonceHex,
                    "purpose": header.purpose,
                    "recipientPeeridHex": header.recipientPeeridHex,
                    "senderEphemeralPubHex": header.senderEphemeralPubHex,
                    "senderPeeridHex": header.senderPeeridHex,
                    "sigHex": header.sigHex,
                    "certIdHex": header.certIdHex
                ]
                resolve(result)
            } catch {
                reject("SB2_DECODE_ERROR", "Failed to decode SB2 header: \(error)", error)
            }
        }
    }
    
    /// Generate a random 32-byte context ID for new conversation threads
    @objc(sb2GenerateContextId:rejecter:)
    func sb2GenerateContextId(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let contextId = NoiseFFI.sb2GenerateContextId()
        resolve(contextId.hexString)
    }
    
    // MARK: - Private Helpers
    
    private func getConfig(_ configType: String) -> FfiMobileConfig {
        switch configType {
        case "batterySaver":
            return batterySaverConfig()
        case "performance":
            return performanceConfig()
        default:
            return defaultConfig()
        }
    }
    
    private func statusToString(_ status: FfiConnectionStatus) -> String {
        switch status {
        case .connected:
            return "connected"
        case .reconnecting:
            return "reconnecting"
        case .disconnected:
            return "disconnected"
        case .error:
            return "error"
        }
    }
}

// MARK: - Noise Manager Registry

/// Thread-safe registry for noise managers
class NoiseManagerRegistry {
    static let shared = NoiseManagerRegistry()
    
    private var managers: [String: FfiNoiseManager] = [:]
    private let lock = NSLock()
    
    private init() {}
    
    func register(_ manager: FfiNoiseManager) -> String {
        lock.lock()
        defer { lock.unlock() }
        
        let id = UUID().uuidString
        managers[id] = manager
        return id
    }
    
    func get(_ id: String) -> FfiNoiseManager? {
        lock.lock()
        defer { lock.unlock() }
        return managers[id]
    }
    
    func remove(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        managers.removeValue(forKey: id)
    }
}

// MARK: - Data Extensions

extension Data {
    init?(hexString: String) {
        let hex = hexString.replacingOccurrences(of: " ", with: "")
        guard hex.count % 2 == 0 else { return nil }
        
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else { return nil }
            data.append(byte)
            index = nextIndex
        }
        
        self = data
    }
    
    var hexString: String {
        return map { String(format: "%02x", $0) }.joined()
    }
}
