import CryptoKit
import Foundation
import os
import React
import Security

private let paykitLinkLog = Logger(subsystem: "com.hypercolor", category: "PaykitLink")

struct PaykitLinkBridgeError: Error {
    let code: String
    let message: String
}

/// File-level wrappers so the RCT method names do not shadow the UniFFI free functions.
private enum PaykitAttachmentAead {
    static func generateKey() -> String {
        generateAttachmentKey()
    }

    static func encrypt(plaintextB64: String, keyB64: String, aad: String?) throws -> AttachmentCiphertext {
        try attachmentEncrypt(plaintextB64: plaintextB64, keyB64: keyB64, aad: aad)
    }

    static func decrypt(ciphertextB64: String, keyB64: String, nonceB64: String, aad: String?) throws -> String {
        try attachmentDecrypt(
            ciphertextB64: ciphertextB64,
            keyB64: keyB64,
            nonceB64: nonceB64,
            aad: aad
        )
    }
}

@objc(PaykitLinkModule)
class PaykitLinkModule: NSObject, RCTInvalidating {
    private let lock = NSLock()
    private var client: ChatClient?
    private var sessions: [String: ChatSession] = [:]
    private var flows: [String: ChatAuthFlow] = [:]
    /// Mirrors `AuthFlowCancelRegistry` cancelled tombstones.
    private var cancelledFlowIds: [String: CancelledTombstone] = [:]
    private var surfacedFlowIds = Set<String>()
    /// reserved(lease): admitted owner, not yet inside `awaitApproval`.
    private var reservedFlowIds = Set<String>()
    /// awaiting(lease): owner is inside the non-abortable FFI wait.
    private var awaitingFlowIds = Set<String>()
    /// committing(lease): FFI returned; persist + JS resolve run while
    /// `lock` is held so `teardownNativeAuthState` cannot interleave.
    private var committingFlowIds = Set<String>()
    private var awaitLeases: [String: UInt64] = [:]
    private var awaitTasks: [String: Task<Void, Never>] = [:]
    private var leaseSeq: UInt64 = 0
    private var handles: [String: LinkHandle] = [:]
    /// Sticky after `invalidate()` / `deinit`. Start/await/cancel reject
    /// `unavailable`. In-flight owners fail closed and never persist.
    private var bridgeTornDown = false

    /// Kotlin `AuthFlowCancelRegistry` cancelled map: `null` lease = no owner.
    private enum CancelledTombstone {
        case noOwner
        case owner(UInt64)
    }

    @objc static func requiresMainQueueSetup() -> Bool { false }

    /// RN 0.81.5 `RCTCxxBridge` calls `-invalidate` on modules that respond
    /// to the selector (`RCTInvalidating`). Idempotent with `deinit`.
    @objc func invalidate() {
        teardownNativeAuthState()
    }

    deinit {
        teardownNativeAuthState()
    }

    // MARK: - Receiver keys

    @objc func generateReceiverKey(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let secret = generateReceiverNoiseSecretKeyHex()
            let publicKey = try receiverNoisePublicKeyFromSecretHex(secretKeyHex: secret)
            let alias = UUID().uuidString.lowercased()
            try PaykitLinkStore.put(secret, account: PaykitLinkStore.receiverAccount(alias))
            return [
                "receiverAlias": alias,
                "noisePublicKey": publicKey,
            ]
        }
    }

    @objc func getReceiverPublicKey(
        _ receiverAlias: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let secret = try self.receiverSecret(receiverAlias)
            return try receiverNoisePublicKeyFromSecretHex(secretKeyHex: secret)
        }
    }

    // MARK: - Auth / session

    @objc func startAuthFlow(
        _ capabilities: String,
        relayUrl: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let caps = try Self.canonicalizeCapabilities(
                try Self.requireText(capabilities, name: "capabilities")
            )
            let relay = Self.optionalText(relayUrl)
            let flow = try await self.chatClient().startAuthFlow(capabilities: caps, relayUrl: relay)
            let flowId = UUID().uuidString.lowercased()
            try self.lock.withLock {
                if self.bridgeTornDown {
                    throw PaykitLinkBridgeError(
                        code: "unavailable",
                        message: Self.staticMessage("unavailable")
                    )
                }
                self.flows[flowId] = flow
            }
            return [
                "flowId": flowId,
                "authorizationUrl": flow.authorizationUrl(),
            ]
        }
    }

    @objc func awaitAuthApproval(
        _ flowId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        lock.lock()
        // Admission is atomic under this lock (Kotlin `startAwait`):
        // tornDown → unavailable; idle → reserved(lease); reserved/awaiting/
        // committing/cancelled-with-owner → validation "already awaiting";
        // cancelled-no-owner → this caller prunes and rejects
        // auth_flow_cancelled; missing/surfaced → validation. A task is
        // created only for an accepted owner. The task must not strongly
        // retain self across the non-abortable FFI wait: invalidate/deinit
        // has to mark cancelled-owner(lease) so post-FFI fails closed and
        // never persistSession. Persist+resolve are one lock-held commit
        // (`completeApprovedAwait`). Never overwrite awaitTasks[id].
        if bridgeTornDown {
            lock.unlock()
            reject("unavailable", Self.staticMessage("unavailable"), nil)
            return
        }
        let trimmed = flowId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            lock.unlock()
            reject("validation", "flowId is required", nil)
            return
        }
        if surfacedFlowIds.contains(trimmed) {
            lock.unlock()
            reject("validation", "unknown auth flow", nil)
            return
        }
        if let tombstone = cancelledFlowIds[trimmed] {
            switch tombstone {
            case .owner:
                lock.unlock()
                reject("validation", "already awaiting", nil)
                return
            case .noOwner:
                cancelledFlowIds.removeValue(forKey: trimmed)
                lock.unlock()
                reject(
                    "auth_flow_cancelled",
                    Self.staticMessage("auth_flow_cancelled"),
                    nil
                )
                return
            }
        }
        if reservedFlowIds.contains(trimmed)
            || awaitingFlowIds.contains(trimmed)
            || committingFlowIds.contains(trimmed)
            || awaitTasks[trimmed] != nil
            || awaitLeases[trimmed] != nil
        {
            lock.unlock()
            reject("validation", "already awaiting", nil)
            return
        }
        guard let flow = flows[trimmed] else {
            lock.unlock()
            reject("validation", "unknown auth flow", nil)
            return
        }
        leaseSeq += 1
        let lease = leaseSeq
        let id = trimmed
        reservedFlowIds.insert(id)
        awaitLeases[id] = lease
        let task = Task.detached(priority: .userInitiated) { [weak self] in
            defer { self?.finishAwait(id, lease: lease) }
            do {
                try Self.requireModule(self).enterAwaiting(id: id, lease: lease)
                try Task.checkCancellation()
                let session = try await flow.awaitApproval()
                try Self.requireModule(self).completeApprovedAwait(
                    id: id,
                    lease: lease,
                    session: session,
                    resolve: resolve
                )
            } catch {
                let mapped = self?.mapAwaitError(error) ?? PaykitLinkBridgeError(
                    code: "unavailable",
                    message: PaykitLinkModule.staticMessage("unavailable")
                )
                reject(mapped.code, mapped.message, nil)
            }
        }
        awaitTasks[id] = task
        lock.unlock()
    }

    @objc func stopAuthKeepalive(
        _ flowId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            _ = try Self.requireText(flowId, name: "flowId")
            return NSNull()
        }
    }

    /// Paykit FFI has no auth-flow cancel primitive. Native discard: cancel
    /// the in-flight Task and drop a not-yet-awaited ChatAuthFlow so its
    /// relay subscription stops. A wait already spawned by `awaitApproval`
    /// runs to completion inside Paykit and cannot be aborted; after that
    /// FFI await returns, the local flow is released so the poll can stop.
    /// Marks `flowId` so a later await rejects `auth_flow_cancelled`.
    /// Unknown ids and a second cancel are no-ops. Already-surfaced
    /// approvals are left untouched. After `invalidate()`, rejects
    /// `unavailable`. Idle flows are dropped here (ARC close); an admitted
    /// owner releases its handle after FFI settles.
    @objc func cancelAuthFlow(
        _ flowId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let id = try Self.requireText(flowId, name: "flowId")
            let task = try self.lock.withLock { () -> Task<Void, Never>? in
                // tornDown → unavailable. Unknown/consumed ids must not be
                // tombstoned. A stale awaitTasks handle would make the next
                // await auth_flow_cancelled instead of validation (P2-1).
                if self.bridgeTornDown {
                    throw PaykitLinkBridgeError(
                        code: "unavailable",
                        message: Self.staticMessage("unavailable")
                    )
                }
                if self.surfacedFlowIds.contains(id) || self.committingFlowIds.contains(id) {
                    // Committing holds this lock during persist+resolve, so
                    // this branch is the already-adopted case after unlock.
                    return nil
                }
                if self.cancelledFlowIds[id] != nil {
                    return nil
                }
                let hasFlow = self.flows[id] != nil
                let hasOwner = self.awaitLeases[id] != nil
                    || self.reservedFlowIds.contains(id)
                    || self.awaitingFlowIds.contains(id)
                    || self.committingFlowIds.contains(id)
                    || self.awaitTasks[id] != nil
                if !hasFlow && !hasOwner {
                    return nil
                }
                if let lease = self.awaitLeases[id] {
                    self.cancelledFlowIds[id] = .owner(lease)
                } else {
                    self.cancelledFlowIds[id] = .noOwner
                }
                self.flows.removeValue(forKey: id)
                self.reservedFlowIds.remove(id)
                self.awaitingFlowIds.remove(id)
                self.committingFlowIds.remove(id)
                return self.awaitTasks.removeValue(forKey: id)
            }
            task?.cancel()
            return NSNull()
        }
    }

    @objc func signinWithSecret(
        _ identitySecretHex: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        #if DEBUG
        runAsync(resolve, reject) {
            let secret = try Self.requireText(identitySecretHex, name: "identitySecretHex")
            let session = try await self.chatClient().signinWithSecret(identitySecretKeyHex: secret)
            return try self.persistSession(session)
        }
        #else
        reject("unavailable", "secret import is disabled in release builds", nil)
        #endif
    }

    @objc func signupWithSecret(
        _ identitySecretHex: String,
        homeserverPublicKey: String,
        signupToken: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        #if DEBUG
        runAsync(resolve, reject) {
            let secret = try Self.requireText(identitySecretHex, name: "identitySecretHex")
            let homeserver = try Self.requireText(homeserverPublicKey, name: "homeserverPublicKey")
            let token = Self.optionalText(signupToken)
            let session = try await self.chatClient().signupWithSecret(
                identitySecretKeyHex: secret,
                homeserverPublicKey: homeserver,
                signupToken: token
            )
            return try self.persistSession(session)
        }
        #else
        reject("unavailable", "secret import is disabled in release builds", nil)
        #endif
    }

    @objc func restoreSession(
        _ sessionAlias: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let session = try await self.session(try Self.requireText(sessionAlias, name: "sessionAlias"))
            return ["pubky": session.pubky()]
        }
    }

    @objc func signOutSession(
        _ sessionAlias: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let alias = try Self.requireText(sessionAlias, name: "sessionAlias")
            self.lock.withLock { self.sessions.removeValue(forKey: alias) }
            try PaykitLinkStore.delete(account: PaykitLinkStore.sessionAccount(alias))
            return NSNull()
        }
    }

    @objc func clearAllNativeSecrets(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            // Sign-out: not sticky teardown. Mirror Android `drainLive`:
            // close idle by dropping the last module ref (ARC); cancel
            // admitted owners and let only the owner task's `defer`
            // `finishAwait` release the UniFFI handle. In-flight await
            // rejects `auth_flow_cancelled` (user discard) and must not
            // persist. Already-adopted sessions are wiped with the store.
            var idleFlows: [ChatAuthFlow] = []
            var ownerTasks: [Task<Void, Never>] = []
            self.lock.withLock {
                self.sessions.removeAll()
                self.handles.removeAll()
                self.client = nil
                self.surfacedFlowIds.removeAll()
                let flowIds = Array(self.flows.keys)
                for id in flowIds {
                    if let lease = self.awaitLeases[id] {
                        self.cancelledFlowIds[id] = .owner(lease)
                        self.reservedFlowIds.remove(id)
                        self.awaitingFlowIds.remove(id)
                        self.committingFlowIds.remove(id)
                        self.flows.removeValue(forKey: id)
                        if let task = self.awaitTasks.removeValue(forKey: id) {
                            ownerTasks.append(task)
                        }
                    } else {
                        if let flow = self.flows.removeValue(forKey: id) {
                            idleFlows.append(flow)
                        }
                    }
                }
                let stale = self.cancelledFlowIds.compactMap { id, tombstone -> String? in
                    if case .noOwner = tombstone { return id }
                    return nil
                }
                for id in stale {
                    self.cancelledFlowIds.removeValue(forKey: id)
                }
            }
            for task in ownerTasks {
                task.cancel()
            }
            withExtendedLifetime(idleFlows) {}
            try PaykitLinkStore.deleteAll()
            return NSNull()
        }
    }

    // MARK: - Markers

    @objc func publishReceiverMarker(
        _ sessionAlias: String,
        receiverAlias: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let session = try await self.session(try Self.requireText(sessionAlias, name: "sessionAlias"))
            let secret = try self.receiverSecret(receiverAlias)
            let publicKey = try receiverNoisePublicKeyFromSecretHex(secretKeyHex: secret)
            let path = try Self.requireText(receiverPath, name: "receiverPath")
            try await session.publishReceiverMarker(
                receiverPath: path,
                noisePublicKey: publicKey,
                capabilities: ChatReceiverCapabilities(
                    privatePayments: true,
                    paymentRequests: false,
                    receipts: false,
                    outgoingPayments: false
                )
            )
            return NSNull()
        }
    }

    @objc func getReceiverMarker(
        _ peerPubky: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let peer = try Self.requireText(peerPubky, name: "peerPubky")
            let path = try Self.requireText(receiverPath, name: "receiverPath")
            do {
                guard let marker = try await self.chatClient().getReceiverMarker(
                    ownerPublicKey: peer,
                    receiverPath: path
                ) else {
                    return NSNull()
                }
                return [
                    "noisePublicKey": marker.noisePublicKey,
                    "capabilitiesJson": try Self.capabilitiesJson(marker.capabilities),
                ]
            } catch {
                if Self.paykitCode(error) == "not_found" {
                    return NSNull()
                }
                throw error
            }
        }
    }

    @objc func removeReceiverMarker(
        _ sessionAlias: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let session = try await self.session(try Self.requireText(sessionAlias, name: "sessionAlias"))
            try await session.removeReceiverMarker(receiverPath: try Self.requireText(receiverPath, name: "receiverPath"))
            return NSNull()
        }
    }

    @objc func putPublic(
        _ sessionAlias: String,
        url: String,
        content: String,
        homeserverOrigin: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let session = try await self.session(try Self.requireText(sessionAlias, name: "sessionAlias"))
            try await self.writePublic(
                session: session,
                url: try Self.requireText(url, name: "url"),
                content: content,
                origin: try Self.requireText(homeserverOrigin, name: "homeserverOrigin"),
                method: "PUT"
            )
            return NSNull()
        }
    }

    @objc func deletePublic(
        _ sessionAlias: String,
        url: String,
        homeserverOrigin: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let session = try await self.session(try Self.requireText(sessionAlias, name: "sessionAlias"))
            try await self.writePublic(
                session: session,
                url: try Self.requireText(url, name: "url"),
                content: nil,
                origin: try Self.requireText(homeserverOrigin, name: "homeserverOrigin"),
                method: "DELETE"
            )
            return NSNull()
        }
    }

    // MARK: - Links

    @objc func initiateLink(
        _ sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let args = try await self.linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath
            )
            let handshake = try args.session.initiateEncryptedLink(
                senderNoiseSecretKeyHex: args.receiverSecret,
                receiverPublicKey: args.peerPubky,
                receiverNoisePublicKey: args.peerNoisePublicKey,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath
            )
            let context = SnapshotContext(
                ownerPubky: args.session.pubky(),
                peerPubky: args.peerPubky,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath,
                role: .initiator
            )
            let linkId = UUID().uuidString.lowercased()
            self.lock.withLock {
                self.handles[linkId] = LinkHandle(kind: .handshake(handshake), context: context)
            }
            let snapshot = try await handshake.snapshot()
            return [
                "linkId": linkId,
                "snapshot": try PaykitSnapshotAead.encrypt(snapshot, context: context),
            ]
        }
    }

    @objc func probeInboundLink(
        _ sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let args = try await self.linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath
            )
            let probed = try await args.session.probeInboundEncryptedLink(
                receiverNoiseSecretKeyHex: args.receiverSecret,
                senderPublicKey: args.peerPubky,
                senderNoisePublicKey: args.peerNoisePublicKey,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath
            )
            switch probed {
            case .noInbound:
                return ["result": "none"]
            case let .pending(handshake):
                let context = SnapshotContext(
                    ownerPubky: args.session.pubky(),
                    peerPubky: args.peerPubky,
                    localReceiverPath: args.localReceiverPath,
                    remoteReceiverPath: args.remoteReceiverPath,
                    role: .responder
                )
                let linkId = UUID().uuidString.lowercased()
                self.lock.withLock {
                    self.handles[linkId] = LinkHandle(kind: .handshake(handshake), context: context)
                }
                let snapshot = try await handshake.snapshot()
                return [
                    "result": "pending",
                    "linkId": linkId,
                    "snapshot": try PaykitSnapshotAead.encrypt(snapshot, context: context),
                ]
            case let .established(link):
                let context = SnapshotContext(
                    ownerPubky: args.session.pubky(),
                    peerPubky: args.peerPubky,
                    localReceiverPath: args.localReceiverPath,
                    remoteReceiverPath: args.remoteReceiverPath,
                    role: .link
                )
                let linkId = UUID().uuidString.lowercased()
                self.lock.withLock {
                    self.handles[linkId] = LinkHandle(kind: .link(link), context: context)
                }
                let snapshot = try await link.snapshot()
                return [
                    "result": "established",
                    "linkId": linkId,
                    "snapshot": try PaykitSnapshotAead.encrypt(snapshot, context: context),
                ]
            }
        }
    }

    @objc func advanceHandshake(
        _ linkId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let id = try Self.requireText(linkId, name: "linkId")
            let handle = try self.handle(id)
            guard case let .handshake(handshake) = handle.kind else {
                throw PaykitLinkBridgeError(code: "validation", message: "linkId is not a handshake")
            }
            let step = try await handshake.advance()
            if step.complete, let link = step.link {
                var context = handle.context
                context.role = .link
                self.lock.withLock {
                    self.handles[id] = LinkHandle(kind: .link(link), context: context)
                }
                let snapshot = try await link.snapshot()
                return [
                    "status": "established",
                    "snapshot": try PaykitSnapshotAead.encrypt(snapshot, context: context),
                ]
            }
            let snapshot = try await handshake.snapshot()
            return [
                "status": "pending",
                "snapshot": try PaykitSnapshotAead.encrypt(snapshot, context: handle.context),
            ]
        }
    }

    @objc func restoreHandshake(
        _ sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        snapshot: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let args = try await self.linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath
            )
            let cipher = try Self.requireText(snapshot, name: "snapshot")
            let restored = try PaykitSnapshotAead.decryptHandshake(
                cipher,
                ownerPubky: args.session.pubky(),
                peerPubky: args.peerPubky,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath
            )
            let handshake = try await args.session.restoreEncryptedLinkHandshake(
                noiseSecretKeyHex: args.receiverSecret,
                remotePublicKey: args.peerPubky,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath,
                snapshotJson: restored.plaintext
            )
            let context = SnapshotContext(
                ownerPubky: args.session.pubky(),
                peerPubky: args.peerPubky,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath,
                role: restored.role
            )
            let linkId = UUID().uuidString.lowercased()
            self.lock.withLock {
                self.handles[linkId] = LinkHandle(kind: .handshake(handshake), context: context)
            }
            return [
                "linkId": linkId,
                "status": "pending",
            ]
        }
    }

    @objc func restoreLink(
        _ sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        snapshot: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let args = try await self.linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath
            )
            let context = SnapshotContext(
                ownerPubky: args.session.pubky(),
                peerPubky: args.peerPubky,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath,
                role: .link
            )
            let plaintext = try PaykitSnapshotAead.decrypt(
                try Self.requireText(snapshot, name: "snapshot"),
                context: context
            )
            let link = try await args.session.restoreEncryptedLink(
                noiseSecretKeyHex: args.receiverSecret,
                remotePublicKey: args.peerPubky,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath,
                snapshotJson: plaintext
            )
            let linkId = UUID().uuidString.lowercased()
            self.lock.withLock {
                self.handles[linkId] = LinkHandle(kind: .link(link), context: context)
            }
            return ["linkId": linkId]
        }
    }

    @objc func sendPrivateMessageJson(
        _ linkId: String,
        rawJson: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let handle = try self.handle(try Self.requireText(linkId, name: "linkId"))
            guard case let .link(link) = handle.kind else {
                throw PaykitLinkBridgeError(code: "validation", message: "linkId is not an established link")
            }
            try await link.sendPrivateApplicationMessageJson(rawJson: try Self.requireText(rawJson, name: "rawJson"))
            let snapshot = try await link.snapshot()
            return ["snapshot": try PaykitSnapshotAead.encrypt(snapshot, context: handle.context.asLink())]
        }
    }

    @objc func receivePrivateMessages(
        _ linkId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let handle = try self.handle(try Self.requireText(linkId, name: "linkId"))
            guard case let .link(link) = handle.kind else {
                throw PaykitLinkBridgeError(code: "validation", message: "linkId is not an established link")
            }
            let inbound = try await link.receivePrivateApplicationMessages()
            let snapshot = try await link.snapshot()
            let messages: [[String: Any]] = inbound.map { message in
                var row: [String: Any] = ["rawJson": message.rawJson]
                if let version = message.version {
                    row["version"] = Int(version)
                } else {
                    row["version"] = NSNull()
                }
                row["kind"] = message.kind ?? NSNull()
                return row
            }
            return [
                "messages": messages,
                "snapshot": try PaykitSnapshotAead.encrypt(snapshot, context: handle.context.asLink()),
            ]
        }
    }

    @objc func clearLinkOutbox(
        _ sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let args = try await self.linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath
            )
            let deleted = try await args.session.clearEncryptedLinkOutbox(
                localNoiseSecretKeyHex: args.receiverSecret,
                remotePublicKey: args.peerPubky,
                remoteNoisePublicKey: args.peerNoisePublicKey,
                localReceiverPath: args.localReceiverPath,
                remoteReceiverPath: args.remoteReceiverPath
            )
            return NSNumber(value: deleted)
        }
    }

    @objc func closeLink(
        _ linkId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let id = try Self.requireText(linkId, name: "linkId")
            let handle = self.lock.withLock { self.handles.removeValue(forKey: id) }
            if case let .link(link) = handle?.kind {
                try await link.closeLink()
            }
            return NSNull()
        }
    }

    // MARK: - Attachment AEAD (free UniFFI functions)

    @objc func generateAttachmentKey(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            PaykitAttachmentAead.generateKey()
        }
    }

    @objc func attachmentEncrypt(
        _ plaintextB64: String,
        keyB64: String,
        aad: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let plaintext = try Self.requireText(plaintextB64, name: "plaintextB64")
            let key = try Self.requireText(keyB64, name: "keyB64")
            let boundAad = Self.optionalText(aad)
            let sealed = try PaykitAttachmentAead.encrypt(
                plaintextB64: plaintext,
                keyB64: key,
                aad: boundAad
            )
            return [
                "nonceB64": sealed.nonceB64,
                "ciphertextB64": sealed.ciphertextB64,
                "algorithm": sealed.algorithm,
            ]
        }
    }

    @objc func attachmentDecrypt(
        _ ciphertextB64: String,
        keyB64: String,
        nonceB64: String,
        aad: Any?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        runAsync(resolve, reject) {
            let ciphertext = try Self.requireText(ciphertextB64, name: "ciphertextB64")
            let key = try Self.requireText(keyB64, name: "keyB64")
            let nonce = try Self.requireText(nonceB64, name: "nonceB64")
            let boundAad = Self.optionalText(aad)
            return try PaykitAttachmentAead.decrypt(
                ciphertextB64: ciphertext,
                keyB64: key,
                nonceB64: nonce,
                aad: boundAad
            )
        }
    }

    // MARK: - Internals

    /// Teardown state machine (every mutation of flows / cancelled /
    /// reserved / awaiting / committing / leases / tasks / `bridgeTornDown`
    /// is under `lock`; never `await` while holding it):
    /// - live --invalidate/deinit--> tornDown (sticky)
    /// - reserved/awaiting/committing owners: cancelled-owner(lease);
    ///   owner metadata stays until that owner's `finishAwait` (never persist)
    /// - idle flows: dropped under lock, released after unlock (UniFFI close)
    /// - awaitTasks detached then cancelled **outside** the lock
    /// - in-flight owner rejects `unavailable` (not `auth_flow_cancelled`)
    /// - later start/await/cancel reject `unavailable` immediately
    ///
    /// Persist+resolve run under this same lock in `completeApprovedAwait`,
    /// so a commit that already adopted JS cannot be rolled back here
    /// (id is already in `surfacedFlowIds`, absent from `flows`). A commit
    /// that has not yet taken the lock fails closed and never writes.
    private func teardownNativeAuthState() {
        lock.lock()
        let alreadyTornDown = bridgeTornDown
        bridgeTornDown = true
        let tasks = Array(awaitTasks.values)
        awaitTasks.removeAll()
        var idleFlows: [ChatAuthFlow] = []
        if !alreadyTornDown {
            for (id, lease) in awaitLeases {
                cancelledFlowIds[id] = .owner(lease)
                reservedFlowIds.remove(id)
                awaitingFlowIds.remove(id)
                committingFlowIds.remove(id)
                flows.removeValue(forKey: id)
            }
            idleFlows = Array(flows.values)
            flows.removeAll()
        }
        lock.unlock()
        for task in tasks {
            task.cancel()
        }
        withExtendedLifetime(idleFlows) {}
    }

    private static func requireModule(_ module: PaykitLinkModule?) throws -> PaykitLinkModule {
        guard let module else {
            throw PaykitLinkBridgeError(code: "unavailable", message: staticMessage("unavailable"))
        }
        return module
    }

    private func failClosedAwaitErrorLocked() -> PaykitLinkBridgeError {
        if bridgeTornDown {
            return PaykitLinkBridgeError(code: "unavailable", message: Self.staticMessage("unavailable"))
        }
        return PaykitLinkBridgeError(
            code: "auth_flow_cancelled",
            message: Self.staticMessage("auth_flow_cancelled")
        )
    }

    private func enterAwaiting(id: String, lease: UInt64) throws {
        try lock.withLock {
            // reserved(lease) → awaiting(lease). Fail closed if this wait
            // was tombstoned or the bridge torn down before FFI; do not
            // persist and do not prune here — finishAwait is the owner prune.
            if bridgeTornDown || cancelledFlowIds[id] != nil || awaitLeases[id] != lease {
                throw failClosedAwaitErrorLocked()
            }
            reservedFlowIds.remove(id)
            awaitingFlowIds.insert(id)
        }
    }

    private func completeApprovedAwait(
        id: String,
        lease: UInt64,
        session: ChatSession,
        resolve: @escaping RCTPromiseResolveBlock
    ) throws {
        try lock.withLock {
            // Linearized with `teardownNativeAuthState` on this same lock
            // (Kotlin `commitApproval`):
            // 1. Fail closed if tornDown / tombstone / lease mismatch —
            //    no Keychain write, no JS resolve.
            // 2. Else awaiting(lease) → committing(lease). Slot stays
            //    teardown-visible until persist+resolve return.
            // 3. persistSessionLocked (Keychain + sessions[]) then
            //    resolve(value) BEFORE unlock. Teardown waiting on this
            //    lock either ran first (this throws unavailable) or runs
            //    after (JS already adopted; teardown must not roll back).
            // 4. Exact-once UniFFI close remains the owner task defer /
            //    Android `finally` — not this method.
            if bridgeTornDown || cancelledFlowIds[id] != nil || awaitLeases[id] != lease {
                throw failClosedAwaitErrorLocked()
            }
            awaitingFlowIds.remove(id)
            reservedFlowIds.remove(id)
            committingFlowIds.insert(id)
            let value: [String: String]
            do {
                value = try persistSessionLocked(session)
            } catch {
                committingFlowIds.remove(id)
                throw error
            }
            surfacedFlowIds.insert(id)
            committingFlowIds.remove(id)
            flows.removeValue(forKey: id)
            awaitTasks.removeValue(forKey: id)
            resolve(value)
        }
    }

    private func mapAwaitError(_ error: Error) -> PaykitLinkBridgeError {
        if let bridge = error as? PaykitLinkBridgeError {
            return bridge
        }
        if error is CancellationError {
            return lock.withLock { failClosedAwaitErrorLocked() }
        }
        return Self.mapError(error)
    }

    private func finishAwait(_ id: String, lease: UInt64) {
        lock.withLock {
            // Owner-only prune. A mismatched lease is a no-op, so a
            // duplicate can never consume this id's tombstone or surfaced
            // flag (Kotlin `finishAwait(id, lease)`). Teardown must not
            // clear this metadata before this call.
            let leaseMatches = awaitLeases[id] == lease
            let cancelledOwnerMatches: Bool
            if case .owner(let owner) = cancelledFlowIds[id], owner == lease {
                cancelledOwnerMatches = true
            } else {
                cancelledOwnerMatches = false
            }
            guard leaseMatches || cancelledOwnerMatches else {
                return
            }
            cancelledFlowIds.removeValue(forKey: id)
            surfacedFlowIds.remove(id)
            reservedFlowIds.remove(id)
            awaitingFlowIds.remove(id)
            committingFlowIds.remove(id)
            awaitLeases.removeValue(forKey: id)
            awaitTasks.removeValue(forKey: id)
            flows.removeValue(forKey: id)
        }
    }

    private func runAsync(
        _ resolve: @escaping RCTPromiseResolveBlock,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ body: @escaping () async throws -> Any
    ) {
        Task.detached(priority: .userInitiated) {
            do {
                let value = try await body()
                resolve(value)
            } catch {
                let mapped = Self.mapError(error)
                reject(mapped.code, mapped.message, nil)
            }
        }
    }

    private func chatClient() throws -> ChatClient {
        if let client = lock.withLock({ self.client }) {
            return client
        }
        let created = try ChatClient()
        return lock.withLock {
            if let client = self.client {
                return client
            }
            self.client = created
            return created
        }
    }

    private func persistSession(_ session: ChatSession) throws -> [String: String] {
        let prepared = try preparePersistedSession(session)
        lock.withLock { sessions[prepared.alias] = session }
        return prepared.value
    }

    /// Caller holds `lock`. Keychain write + in-memory insert. A thrown
    /// Keychain put is rolled back before this returns; the committer
    /// must not surface or resolve.
    private func persistSessionLocked(_ session: ChatSession) throws -> [String: String] {
        let prepared = try preparePersistedSession(session)
        sessions[prepared.alias] = session
        return prepared.value
    }

    private func preparePersistedSession(_ session: ChatSession) throws -> (alias: String, value: [String: String]) {
        let alias = UUID().uuidString.lowercased()
        do {
            try PaykitLinkStore.put(session.exportSession(), account: PaykitLinkStore.sessionAccount(alias))
        } catch {
            try? PaykitLinkStore.delete(account: PaykitLinkStore.sessionAccount(alias))
            throw error
        }
        return (
            alias,
            [
                "sessionAlias": alias,
                "pubky": session.pubky(),
            ]
        )
    }

    private func session(_ alias: String) async throws -> ChatSession {
        if let live = lock.withLock({ sessions[alias] }) {
            return live
        }
        guard let bearer = try PaykitLinkStore.getString(account: PaykitLinkStore.sessionAccount(alias)),
              !bearer.isEmpty
        else {
            throw PaykitLinkBridgeError(code: "auth", message: "session alias not found")
        }
        let restored = try await chatClient().restoreSession(exportedSession: bearer)
        let rotated = restored.exportSession()
        try PaykitLinkStore.put(rotated, account: PaykitLinkStore.sessionAccount(alias))
        lock.withLock { sessions[alias] = restored }
        return restored
    }

    private func receiverSecret(_ alias: String) throws -> String {
        let trimmed = try Self.requireText(alias, name: "receiverAlias")
        guard let secret = try PaykitLinkStore.getString(account: PaykitLinkStore.receiverAccount(trimmed)),
              !secret.isEmpty
        else {
            throw PaykitLinkBridgeError(code: "validation", message: "receiver alias not found")
        }
        return secret
    }

    private func handle(_ linkId: String) throws -> LinkHandle {
        guard let handle = lock.withLock({ handles[linkId] }) else {
            throw PaykitLinkBridgeError(code: "validation", message: "unknown linkId")
        }
        return handle
    }

    private func linkArgs(
        _ sessionAlias: String,
        _ receiverAlias: String,
        _ peerPubky: String,
        _ peerNoisePublicKey: String,
        _ localReceiverPath: String,
        _ remoteReceiverPath: String
    ) async throws -> LinkCallArgs {
        let session = try await session(try Self.requireText(sessionAlias, name: "sessionAlias"))
        return LinkCallArgs(
            session: session,
            receiverSecret: try receiverSecret(receiverAlias),
            peerPubky: try Self.requireText(peerPubky, name: "peerPubky"),
            peerNoisePublicKey: try Self.requireText(peerNoisePublicKey, name: "peerNoisePublicKey"),
            localReceiverPath: try Self.requireText(localReceiverPath, name: "localReceiverPath"),
            remoteReceiverPath: try Self.requireText(remoteReceiverPath, name: "remoteReceiverPath")
        )
    }

    private func writePublic(
        session: ChatSession,
        url: String,
        content: String?,
        origin: String,
        method: String
    ) async throws {
        let owner = session.pubky()
        let path = try Self.ownerStoragePath(url: url, expectedOwner: owner)
        var originClean = origin.trimmingCharacters(in: .whitespacesAndNewlines)
        while originClean.hasSuffix("/") {
            originClean.removeLast()
        }
        let exported = session.exportSession()
        let cookie = Self.homeserverSessionCookie(exported, owner: owner)
        guard let httpURL = URL(string: originClean + path + "?pubky-host=" + owner) else {
            throw PaykitLinkBridgeError(code: "validation", message: "invalid homeserver origin")
        }
        var request = URLRequest(url: httpURL)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("\(owner)=\(cookie)", forHTTPHeaderField: "Cookie")
        request.setValue(owner, forHTTPHeaderField: "pubky-host")
        request.setValue("text/plain; charset=utf-8", forHTTPHeaderField: "Content-Type")
        if let content {
            request.httpBody = Data(content.utf8)
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 30
        do {
            // Fail closed on redirects so the session cookie is not forwarded
            // cross-origin (Android already sets instanceFollowRedirects=false).
            let session = URLSession(
                configuration: config,
                delegate: RejectHttpRedirects(),
                delegateQueue: nil
            )
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw PaykitLinkBridgeError(code: "network", message: "network error")
            }
            paykitLinkLog.debug(
                "writePublic method=\(method, privacy: .public) status=\(http.statusCode, privacy: .public) exportLen=\(exported.count, privacy: .public) cookieLen=\(cookie.count, privacy: .public) pathLen=\(path.count, privacy: .public)"
            )
            if http.statusCode == 401 || http.statusCode == 403 {
                throw PaykitLinkBridgeError(code: "auth", message: "authentication failed")
            }
            if !(200...299).contains(http.statusCode) {
                throw PaykitLinkBridgeError(code: "protocol", message: "protocol error")
            }
        } catch let bridge as PaykitLinkBridgeError {
            throw bridge
        } catch {
            throw PaykitLinkBridgeError(code: "network", message: "network error")
        }
    }

    private static func ownerStoragePath(url: String, expectedOwner: String) throws -> String {
        let prefix = "pubky://"
        guard url.hasPrefix(prefix) else {
            throw PaykitLinkBridgeError(code: "validation", message: "url must be a pubky:// URI")
        }
        let rest = String(url.dropFirst(prefix.count))
        guard let slash = rest.firstIndex(of: "/") else {
            throw PaykitLinkBridgeError(code: "validation", message: "url is missing a path")
        }
        let owner = String(rest[..<slash])
        let path = String(rest[slash...])
        if owner != expectedOwner {
            throw PaykitLinkBridgeError(code: "validation", message: "url owner does not match session")
        }
        if !path.hasPrefix("/pub/") {
            throw PaykitLinkBridgeError(code: "validation", message: "url path must start with /pub/")
        }
        return path
    }

    /// Paykit `exportSession()` is pubky-sdk `export_secret()`:
    /// `<pubkey>:<cookie_secret>`. The homeserver cookie value is only the
    /// secret. Sending the whole token 401s.
    private static func homeserverSessionCookie(_ exported: String, owner: String) -> String {
        let trimmed = exported.trimmingCharacters(in: .whitespacesAndNewlines)
        if let sep = trimmed.firstIndex(of: ":") {
            let pubky = String(trimmed[..<sep])
            let secret = String(trimmed[trimmed.index(after: sep)...])
            if pubky == owner && !secret.isEmpty {
                return secret
            }
        }
        return trimmed
    }

    private static func requireText(_ value: String?, name: String) throws -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            throw PaykitLinkBridgeError(code: "validation", message: "\(name) is required")
        }
        return trimmed
    }

    private static func optionalText(_ value: Any?) -> String? {
        if value == nil || value is NSNull { return nil }
        guard let text = value as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func capabilitiesJson(_ capabilities: ChatReceiverCapabilities) throws -> String {
        let object: [String: Bool] = [
            "privatePayments": capabilities.privatePayments,
            "paymentRequests": capabilities.paymentRequests,
            "receipts": capabilities.receipts,
            "outgoingPayments": capabilities.outgoingPayments,
        ]
        let data = try JSONSerialization.data(withJSONObject: object, options: [])
        guard let json = String(data: data, encoding: .utf8) else {
            throw PaykitLinkBridgeError(code: "protocol", message: "failed to encode capabilities")
        }
        return json
    }

    private static func paykitCode(_ error: Error) -> String? {
        guard let paykit = error as? PaykitError else { return nil }
        switch paykit {
        case let .Storage(code, _),
             let .Identity(code, _),
             let .Transport(code, _),
             let .NotFound(code, _),
             let .Protocol(code, _),
             let .Policy(code, _),
             let .PaymentAdapter(code, _),
             let .RecoveryRequired(code, _):
            return code
        }
    }

    private static func mapError(_ error: Error) -> PaykitLinkBridgeError {
        if let bridge = error as? PaykitLinkBridgeError {
            return bridge
        }
        if error is CancellationError {
            return PaykitLinkBridgeError(
                code: "auth_flow_cancelled",
                message: staticMessage("auth_flow_cancelled")
            )
        }
        guard let paykit = error as? PaykitError else {
            paykitLinkLog.error("unmapped native error type=\(String(describing: type(of: error)), privacy: .public)")
            return PaykitLinkBridgeError(code: "protocol", message: staticMessage("protocol"))
        }
        let ffiCode: String
        switch paykit {
        case let .Storage(code, _),
             let .Identity(code, _),
             let .Transport(code, _),
             let .NotFound(code, _),
             let .Protocol(code, _),
             let .Policy(code, _),
             let .PaymentAdapter(code, _),
             let .RecoveryRequired(code, _):
            ffiCode = code
        }
        let coarse = mapFfiCode(ffiCode)
        // Never log raw FFI text — codes can carry an auth URL/client secret.
        if isLoggableFfiCode(ffiCode) {
            paykitLinkLog.error("Paykit FFI error code=\(ffiCode, privacy: .public) mapped=\(coarse, privacy: .public)")
        } else {
            paykitLinkLog.error("Paykit FFI error codeLen=\(ffiCode.count, privacy: .public) mapped=\(coarse, privacy: .public)")
        }
        return PaykitLinkBridgeError(code: coarse, message: staticMessage(coarse))
    }

    /// Chat FFI `Capabilities::try_from` comma-splits. Passing the joined
    /// grant as one `Capability` fails (two `:`). Re-join valid entries.
    private static func canonicalizeCapabilities(_ raw: String) throws -> String {
        let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if parts.isEmpty {
            throw PaykitLinkBridgeError(code: "validation", message: staticMessage("validation"))
        }
        for part in parts {
            if !part.hasPrefix("/") || part.filter({ $0 == ":" }).count != 1 {
                throw PaykitLinkBridgeError(code: "validation", message: staticMessage("validation"))
            }
        }
        return parts.joined(separator: ",")
    }

    private static func isLoggableFfiCode(_ code: String) -> Bool {
        if code.isEmpty || code.count > 64 { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz_")
        return code.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func mapFfiCode(_ code: String) -> String {
        switch code {
        case "transport_error", "send_failed", "receive_failed", "auth_flow_failed":
            return "network"
        case "signin_failed", "signup_failed", "session_restore_failed", "capabilities_missing":
            return "auth"
        case "validation":
            return "validation"
        case "consumed":
            return "consumed"
        case "auth_flow_cancelled":
            return "auth_flow_cancelled"
        default:
            return "protocol"
        }
    }

    private static func staticMessage(_ code: String) -> String {
        switch code {
        case "network":
            return "network error"
        case "auth":
            return "authentication failed"
        case "validation":
            return "validation failed"
        case "consumed":
            return "resource consumed"
        case "unavailable":
            return "unavailable"
        case "auth_flow_cancelled":
            return "auth flow cancelled"
        default:
            return "protocol error"
        }
    }
}

private struct LinkCallArgs {
    let session: ChatSession
    let receiverSecret: String
    let peerPubky: String
    let peerNoisePublicKey: String
    let localReceiverPath: String
    let remoteReceiverPath: String
}

private struct LinkHandle {
    enum Kind {
        case handshake(ChatLinkHandshake)
        case link(ChatLink)
    }

    let kind: Kind
    let context: SnapshotContext
}

enum SnapshotRole: String {
    case initiator
    case responder
    case link
}

struct SnapshotContext {
    let ownerPubky: String
    let peerPubky: String
    let localReceiverPath: String
    let remoteReceiverPath: String
    var role: SnapshotRole

    var aad: Data {
        Data("\(ownerPubky)|\(peerPubky)|\(localReceiverPath)|\(remoteReceiverPath)|\(role.rawValue)".utf8)
    }

    func asLink() -> SnapshotContext {
        var copy = self
        copy.role = .link
        return copy
    }
}

private final class RejectHttpRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

enum PaykitLinkStore {
    static let service = "hypercolor.paykitlink"
    static let snapshotAccount = "snapshot-key"
    static let attachmentServicePrefix = "hypercolor-attachment-key"

    /// Simulator unsigned / entitlement-mismatch reads return -34018
    /// (`errSecMissingEntitlement`) instead of not-found. Treat as absent so
    /// persistSession can add a new item instead of failing signup.
    private static func isAbsent(_ status: OSStatus) -> Bool {
        status == errSecItemNotFound
            || status == errSecInteractionNotAllowed
            || status == errSecNotAvailable
            || status == errSecMissingEntitlement
    }

    static func receiverAccount(_ alias: String) -> String { "receiver.\(alias)" }
    static func sessionAccount(_ alias: String) -> String { "session.\(alias)" }

    static func put(_ value: String, account: String) throws {
        try put(Data(value.utf8), account: account)
    }

    static func put(_ value: Data, account: String) throws {
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let existing: Data?
        do {
            existing = try getKeychain(account)
        } catch {
            existing = nil
        }
        if existing != nil {
            let updated: [String: Any] = [kSecValueData as String: value]
            let status = SecItemUpdate(identity as CFDictionary, updated as CFDictionary)
            if status == errSecSuccess { return }
            #if DEBUG
            if status == errSecMissingEntitlement {
                try writeFallback(value, account: account)
                return
            }
            #endif
            throw PaykitLinkBridgeError(
                code: "protocol",
                message: "keychain update failed (\(status))",
            )
        }
        var add = identity
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecValueData as String] = value
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updated: [String: Any] = [kSecValueData as String: value]
            let retry = SecItemUpdate(identity as CFDictionary, updated as CFDictionary)
            if retry == errSecSuccess { return }
            #if DEBUG
            if retry == errSecMissingEntitlement {
                try writeFallback(value, account: account)
                return
            }
            #endif
            throw PaykitLinkBridgeError(
                code: "protocol",
                message: "keychain update failed (\(retry))",
            )
        }
        if status == errSecSuccess { return }
        #if DEBUG
        if status == errSecMissingEntitlement {
            try writeFallback(value, account: account)
            return
        }
        #endif
        throw PaykitLinkBridgeError(code: "protocol", message: "keychain write failed (\(status))")
    }

    static func get(_ account: String) throws -> Data? {
        if let data = try getKeychain(account) {
            return data
        }
        #if DEBUG
        return readFallback(account)
        #else
        return nil
        #endif
    }

    private static func getKeychain(_ account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if isAbsent(status) {
            return nil
        }
        if status != errSecSuccess {
            throw PaykitLinkBridgeError(code: "protocol", message: "keychain read failed (\(status))")
        }
        return result as? Data
    }

    static func getString(account: String) throws -> String? {
        guard let data = try get(account) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && !isAbsent(status) {
            throw PaykitLinkBridgeError(
                code: "protocol",
                message: "keychain delete failed (\(status))",
            )
        }
        #if DEBUG
        try deleteFallback(account: account)
        #endif
    }

    static func deleteAll() throws {
        try deleteAllAccounts(forService: service)
        try deleteServices(prefix: attachmentServicePrefix)
        #if DEBUG
        try wipeFallback()
        #endif
    }

    private static func deleteAllAccounts(forService target: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: target,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if isAbsent(status) {
            return
        }
        if status != errSecSuccess {
            throw PaykitLinkBridgeError(code: "protocol", message: "keychain read failed")
        }
        let items = (result as? [[String: Any]]) ?? []
        for item in items {
            if let account = item[kSecAttrAccount as String] as? String {
                try delete(account: account)
            }
        }
        let wipe: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: target,
        ]
        let wipeStatus = SecItemDelete(wipe as CFDictionary)
        if wipeStatus != errSecSuccess && !isAbsent(wipeStatus) {
            throw PaykitLinkBridgeError(
                code: "protocol",
                message: "keychain delete failed (\(wipeStatus))",
            )
        }
    }

    private static func deleteServices(prefix: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return
        }
        if status != errSecSuccess {
            return
        }
        let items = (result as? [[String: Any]]) ?? []
        for item in items {
            guard let svc = item[kSecAttrService as String] as? String, svc.hasPrefix(prefix) else {
                continue
            }
            let del: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: svc,
            ]
            let delStatus = SecItemDelete(del as CFDictionary)
            if delStatus != errSecSuccess && delStatus != errSecItemNotFound {
                throw PaykitLinkBridgeError(
                    code: "protocol",
                    message: "keychain delete failed (\(delStatus))",
                )
            }
        }
    }

    #if DEBUG
    /// Unsigned simulator builds (`CODE_SIGNING_ALLOWED=NO`) reject SecItem
    /// writes with -34018. Keep DEBUG session material in the app sandbox so
    /// signup/backup proofs can run; release still requires the keychain.
    private static func fallbackDir() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = base.appendingPathComponent("hypercolor-paykitlink", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func fallbackURL(account: String) throws -> URL {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_"))
        let safe = String(account.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
        return try fallbackDir().appendingPathComponent(safe)
    }

    private static func writeFallback(_ value: Data, account: String) throws {
        try value.write(to: fallbackURL(account: account), options: .atomic)
    }

    private static func readFallback(_ account: String) -> Data? {
        guard let url = try? fallbackURL(account: account) else { return nil }
        return try? Data(contentsOf: url)
    }

    private static func deleteFallback(account: String) throws {
        let url = try fallbackURL(account: account)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    private static func wipeFallback() throws {
        let dir = try fallbackDir()
        if FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.removeItem(at: dir)
        }
    }
    #endif

    static func snapshotKey() throws -> SymmetricKey {
        if let existing = try get(snapshotAccount), existing.count == 32 {
            return SymmetricKey(data: existing)
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            throw PaykitLinkBridgeError(code: "protocol", message: "failed to generate snapshot key")
        }
        let data = Data(bytes)
        try put(data, account: snapshotAccount)
        return SymmetricKey(data: data)
    }
}

enum PaykitSnapshotAead {
    static func encrypt(_ plaintext: String, context: SnapshotContext) throws -> String {
        let key = try PaykitLinkStore.snapshotKey()
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(
            Data(plaintext.utf8),
            using: key,
            nonce: nonce,
            authenticating: context.aad
        )
        guard let combined = sealed.combined else {
            throw PaykitLinkBridgeError(code: "protocol", message: "snapshot encrypt failed")
        }
        return combined.base64EncodedString()
    }

    static func decrypt(_ ciphertext: String, context: SnapshotContext) throws -> String {
        guard let data = Data(base64Encoded: ciphertext) else {
            throw PaykitLinkBridgeError(code: "protocol", message: "snapshot is not valid base64")
        }
        do {
            let box = try AES.GCM.SealedBox(combined: data)
            let opened = try AES.GCM.open(box, using: PaykitLinkStore.snapshotKey(), authenticating: context.aad)
            guard let text = String(data: opened, encoding: .utf8) else {
                throw PaykitLinkBridgeError(code: "protocol", message: "snapshot plaintext is not utf-8")
            }
            return text
        } catch is PaykitLinkBridgeError {
            throw PaykitLinkBridgeError(code: "protocol", message: "snapshot decrypt failed")
        } catch {
            throw PaykitLinkBridgeError(code: "protocol", message: "snapshot decrypt failed")
        }
    }

    static func decryptHandshake(
        _ ciphertext: String,
        ownerPubky: String,
        peerPubky: String,
        localReceiverPath: String,
        remoteReceiverPath: String
    ) throws -> (plaintext: String, role: SnapshotRole) {
        var last: Error = PaykitLinkBridgeError(code: "protocol", message: "snapshot decrypt failed")
        for role in [SnapshotRole.initiator, SnapshotRole.responder] {
            let context = SnapshotContext(
                ownerPubky: ownerPubky,
                peerPubky: peerPubky,
                localReceiverPath: localReceiverPath,
                remoteReceiverPath: remoteReceiverPath,
                role: role
            )
            do {
                return (try decrypt(ciphertext, context: context), role)
            } catch {
                last = error
            }
        }
        throw last
    }
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
