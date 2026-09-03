import Foundation

/// Lock-free pending → adopted session protocol.
///
/// `PaykitLinkModule` uses this for Keychain account names, sweep latching,
/// persist ordering, session lookup, and boot reconciliation. Compiled and
/// asserted independently by `ios/scripts/test-paykit-link-auth-protocol.swift`
/// because there is no iOS test host.
///
/// This type is lock-free by construction. `NSLock` / `pendingIoLock`
/// discipline stays in `PaykitLinkModule` (r10 P0-1). Every state
/// transition the module performs on pending/adopted sessions goes through
/// these helpers. The module still owns: (1) lock acquire/release order,
/// (2) deferring Keychain I/O until `sessionStep` can no longer settle
/// from in-memory flags (r10 P2-2), (3) mapping Keychain OSStatus to
/// `ListOutcome` in `listAccounts` before `shouldLatchSweep`.
///
/// Invariant: a valid bearer must never exist with neither a pending marker
/// nor a JS KeyStore reference. JS writes KeyStore first; native adopt only
/// deletes the marker. Boot reconciliation (keystore-ready only) uses
/// two-sighting quarantine as a report-only evidence trail: first unowned
/// sighting records `quarantined_at` + boot counter in a durable account
/// that is not the bearer; a subsequent keystore-ready boot logs the
/// opaque alias id and keeps the bearer. The process-start pending sweep
/// still deletes leftover pending markers that were never adopted.
///
/// `session.$alias` vs `session.pending.$alias` collides if JS supplies
/// alias `pending.X`. Production enable/signin aliases are UUID. A
/// JS-supplied alias path does exist (`LinkService.adoptHarnessSession`);
/// it is `__DEV__`-gated and inert in release. Waiver: unreachable in
/// production, not "no such path exists".
enum PaykitLinkAuthProtocol {
    static let sessionPrefix = "session."
    static let pendingPrefix = "session.pending."
    static let bootCounterAccount = "reconcile.boot"
    static let quarantinePrefix = "reconcile.quarantine."

    static func sessionAccount(_ alias: String) -> String { sessionPrefix + alias }
    static func pendingAccount(_ alias: String) -> String { pendingPrefix + alias }
    static func quarantineAccount(_ alias: String) -> String { quarantinePrefix + alias }

    static func pendingAlias(fromAccount account: String) -> String? {
        guard account.hasPrefix(pendingPrefix) else { return nil }
        return String(account.dropFirst(pendingPrefix.count))
    }

    static func sessionAlias(fromAccount account: String) -> String? {
        guard account.hasPrefix(sessionPrefix), !account.hasPrefix(pendingPrefix) else {
            return nil
        }
        return String(account.dropFirst(sessionPrefix.count))
    }

    static func quarantineAlias(fromAccount account: String) -> String? {
        guard account.hasPrefix(quarantinePrefix) else { return nil }
        return String(account.dropFirst(quarantinePrefix.count))
    }

    static func pendingAliases(fromAccounts accounts: [String]) -> [String] {
        accounts.compactMap { pendingAlias(fromAccount: $0) }
    }

    static func sessionAliases(fromAccounts accounts: [String]) -> [String] {
        accounts.compactMap { sessionAlias(fromAccount: $0) }
    }

    struct QuarantineRecord: Equatable {
        var bootCounter: UInt64
        var quarantinedAtMs: UInt64
        var processToken: String
    }

    static func encodeQuarantine(_ record: QuarantineRecord) -> String {
        "\(record.bootCounter):\(record.quarantinedAtMs):\(record.processToken)"
    }

    static func parseQuarantine(_ raw: String) -> QuarantineRecord? {
        let parts = raw.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        guard parts.count >= 2,
              let boot = UInt64(parts[0]),
              let at = UInt64(parts[1])
        else { return nil }
        let token = parts.count >= 3 ? String(parts[2]) : ""
        return QuarantineRecord(bootCounter: boot, quarantinedAtMs: at, processToken: token)
    }

    enum QuarantineAction: Equatable {
        case skipInFlight
        case clearOwned
        case firstSighting
        case subsequentReport
        case none
    }

    struct ReconcileDecision: Equatable {
        var alias: String
        var action: QuarantineAction
    }

    /// Reserved/awaiting flows have no session alias until persist.
    /// Pending (durable or in-memory) and adopting aliases are in-flight.
    /// Two-sighting quarantine, report-only. Second sighting logs only when
    /// the boot counter advanced *and* the process token differs from the
    /// recorded sighting — a JS reload in one OS process cannot produce a
    /// subsequent report. A legacy two-field record (empty process token)
    /// is rewritten as a first sighting. This path never deletes a bearer.
    static func quarantineAction(
        ownedByKeyStore: Bool,
        inFlight: Bool,
        existingQuarantineBoot: UInt64?,
        currentBoot: UInt64,
        existingProcessToken: String?,
        currentProcessToken: String
    ) -> QuarantineAction {
        if inFlight { return .skipInFlight }
        if ownedByKeyStore {
            return existingQuarantineBoot == nil ? .none : .clearOwned
        }
        if existingQuarantineBoot == nil { return .firstSighting }
        let recorded = existingProcessToken ?? ""
        if recorded.isEmpty { return .firstSighting }
        if let seen = existingQuarantineBoot,
           seen < currentBoot,
           recorded != currentProcessToken
        {
            return .subsequentReport
        }
        return .none
    }

    static func subsequentSightingLogLine(alias: String, boot: UInt64) -> String {
        "PaykitLinkReconcile subsequent-sighting alias=\(alias) boot=\(boot)"
    }

    static func nextBootCounter(_ current: UInt64) -> UInt64 {
        current + 1
    }

    static func reconcileDecisions(
        sessionAliases: [String],
        pendingAliases: Set<String>,
        inFlightAliases: Set<String>,
        knownAliases: Set<String>,
        quarantines: [String: QuarantineRecord],
        currentBoot: UInt64,
        currentProcessToken: String
    ) -> [ReconcileDecision] {
        var decisions: [ReconcileDecision] = []
        var seen = Set<String>()
        for alias in knownAliases {
            let inFlight = pendingAliases.contains(alias) || inFlightAliases.contains(alias)
            let existing = quarantines[alias]
            let action = quarantineAction(
                ownedByKeyStore: true,
                inFlight: inFlight,
                existingQuarantineBoot: existing?.bootCounter,
                currentBoot: currentBoot,
                existingProcessToken: existing?.processToken,
                currentProcessToken: currentProcessToken
            )
            if action == .clearOwned {
                decisions.append(ReconcileDecision(alias: alias, action: action))
                seen.insert(alias)
            }
        }
        for alias in sessionAliases {
            if seen.contains(alias) { continue }
            let inFlight = pendingAliases.contains(alias) || inFlightAliases.contains(alias)
            let existing = quarantines[alias]
            let action = quarantineAction(
                ownedByKeyStore: knownAliases.contains(alias),
                inFlight: inFlight,
                existingQuarantineBoot: existing?.bootCounter,
                currentBoot: currentBoot,
                existingProcessToken: existing?.processToken,
                currentProcessToken: currentProcessToken
            )
            if action != .none {
                decisions.append(ReconcileDecision(alias: alias, action: action))
            }
        }
        return decisions
    }

    /// SecItem list classification. `errSecItemNotFound` is empty; lock-state
    /// and entitlement errors are unavailable so the once-only sweep must not
    /// latch. Numeric values match Security.framework OSStatus constants.
    enum ListOutcome: Equatable {
        case items
        case empty
        case unavailable
        case failed
    }

    static let errSecSuccess: Int32 = 0
    static let errSecItemNotFound: Int32 = -25300
    static let errSecNotAvailable: Int32 = -25291
    static let errSecInteractionNotAllowed: Int32 = -25308
    static let errSecMissingEntitlement: Int32 = -34018

    static func classifyListStatus(_ status: Int32) -> ListOutcome {
        if status == errSecSuccess { return .items }
        if status == errSecItemNotFound { return .empty }
        if status == errSecInteractionNotAllowed
            || status == errSecNotAvailable
            || status == errSecMissingEntitlement
        {
            return .unavailable
        }
        return .failed
    }

    enum ItemReadOutcome: Equatable {
        case presentOrOther
        case absent
        case unavailable
    }

    /// Get-path classification: lock/not-available must not fold into absent
    /// (that would let JS delete a live KeyStore alias). Only not-found is absent.
    static func classifyItemReadStatus(_ status: Int32) -> ItemReadOutcome {
        if status == errSecItemNotFound { return .absent }
        if status == errSecInteractionNotAllowed || status == errSecNotAvailable {
            return .unavailable
        }
        return .presentOrOther
    }

    /// Session bearer write-back is allowed only while the alias is still live
    /// (not pending-adopt, not deleted). Mirrors the module's pendingIoLock gate.
    static func shouldWriteBackRotatedBearer(
        adopting: Bool,
        bearerStillPresent: Bool
    ) -> Bool {
        !adopting && bearerStillPresent
    }


    static func shouldLatchSweep(after outcome: ListOutcome) -> Bool {
        switch outcome {
        case .items, .empty:
            return true
        case .unavailable, .failed:
            return false
        }
    }

    enum SessionStep: Equatable {
        case refusePending
        case returnLive
        case refuseDurablePending
        case restore
        case notFound
    }

    /// In-memory pending, then live cache, then durable marker, then bearer.
    /// Pending and unknown aliases must never restore — that is what keeps
    /// a `__DEV__` `unavailable` restore fallback from resurrecting an
    /// orphan. Production enable/signin do not restore on `unavailable`.
    static func sessionStep(
        pendingInMemory: Bool,
        hasLive: Bool,
        durablePending: Bool,
        hasBearer: Bool
    ) -> SessionStep {
        if pendingInMemory { return .refusePending }
        if hasLive { return .returnLive }
        if durablePending { return .refuseDurablePending }
        if hasBearer { return .restore }
        return .notFound
    }

    /// Marker first, then bearer. Second-step failure rolls back the first.
    /// Crash between the two leaves marker-without-bearer, which the pending
    /// sweep already collects.
    static func writeMarkerThenBearer(
        writeMarker: () throws -> Void,
        writeBearer: () throws -> Void,
        rollback: () -> Void
    ) throws {
        try writeMarker()
        do {
            try writeBearer()
        } catch {
            rollback()
            throw error
        }
    }
}
