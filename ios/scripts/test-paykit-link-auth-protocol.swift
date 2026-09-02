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
        testQuarantineTwoSighting()
        testQuarantineInFlightAndOwnedClear()
        fputs("PaykitLinkAuthProtocol: 7 checks passed\n", stdout)
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
        expect(
            PaykitLinkAuthProtocol.quarantineAccount(alias) == "reconcile.quarantine.\(alias)",
            "quarantine account is not the bearer"
        )
        expect(
            PaykitLinkAuthProtocol.bootCounterAccount == "reconcile.boot",
            "boot counter account"
        )
        let accounts = [
            PaykitLinkAuthProtocol.sessionAccount(alias),
            PaykitLinkAuthProtocol.pendingAccount(alias),
            PaykitLinkAuthProtocol.sessionAccount("other"),
            PaykitLinkAuthProtocol.quarantineAccount(alias),
            PaykitLinkAuthProtocol.bootCounterAccount,
            "receiver.\(alias)",
        ]
        expect(
            PaykitLinkAuthProtocol.pendingAliases(fromAccounts: accounts) == [alias],
            "pending parse skips session keys"
        )
        expect(
            PaykitLinkAuthProtocol.sessionAliases(fromAccounts: accounts) == [alias, "other"],
            "session parse skips pending and reconcile keys"
        )
        expect(
            PaykitLinkAuthProtocol.sessionAlias(fromAccount: "session.pending.x") == nil,
            "pending key is not a session alias"
        )
        expect(
            PaykitLinkAuthProtocol.quarantineAlias(fromAccount: PaykitLinkAuthProtocol.quarantineAccount(alias))
                == alias,
            "quarantine parse"
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

        expect(pendingAliases.contains(pending), "death before adopt still pending")

        let first = PaykitLinkAuthProtocol.reconcileDecisions(
            sessionAliases: sessionAliases,
            pendingAliases: pendingAliases,
            inFlightAliases: [],
            knownAliases: [],
            quarantines: [:],
            currentBoot: 1
        )
        let firstByAlias = Dictionary(uniqueKeysWithValues: first.map { ($0.alias, $0.action) })
        expect(firstByAlias[orphan] == .firstSighting, "first unowned sighting quarantines")
        expect(firstByAlias[kept] == .firstSighting, "unowned adopted quarantined, not deleted")
        expect(firstByAlias[pending] == .skipInFlight, "pending excluded from adopted reconcile")
        expect(!first.contains(where: { $0.action == .subsequentDelete }), "first boot does not delete")

        let encoded = PaykitLinkAuthProtocol.encodeQuarantine(
            PaykitLinkAuthProtocol.QuarantineRecord(bootCounter: 1, quarantinedAtMs: 99)
        )
        expect(
            PaykitLinkAuthProtocol.parseQuarantine(encoded)
                == PaykitLinkAuthProtocol.QuarantineRecord(bootCounter: 1, quarantinedAtMs: 99),
            "quarantine record round-trips"
        )

        let normal = PaykitLinkAuthProtocol.reconcileDecisions(
            sessionAliases: [kept],
            pendingAliases: [],
            inFlightAliases: [],
            knownAliases: [kept],
            quarantines: [:],
            currentBoot: 1
        )
        expect(normal.isEmpty, "owned alias: no quarantine and no delete")
    }

    static func testQuarantineTwoSighting() {
        expect(
            PaykitLinkAuthProtocol.quarantineAction(
                ownedByKeyStore: false,
                inFlight: false,
                existingQuarantineBoot: nil,
                currentBoot: 1
            ) == .firstSighting,
            "first sighting"
        )
        expect(
            PaykitLinkAuthProtocol.quarantineAction(
                ownedByKeyStore: false,
                inFlight: false,
                existingQuarantineBoot: 1,
                currentBoot: 2
            ) == .subsequentDelete,
            "second consecutive boot deletes"
        )
        expect(
            PaykitLinkAuthProtocol.nextBootCounter(1) == 2,
            "boot counter increments"
        )
        let second = PaykitLinkAuthProtocol.reconcileDecisions(
            sessionAliases: ["orphan"],
            pendingAliases: [],
            inFlightAliases: [],
            knownAliases: [],
            quarantines: ["orphan": 1],
            currentBoot: 2
        )
        expect(second == [PaykitLinkAuthProtocol.ReconcileDecision(alias: "orphan", action: .subsequentDelete)],
               "second boot decision is delete")
    }

    static func testQuarantineInFlightAndOwnedClear() {
        expect(
            PaykitLinkAuthProtocol.quarantineAction(
                ownedByKeyStore: false,
                inFlight: true,
                existingQuarantineBoot: nil,
                currentBoot: 1
            ) == .skipInFlight,
            "in-flight excluded"
        )
        expect(
            PaykitLinkAuthProtocol.quarantineAction(
                ownedByKeyStore: true,
                inFlight: false,
                existingQuarantineBoot: 1,
                currentBoot: 2
            ) == .clearOwned,
            "owned clears quarantine"
        )
        let skipped = PaykitLinkAuthProtocol.reconcileDecisions(
            sessionAliases: ["inflight"],
            pendingAliases: [],
            inFlightAliases: ["inflight"],
            knownAliases: [],
            quarantines: [:],
            currentBoot: 1
        )
        expect(
            skipped == [PaykitLinkAuthProtocol.ReconcileDecision(alias: "inflight", action: .skipInFlight)],
            "in-flight decision"
        )
        let cleared = PaykitLinkAuthProtocol.reconcileDecisions(
            sessionAliases: ["kept"],
            pendingAliases: [],
            inFlightAliases: [],
            knownAliases: ["kept"],
            quarantines: ["kept": 1],
            currentBoot: 2
        )
        expect(
            cleared == [PaykitLinkAuthProtocol.ReconcileDecision(alias: "kept", action: .clearOwned)],
            "owned-in-between clears"
        )
        let ownedNoPrior = PaykitLinkAuthProtocol.reconcileDecisions(
            sessionAliases: ["kept"],
            pendingAliases: [],
            inFlightAliases: [],
            knownAliases: ["kept"],
            quarantines: [:],
            currentBoot: 1
        )
        expect(ownedNoPrior.isEmpty, "owned with no quarantine is a no-op")
    }

    static func expect(_ condition: Bool, _ message: String) {
        if !condition {
            fputs("FAIL: \(message)\n", stderr)
            exit(1)
        }
    }
}
