import Foundation
import React
import SQLite3

/// Paykit SDK bridge. Blob and session callbacks stay on the native thread.
/// `enqueueOpaque` and `privateStreamItems` fail closed: this vendored
/// xcframework does not export those symbols. Android does.
@objc(PaykitSdkModule)
final class PaykitSdkModule: NSObject {
    private let runtimes = SdkRuntimeTable()

    @objc func bindOwner(
        _ ownerPubky: String,
        sessionAlias: String,
        receiverAlias: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        run(resolve, reject) {
            try requireText(ownerPubky)
            try requireText(sessionAlias)
            try requireText(receiverAlias)
            try requireText(receiverPath)
            if self.runtimes.matches(
                owner: ownerPubky,
                sessionAlias: sessionAlias,
                receiverAlias: receiverAlias,
                receiverPath: receiverPath
            ) {
                return NSNull()
            }
            self.runtimes.remove(ownerPubky)
            let session = OwnerSessionProvider(sessionAlias: sessionAlias, receiverAlias: receiverAlias)
            let store = OwnerBlobStore(ownerPubky: ownerPubky)
            let config = PaykitSdkConfig(
                receiverPath: receiverPath,
                profileNamespace: "hypercolor.app",
                endpointManagementScope: .managedOnly,
                encryptedLinkRecoveryMarkers: .enabled,
                publicContactSharing: .localOnly,
                peerLinkOperationLeaseTimeoutSecs: 60,
                outboundPrivateSendLeaseTimeoutSecs: 60,
                outboundPrivateRetryBackoffSecs: 2
            )
            let sdk = try PaykitSdk(stateStore: store, sessionProvider: session, config: config)
            _ = try await sdk.initialize()
            self.runtimes.insert(
                owner: ownerPubky,
                runtime: OwnerRuntime(sdk: sdk, session: session, store: store, receiverPath: receiverPath)
            )
            return NSNull()
        }
    }

    @objc func ensureLinkWithPeer(
        _ ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        run(resolve, reject) {
            let sdk = try self.runtimes.sdk(ownerPubky)
            do {
                let report = try await sdk.ensureLinkWithPeer(
                    counterparty: peerPubky,
                    counterpartyReceiverPath: receiverPath,
                    maxAdvanceSteps: 2
                )
                return handshakeMap(report, leaseSkipped: false)
            } catch let PaykitError.Policy(_, context) where context.contains("already in progress") {
                return leaseSkippedMap(peerPubky, receiverPath)
            } catch PaykitError.RecoveryRequired(_, _) {
                return recoveryMap(peerPubky, receiverPath)
            }
        }
    }

    @objc func observeEncryptedLinkRecoveryMarker(
        _ ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        run(resolve, reject) {
            let sdk = try self.runtimes.sdk(ownerPubky)
            do {
                let report = try await sdk.observeEncryptedLinkRecoveryMarker(
                    counterparty: peerPubky,
                    counterpartyReceiverPath: receiverPath
                )
                return [
                    "state": stateName(report.state),
                    "remoteMarkerChanged": report.remoteMarkerChanged,
                    "localAttemptId": report.localAttemptId as Any,
                    "remoteAttemptId": report.remoteAttemptId as Any,
                ] as [String: Any]
            } catch PaykitError.RecoveryRequired(_, _) {
                return [
                    "state": "RECOVERY_REQUIRED",
                    "remoteMarkerChanged": false,
                ] as [String: Any]
            }
        }
    }

    @objc func enqueueOpaquePrivateApplicationMessageJson(
        _ ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        rawJson: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        reject("unavailable", "this binary lacks opaque enqueue", nil)
    }

    @objc func processOutboundPrivateMessages(
        _ ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        run(resolve, reject) {
            let sdk = try self.runtimes.sdk(ownerPubky)
            let report = try await sdk.processOutboundPrivateMessages(
                counterparty: peerPubky,
                counterpartyReceiverPath: receiverPath
            )
            let failed: [[String: String]] = report.failed.map { failure in
                [
                    "queueId": String(failure.outboundMessageId),
                    "category": failure.error.category(),
                ]
            }
            return [
                "sent": report.sent.map { String($0) },
                "failed": failed,
            ] as [String: Any]
        }
    }

    @objc func receivePrivateMessages(
        _ ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        run(resolve, reject) {
            let sdk = try self.runtimes.sdk(ownerPubky)
            let report = try await sdk.receivePrivateMessages(
                counterparty: peerPubky,
                counterpartyReceiverPath: receiverPath
            )
            return [
                "receiveBatchId": String(report.receiveBatchId),
                "streamItemIds": report.streamItemIds.map { String($0) },
            ] as [String: Any]
        }
    }

    @objc func privateStreamItems(
        _ ownerPubky: String,
        rawIds: [String],
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        reject("unavailable", "this binary lacks private stream items", nil)
    }

    @objc func deleteOwnerState(
        _ ownerPubky: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        run(resolve, reject) {
            self.runtimes.remove(ownerPubky)
            try SdkBlobDatabase.deleteOwner(ownerPubky)
            return NSNull()
        }
    }

    private func run(
        _ resolve: @escaping RCTPromiseResolveBlock,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ body: @escaping () async throws -> Any
    ) {
        Task.detached(priority: .userInitiated) {
            do {
                resolve(try await body())
            } catch {
                let mapped = mapSdkError(error)
                reject(mapped.code, mapped.message, nil)
            }
        }
    }
}

private final class OwnerRuntime {
    let sdk: PaykitSdk
    let session: OwnerSessionProvider
    let store: OwnerBlobStore
    let receiverPath: String

    init(sdk: PaykitSdk, session: OwnerSessionProvider, store: OwnerBlobStore, receiverPath: String) {
        self.sdk = sdk
        self.session = session
        self.store = store
        self.receiverPath = receiverPath
    }
}

private final class SdkRuntimeTable {
    private let lock = NSLock()
    private var owners: [String: OwnerRuntime] = [:]

    func matches(owner: String, sessionAlias: String, receiverAlias: String, receiverPath: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let runtime = owners[owner] else { return false }
        return runtime.session.sessionAlias == sessionAlias
            && runtime.session.receiverAlias == receiverAlias
            && runtime.receiverPath == receiverPath
    }

    func insert(owner: String, runtime: OwnerRuntime) {
        lock.lock()
        owners[owner] = runtime
        lock.unlock()
    }

    func remove(_ owner: String) {
        lock.lock()
        owners.removeValue(forKey: owner)
        lock.unlock()
    }

    func sdk(_ owner: String) throws -> PaykitSdk {
        lock.lock()
        let runtime = owners[owner]
        lock.unlock()
        guard let runtime else {
            throw PaykitError.Identity(code: "not_bound", context: "sdk owner is not bound")
        }
        return runtime.sdk
    }
}

private final class OwnerSessionProvider: SdkPubkySessionProvider, @unchecked Sendable {
    var sessionAlias: String
    var receiverAlias: String

    init(sessionAlias: String, receiverAlias: String) {
        self.sessionAlias = sessionAlias
        self.receiverAlias = receiverAlias
    }

    func loadSessionAccess() throws -> PubkySessionAccess? {
        let sessionData = try PaykitLinkStore.get(PaykitLinkStore.sessionAccount(sessionAlias))
        let receiverData = try PaykitLinkStore.get(PaykitLinkStore.receiverAccount(receiverAlias))
        if sessionData == nil && receiverData == nil { return nil }
        guard
            let sessionData,
            let session = String(data: sessionData, encoding: .utf8),
            let receiverData,
            let hex = String(data: receiverData, encoding: .utf8),
            let noise = decodeHex(hex)
        else {
            throw PaykitError.Identity(code: "session_incomplete", context: "session unavailable")
        }
        return PubkySessionAccess(
            sessionSecret: session,
            localSecretKey: nil,
            receiverNoiseSecretKey: ReceiverNoiseSecretKey(bytes: noise)
        )
    }

    func publicStorageAvailable() throws -> Bool { true }

    /// Does not delete the chat session bearer.
    func clearSessionAccess() throws {}
}

private final class OwnerBlobStore: SdkStateBlobStore, @unchecked Sendable {
    let ownerPubky: String

    init(ownerPubky: String) {
        self.ownerPubky = ownerPubky
    }

    func loadStateBlob() throws -> SdkStateBlobSnapshot? {
        guard let row = try SdkBlobDatabase.load(ownerPubky) else { return nil }
        return SdkStateBlobSnapshot(blob: SdkStateBlob(bytes: row.blob), revision: row.revision)
    }

    func saveStateBlobAtomically(blob: SdkStateBlob, expectedRevision: String?) throws -> String {
        try SdkBlobDatabase.save(owner: ownerPubky, bytes: blob.exportBytes(), expectedRevision: expectedRevision)
    }
}

private struct SdkBlobRow {
    let blob: Data
    let revision: String
}

private enum SdkBlobDatabase {
    private static let lock = NSRecursiveLock()
    private static var db: OpaquePointer?

    static func load(_ owner: String) throws -> SdkBlobRow? {
        lock.lock()
        defer { lock.unlock() }
        let connection = try open()
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            connection,
            "SELECT blob, revision FROM paykit_sdk_state WHERE owner_pubky = ?",
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else {
            throw PaykitError.Storage(code: "read_failed", context: "state read failed")
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, owner, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        let step = sqlite3_step(statement)
        if step == SQLITE_DONE { return nil }
        if step != SQLITE_ROW {
            throw PaykitError.Storage(code: "read_failed", context: "state read failed")
        }
        let count = Int(sqlite3_column_bytes(statement, 0))
        let blob: Data
        if count == 0 {
            blob = Data()
        } else if let pointer = sqlite3_column_blob(statement, 0) {
            blob = Data(bytes: pointer, count: count)
        } else {
            throw PaykitError.Storage(code: "read_failed", context: "state read failed")
        }
        guard let revisionPtr = sqlite3_column_text(statement, 1) else {
            throw PaykitError.Storage(code: "read_failed", context: "state read failed")
        }
        return SdkBlobRow(blob: blob, revision: String(cString: revisionPtr))
    }

    static func save(owner: String, bytes: Data, expectedRevision: String?) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        let connection = try open()
        if sqlite3_exec(connection, "BEGIN IMMEDIATE", nil, nil, nil) != SQLITE_OK {
            throw PaykitError.Storage(code: "write_failed", context: "state write failed")
        }
        do {
            let current = try revision(connection, owner: owner)
            if current == nil {
                if expectedRevision != nil {
                    throw PaykitError.Storage(code: "revision_conflict", context: "revision mismatch")
                }
            } else if expectedRevision != current {
                throw PaykitError.Storage(code: "revision_conflict", context: "revision mismatch")
            }
            let revision = UUID().uuidString
            let sql = current == nil
                ? "INSERT INTO paykit_sdk_state (owner_pubky, blob, revision, updated_at) VALUES (?, ?, ?, ?)"
                : "UPDATE paykit_sdk_state SET blob = ?, revision = ?, updated_at = ? WHERE owner_pubky = ? AND revision = ?"
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
                throw PaykitError.Storage(code: "write_failed", context: "state write failed")
            }
            defer { sqlite3_finalize(statement) }
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            if current == nil {
                sqlite3_bind_text(statement, 1, owner, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                bindBlob(statement, 2, bytes)
                sqlite3_bind_text(statement, 3, revision, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                sqlite3_bind_int64(statement, 4, now)
            } else {
                bindBlob(statement, 1, bytes)
                sqlite3_bind_text(statement, 2, revision, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                sqlite3_bind_int64(statement, 3, now)
                sqlite3_bind_text(statement, 4, owner, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                sqlite3_bind_text(statement, 5, current, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            }
            if sqlite3_step(statement) != SQLITE_DONE {
                throw PaykitError.Storage(code: "write_failed", context: "state write failed")
            }
            if current != nil && sqlite3_changes(connection) != 1 {
                throw PaykitError.Storage(code: "revision_conflict", context: "revision mismatch")
            }
            if sqlite3_exec(connection, "COMMIT", nil, nil, nil) != SQLITE_OK {
                throw PaykitError.Storage(code: "write_failed", context: "state write failed")
            }
            return revision
        } catch {
            sqlite3_exec(connection, "ROLLBACK", nil, nil, nil)
            throw error
        }
    }

    static func deleteOwner(_ owner: String) throws {
        lock.lock()
        defer { lock.unlock() }
        let connection = try open()
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            connection,
            "DELETE FROM paykit_sdk_state WHERE owner_pubky = ?",
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else {
            throw PaykitError.Storage(code: "write_failed", context: "state write failed")
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, owner, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        if sqlite3_step(statement) != SQLITE_DONE {
            throw PaykitError.Storage(code: "write_failed", context: "state write failed")
        }
    }

    private static func revision(_ connection: OpaquePointer, owner: String) throws -> String? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(
            connection,
            "SELECT revision FROM paykit_sdk_state WHERE owner_pubky = ?",
            -1,
            &statement,
            nil
        ) == SQLITE_OK, let statement else {
            throw PaykitError.Storage(code: "read_failed", context: "state read failed")
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, owner, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        let step = sqlite3_step(statement)
        if step == SQLITE_DONE { return nil }
        guard step == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else {
            throw PaykitError.Storage(code: "read_failed", context: "state read failed")
        }
        return String(cString: text)
    }

    private static func open() throws -> OpaquePointer {
        if let db { return db }
        guard let root = NSSearchPathForDirectoriesInDomains(.libraryDirectory, .userDomainMask, true).first else {
            throw PaykitError.Storage(code: "storage", context: "database directory missing")
        }
        let path = (root as NSString).appendingPathComponent("hypercolor.db")
        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        if sqlite3_open_v2(path, &connection, flags, nil) != SQLITE_OK {
            throw PaykitError.Storage(code: "storage", context: "database open failed")
        }
        guard let connection else {
            throw PaykitError.Storage(code: "storage", context: "database open failed")
        }
        if sqlite3_exec(connection, "PRAGMA journal_mode=WAL", nil, nil, nil) != SQLITE_OK
            || sqlite3_exec(connection, "PRAGMA busy_timeout=5000", nil, nil, nil) != SQLITE_OK
            || sqlite3_exec(
                connection,
                """
                CREATE TABLE IF NOT EXISTS paykit_sdk_state (
                  owner_pubky TEXT PRIMARY KEY,
                  blob BLOB NOT NULL,
                  revision TEXT NOT NULL,
                  updated_at INTEGER NOT NULL
                )
                """,
                nil,
                nil,
                nil
            ) != SQLITE_OK {
            sqlite3_close(connection)
            throw PaykitError.Storage(code: "storage", context: "database open failed")
        }
        db = connection
        return connection
    }

    private static func bindBlob(_ statement: OpaquePointer, _ index: Int32, _ bytes: Data) {
        bytes.withUnsafeBytes { raw in
            sqlite3_bind_blob(
                statement,
                index,
                raw.baseAddress,
                Int32(bytes.count),
                unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            )
        }
    }
}

private func handshakeMap(_ report: LinkedPeerHandshakeReport, leaseSkipped: Bool) -> [String: Any] {
    [
        "counterparty": report.counterparty,
        "path": report.counterpartyReceiverPath,
        "state": stateName(report.state),
        "generation": String(report.generation),
        "role": roleName(report.handshakeRole),
        "leaseSkipped": leaseSkipped,
    ]
}

private func leaseSkippedMap(_ peer: String, _ path: String) -> [String: Any] {
    [
        "counterparty": peer,
        "path": path,
        "leaseSkipped": true,
    ]
}

private func recoveryMap(_ peer: String, _ path: String) -> [String: Any] {
    [
        "counterparty": peer,
        "path": path,
        "state": "RECOVERY_REQUIRED",
        "generation": "0",
        "role": "UNKNOWN",
        "leaseSkipped": false,
    ]
}

private func stateName(_ state: LinkedPeerState) -> String {
    switch state {
    case .notLinked: return "NOT_LINKED"
    case .linking: return "LINKING"
    case .linked: return "LINKED"
    case .recoveryRequired: return "RECOVERY_REQUIRED"
    case .blocked: return "BLOCKED"
    case .unknown: return "UNKNOWN"
    }
}

private func roleName(_ role: EncryptedLinkHandshakeRole?) -> String {
    switch role {
    case .initiator: return "INITIATOR"
    case .responder: return "RESPONDER"
    case .unknown, .none: return "UNKNOWN"
    }
}

private func mapSdkError(_ error: Error) -> (code: String, message: String) {
    if let bridge = error as? PaykitLinkBridgeError {
        return (bridge.code, bridge.message)
    }
    switch error {
    case PaykitError.Transport(_, _), PaykitError.NotFound(_, _):
        return ("network", "network error")
    case PaykitError.Identity(_, _):
        return ("auth", "authentication failed")
    case PaykitError.RecoveryRequired(_, _):
        return ("recovery_required", "recovery required")
    default:
        return ("protocol", "protocol error")
    }
}

private func requireText(_ value: String) throws {
    if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        throw PaykitError.Protocol(code: "validation", context: "validation failed")
    }
}

private func decodeHex(_ hex: String) -> Data? {
    let clean = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean.count % 2 == 0 else { return nil }
    var out = Data(capacity: clean.count / 2)
    var index = clean.startIndex
    while index < clean.endIndex {
        let next = clean.index(index, offsetBy: 2)
        guard let byte = UInt8(clean[index..<next], radix: 16) else { return nil }
        out.append(byte)
        index = next
    }
    return out
}
