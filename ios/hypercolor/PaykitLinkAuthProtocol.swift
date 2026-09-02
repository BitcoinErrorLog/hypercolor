import Foundation

/// Lock-free pending → adopted session protocol.
///
/// `PaykitLinkModule` uses this for Keychain account names, sweep latching,
/// persist ordering, session lookup, and boot reconciliation. Compiled and
/// asserted independently by `ios/scripts/test-paykit-link-auth-protocol.swift`
/// because there is no iOS test host.
///
/// Invariant: a valid bearer must never exist with neither a pending marker
/// nor a JS KeyStore reference. JS writes KeyStore first; native adopt only
/// deletes the marker. Boot reconciliation deletes adopted bearers KeyStore
/// does not name. The process-start pending sweep deletes leftover markers.
enum PaykitLinkAuthProtocol {
    static let sessionPrefix = "session."
    static let pendingPrefix = "session.pending."

    static func sessionAccount(_ alias: String) -> String { sessionPrefix + alias }
    static func pendingAccount(_ alias: String) -> String { pendingPrefix + alias }

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

    static func pendingAliases(fromAccounts accounts: [String]) -> [String] {
        accounts.compactMap { pendingAlias(fromAccount: $0) }
    }

    static func sessionAliases(fromAccounts accounts: [String]) -> [String] {
        accounts.compactMap { sessionAlias(fromAccount: $0) }
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
    /// `adoptHarnessSession`'s `unavailable` fallback from resurrecting an
    /// orphan.
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

    /// Adopted bearers (no pending marker) that KeyStore does not name.
    static func orphanAdoptedAliases(
        sessionAliases: [String],
        pendingAliases: Set<String>,
        knownAliases: Set<String>
    ) -> [String] {
        sessionAliases.filter { alias in
            !pendingAliases.contains(alias) && !knownAliases.contains(alias)
        }
    }
}
