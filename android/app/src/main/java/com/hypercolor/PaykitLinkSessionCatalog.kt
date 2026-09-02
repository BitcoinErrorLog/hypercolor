package com.hypercolor

/**
 * Durable session catalog used by [PaykitLinkModule] and by JVM tests with
 * [InMemoryPaykitLinkSessionStore]. Production [PaykitLinkStore] encrypts
 * values; the in-memory impl stores plaintext. Sweep / adopt / reconcile
 * logic is identical.
 */
internal interface PaykitLinkSessionCatalog {
    fun putPendingSession(alias: String, bearer: String)
    fun clearPendingMarker(alias: String)
    fun deleteSession(alias: String)
    fun hasPendingMarker(alias: String): Boolean
    fun hasSessionBearer(alias: String): Boolean
    fun listPendingSessionAliases(): List<String>
    fun listSessionAliases(): List<String>
    fun getBootCounter(): Long
    fun setBootCounter(value: Long)
    fun getQuarantine(alias: String): PaykitLinkQuarantineRecord?
    fun putQuarantine(alias: String, record: PaykitLinkQuarantineRecord)
    fun clearQuarantine(alias: String)
}

internal data class PaykitLinkQuarantineRecord(
    val bootCounter: Long,
    val quarantinedAtMs: Long,
)

internal object PaykitLinkSessionKeys {
    const val SESSION_PREFIX = "session."
    const val PENDING_PREFIX = "session.pending."
    const val BOOT_COUNTER_KEY = "reconcile.boot"
    const val QUARANTINE_PREFIX = "reconcile.quarantine."

    fun sessionKey(alias: String): String = "$SESSION_PREFIX$alias"

    fun sessionPendingKey(alias: String): String = "$PENDING_PREFIX$alias"

    fun quarantineKey(alias: String): String = "$QUARANTINE_PREFIX$alias"

    fun pendingAliasFromKey(key: String): String? {
        return if (key.startsWith(PENDING_PREFIX)) key.removePrefix(PENDING_PREFIX) else null
    }

    /**
     * `session.$alias` vs `session.pending.$alias` collides if JS supplies
     * alias `pending.X`. Production enable/signin aliases are UUID.
     * A JS-supplied alias path does exist (`LinkService.adoptHarnessSession`);
     * it is `__DEV__`-gated and inert in release builds. Waiver: unreachable
     * in production, not "no such path exists".
     */
    fun sessionAliasFromKey(key: String): String? {
        if (!key.startsWith(SESSION_PREFIX) || key.startsWith(PENDING_PREFIX)) {
            return null
        }
        return key.removePrefix(SESSION_PREFIX)
    }

    fun quarantineAliasFromKey(key: String): String? {
        return if (key.startsWith(QUARANTINE_PREFIX)) key.removePrefix(QUARANTINE_PREFIX) else null
    }

    fun formatQuarantine(record: PaykitLinkQuarantineRecord): String {
        return "${record.bootCounter}:${record.quarantinedAtMs}"
    }

    fun parseQuarantine(raw: String): PaykitLinkQuarantineRecord? {
        val sep = raw.indexOf(':')
        if (sep <= 0) return null
        val boot = raw.substring(0, sep).toLongOrNull() ?: return null
        val at = raw.substring(sep + 1).toLongOrNull() ?: return null
        return PaykitLinkQuarantineRecord(boot, at)
    }
}

/**
 * [session] refuses still-pending aliases (in-memory pending set or durable
 * marker) and unknown aliases (no bearer). `LinkService.adoptHarnessSession`
 * is `__DEV__`-only; production enable/signin must not restore on
 * `unavailable`.
 */
internal object PaykitLinkSessionGuard {
    fun isPending(pendingInMemory: Boolean, durablePending: Boolean): Boolean {
        return pendingInMemory || durablePending
    }
}

internal enum class PaykitLinkQuarantineAction {
    SkipInFlight,
    ClearOwned,
    FirstSighting,
    SubsequentDelete,
    None,
}

internal data class PaykitLinkReconcileResult(
    val bootCounter: Long,
    val quarantined: List<String>,
    val deleted: List<String>,
    val cleared: List<String>,
    val skippedInFlight: List<String>,
)

/**
 * Production sweep / boot-reconcile. Invoked by [PaykitLinkModule] and by
 * unit tests against an in-memory catalog — not reimplemented in tests.
 */
internal object PaykitLinkDurableReconcile {
    fun deleteAliases(
        store: PaykitLinkSessionCatalog,
        aliases: Collection<String>,
        evict: (String) -> Unit,
    ) {
        for (alias in aliases) {
            evict(alias)
            store.deleteSession(alias)
        }
    }

    /**
     * Process-death leftovers: a durable pending marker with no live
     * runtime means JS never wrote KeyStore and never adopted. Delete
     * bearer + marker.
     */
    fun sweepPendingLeftovers(
        store: PaykitLinkSessionCatalog,
        evict: (String) -> Unit,
    ): List<String> {
        val leftovers = store.listPendingSessionAliases()
        deleteAliases(store, leftovers, evict)
        return leftovers
    }

    /**
     * Two-sighting quarantine for adopted bearers KeyStore does not name.
     * First keystore-ready boot records [PaykitLinkQuarantineRecord] (not
     * in the bearer) and leaves the bearer in place; [session] still
     * refuses unknown aliases from JS. A subsequent keystore-ready boot
     * that still does not name the alias deletes it. KeyStore naming the
     * alias at any point clears quarantine. In-flight aliases
     * (reserved/awaiting have no alias yet; pending/adopting do) are
     * excluded.
     */
    fun quarantineAction(
        ownedByKeyStore: Boolean,
        inFlight: Boolean,
        existingQuarantineBoot: Long?,
        currentBoot: Long,
    ): PaykitLinkQuarantineAction {
        if (inFlight) return PaykitLinkQuarantineAction.SkipInFlight
        if (ownedByKeyStore) {
            return if (existingQuarantineBoot != null) {
                PaykitLinkQuarantineAction.ClearOwned
            } else {
                PaykitLinkQuarantineAction.None
            }
        }
        if (existingQuarantineBoot == null) return PaykitLinkQuarantineAction.FirstSighting
        if (existingQuarantineBoot < currentBoot) return PaykitLinkQuarantineAction.SubsequentDelete
        return PaykitLinkQuarantineAction.None
    }

    fun reconcileUnreferencedAdopted(
        store: PaykitLinkSessionCatalog,
        knownAliases: Set<String>,
        inFlightAliases: Set<String>,
        nowMs: Long,
        evict: (String) -> Unit,
    ): PaykitLinkReconcileResult {
        val boot = store.getBootCounter() + 1L
        store.setBootCounter(boot)
        val pending = store.listPendingSessionAliases().toHashSet()
        val quarantined = ArrayList<String>()
        val deleted = ArrayList<String>()
        val cleared = ArrayList<String>()
        val skipped = ArrayList<String>()

        for (alias in knownAliases) {
            val existing = store.getQuarantine(alias)
            val action = quarantineAction(
                ownedByKeyStore = true,
                inFlight = alias in pending || alias in inFlightAliases,
                existingQuarantineBoot = existing?.bootCounter,
                currentBoot = boot,
            )
            if (action == PaykitLinkQuarantineAction.ClearOwned) {
                store.clearQuarantine(alias)
                cleared.add(alias)
            }
        }

        for (alias in store.listSessionAliases()) {
            val inFlight = alias in pending || alias in inFlightAliases
            val owned = alias in knownAliases
            val existing = store.getQuarantine(alias)
            val action = quarantineAction(
                ownedByKeyStore = owned,
                inFlight = inFlight,
                existingQuarantineBoot = existing?.bootCounter,
                currentBoot = boot,
            )
            when (action) {
                PaykitLinkQuarantineAction.SkipInFlight -> skipped.add(alias)
                PaykitLinkQuarantineAction.ClearOwned -> {
                    if (alias !in cleared) {
                        store.clearQuarantine(alias)
                        cleared.add(alias)
                    }
                }
                PaykitLinkQuarantineAction.FirstSighting -> {
                    store.putQuarantine(alias, PaykitLinkQuarantineRecord(boot, nowMs))
                    quarantined.add(alias)
                }
                PaykitLinkQuarantineAction.SubsequentDelete -> {
                    evict(alias)
                    store.deleteSession(alias)
                    store.clearQuarantine(alias)
                    deleted.add(alias)
                }
                PaykitLinkQuarantineAction.None -> Unit
            }
        }
        return PaykitLinkReconcileResult(
            bootCounter = boot,
            quarantined = quarantined,
            deleted = deleted,
            cleared = cleared,
            skippedInFlight = skipped,
        )
    }
}
