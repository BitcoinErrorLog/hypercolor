import Foundation

/// Compiles `PaykitLinkAuthProtocol.swift` and runs assertions. No React /
/// Paykit / Keychain host required:
/// `xcrun swiftc ios/hypercolor/PaykitLinkAuthProtocol.swift ios/scripts/test-paykit-link-auth-protocol.swift -o /tmp/test-paykit-link-auth-protocol && /tmp/test-paykit-link-auth-protocol`

private struct ProtocolError: Error {}

private struct FakeKeychain {
    var items: [String: String] = [:]
    var failWriteOf: String?

    mutating func put(_ value: String, account: String) throws {
        if failWriteOf == account {
            failWriteOf = nil
            throw ProtocolError()
        }
        items[account] = value
    }

    mutating func delete(account: String) {
        items.removeValue(forKey: account)
    }
}

private func persistPending(store: inout FakeKeychain, alias: String, bearer: String) throws {
    let marker = PaykitLinkAuthProtocol.pendingAccount(alias)
    let session = PaykitLinkAuthProtocol.sessionAccount(alias)
    try PaykitLinkAuthProtocol.writeMarkerThenBearer(
        writeMarker: { try store.put("1", account: marker) },
        writeBearer: { try store.put(bearer, account: session) },
        rollback: {
            store.delete(account: session)
            store.delete(account: marker)
        }
    )
}

@main
enum PaykitLinkAuthProtocolTests {
    static func main() {
        testKeyNamespacing()
        testSweepLatch()
        testSessionLookup()
        testPersistMarkerFirstAndRollback()
        testReconcileDeathWindows()
        fputs("PaykitLinkAuthProtocol: 5 checks passed\n", stdout)
    }

    static func testKeyNamespacing() {
        let alias = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        expect(
            PaykitLinkAuthProtocol.sessionAccount(alias) == "session.\(alias)",
            "session account"
        )
        expect(
            PaykitLinkAuthProtocol.pendingAccount(alias) == "session.pending.\(alias)",
            "pending account"
        )
        let accounts = [
            PaykitLinkAuthProtocol.sessionAccount(alias),
            PaykitLinkAuthProtocol.pendingAccount(alias),
            PaykitLinkAuthProtocol.sessionAccount("other"),
            "receiver.\(alias)",
        ]
        expect(
            PaykitLinkAuthProtocol.pendingAliases(fromAccounts: accounts) == [alias],
            "pending parse skips session keys"
        )
        expect(
            PaykitLinkAuthProtocol.sessionAliases(fromAccounts: accounts) == [alias, "other"],
            "session parse skips pending keys"
        )
        expect(
            PaykitLinkAuthProtocol.sessionAlias(fromAccount: "session.pending.x") == nil,
            "pending key is not a session alias"
        )
    }

    static func testSweepLatch() {
        expect(
            PaykitLinkAuthProtocol.classifyListStatus(PaykitLinkAuthProtocol.errSecSuccess) == .items,
            "success is items"
        )
        expect(
            PaykitLinkAuthProtocol.classifyListStatus(PaykitLinkAuthProtocol.errSecItemNotFound) == .empty,
            "not found is empty"
        )
        expect(
            PaykitLinkAuthProtocol.classifyListStatus(PaykitLinkAuthProtocol.errSecInteractionNotAllowed)
                == .unavailable,
            "pre-first-unlock is unavailable"
        )
        expect(
            PaykitLinkAuthProtocol.classifyListStatus(PaykitLinkAuthProtocol.errSecNotAvailable)
                == .unavailable,
            "not available is unavailable"
        )
        expect(
            PaykitLinkAuthProtocol.classifyListStatus(PaykitLinkAuthProtocol.errSecMissingEntitlement)
                == .unavailable,
            "missing entitlement is unavailable"
        )
        expect(
            PaykitLinkAuthProtocol.classifyListStatus(-1) == .failed,
            "other status is failed"
        )
        expect(PaykitLinkAuthProtocol.shouldLatchSweep(after: .items), "latch after items")
        expect(PaykitLinkAuthProtocol.shouldLatchSweep(after: .empty), "latch after empty")
        expect(
            !PaykitLinkAuthProtocol.shouldLatchSweep(after: .unavailable),
            "do not latch unavailable"
        )
        expect(!PaykitLinkAuthProtocol.shouldLatchSweep(after: .failed), "do not latch failed")
    }

    static func testSessionLookup() {
        expect(
            PaykitLinkAuthProtocol.sessionStep(
                pendingInMemory: true,
                hasLive: true,
                durablePending: true,
                hasBearer: true
            ) == .refusePending,
            "in-memory pending refuses even with a live cache"
        )
        expect(
            PaykitLinkAuthProtocol.sessionStep(
                pendingInMemory: false,
                hasLive: true,
                durablePending: true,
                hasBearer: true
            ) == .returnLive,
            "live cache before durable marker / Keychain"
        )
        expect(
            PaykitLinkAuthProtocol.sessionStep(
                pendingInMemory: false,
                hasLive: false,
                durablePending: true,
                hasBearer: true
            ) == .refuseDurablePending,
            "durable pending refuses restore"
        )
        expect(
            PaykitLinkAuthProtocol.sessionStep(
                pendingInMemory: false,
                hasLive: false,
                durablePending: false,
                hasBearer: true
            ) == .restore,
            "adopted bearer restores"
        )
        expect(
            PaykitLinkAuthProtocol.sessionStep(
                pendingInMemory: false,
                hasLive: false,
                durablePending: false,
                hasBearer: false
            ) == .notFound,
            "unknown alias does not restore"
        )
    }

    static func testPersistMarkerFirstAndRollback() {
        var store = FakeKeychain()
        try! persistPending(store: &store, alias: "a1", bearer: "token")
        expect(store.items["session.pending.a1"] == "1", "marker written")
        expect(store.items["session.a1"] == "token", "bearer written")

        var failed = FakeKeychain()
        failed.failWriteOf = "session.a2"
        var threw = false
        do {
            try persistPending(store: &failed, alias: "a2", bearer: "token")
        } catch {
            threw = true
        }
        expect(threw, "bearer write failure throws")
        expect(failed.items["session.pending.a2"] == nil, "marker rolled back")
        expect(failed.items["session.a2"] == nil, "no leftover bearer")

        var crashBetween = FakeKeychain()
        try! crashBetween.put("1", account: PaykitLinkAuthProtocol.pendingAccount("a3"))
        expect(crashBetween.items["session.a3"] == nil, "crash after marker leaves no bearer")
        let leftovers = PaykitLinkAuthProtocol.pendingAliases(fromAccounts: Array(crashBetween.items.keys))
        expect(leftovers == ["a3"], "pending sweep sees marker-without-bearer")
    }

    static func testReconcileDeathWindows() {
        let pending = "pending-alias"
        let orphan = "orphan-alias"
        let kept = "kept-alias"
        let accounts = [
            PaykitLinkAuthProtocol.sessionAccount(pending),
            PaykitLinkAuthProtocol.pendingAccount(pending),
            PaykitLinkAuthProtocol.sessionAccount(orphan),
            PaykitLinkAuthProtocol.sessionAccount(kept),
        ]
        let sessionAliases = PaykitLinkAuthProtocol.sessionAliases(fromAccounts: accounts)
        let pendingAliases = Set(PaykitLinkAuthProtocol.pendingAliases(fromAccounts: accounts))

        // Death before adopt: marker+bearer, KeyStore empty → pending sweep
        // collects; reconcile excludes pending.
        expect(pendingAliases.contains(pending), "death before adopt still pending")
        let afterPendingSweep = pendingAliases
        expect(afterPendingSweep.contains(pending), "pending leftover listed for sweep")

        // Death between marker-delete and KeyStore write: bearer, no marker,
        // KeyStore empty → boot reconcile collects.
        let collected = PaykitLinkAuthProtocol.orphanAdoptedAliases(
            sessionAliases: sessionAliases,
            pendingAliases: pendingAliases,
            knownAliases: []
        )
        expect(collected.contains(orphan), "marker-less orphan collected")
        expect(!collected.contains(pending), "pending excluded from adopted reconcile")
        expect(collected.contains(kept), "unowned adopted also collected")

        // Normal path: KeyStore names the adopted alias → nothing collected.
        let normal = PaykitLinkAuthProtocol.orphanAdoptedAliases(
            sessionAliases: [kept],
            pendingAliases: [],
            knownAliases: [kept]
        )
        expect(normal.isEmpty, "normal path collects nothing")
    }

    static func expect(_ condition: Bool, _ message: String) {
        if !condition {
            fputs("FAIL: \(message)\n", stderr)
            exit(1)
        }
    }
}
