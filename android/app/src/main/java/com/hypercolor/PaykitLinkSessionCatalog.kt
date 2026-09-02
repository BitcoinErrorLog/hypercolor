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
}

internal object PaykitLinkSessionKeys {
    const val SESSION_PREFIX = "session."
    const val PENDING_PREFIX = "session.pending."

    fun sessionKey(alias: String): String = "$SESSION_PREFIX$alias"

    fun sessionPendingKey(alias: String): String = "$PENDING_PREFIX$alias"

    fun pendingAliasFromKey(key: String): String? {
        return if (key.startsWith(PENDING_PREFIX)) key.removePrefix(PENDING_PREFIX) else null
    }

    fun sessionAliasFromKey(key: String): String? {
        if (!key.startsWith(SESSION_PREFIX) || key.startsWith(PENDING_PREFIX)) {
            return null
        }
        return key.removePrefix(SESSION_PREFIX)
    }
}

/**
 * [session] refuses still-pending aliases (in-memory pending set or durable
 * marker) and unknown aliases (no bearer). [LinkService.adoptHarnessSession]
 * may call `restoreSession` only after `adoptAuthSession` rejects
 * `unavailable`; that fallback is safe only while this refusal holds.
 */
internal object PaykitLinkSessionGuard {
    fun isPending(pendingInMemory: Boolean, durablePending: Boolean): Boolean {
        return pendingInMemory || durablePending
    }
}

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
     * Boot pass: delete adopted bearers (no pending marker) that KeyStore
     * does not reference. Still-pending aliases are left for
     * [sweepPendingLeftovers] / in-flight enable.
     */
    fun collectUnreferencedAdopted(
        store: PaykitLinkSessionCatalog,
        knownAliases: Set<String>,
        evict: (String) -> Unit,
    ): List<String> {
        val pending = store.listPendingSessionAliases().toHashSet()
        val collected = ArrayList<String>()
        for (alias in store.listSessionAliases()) {
            if (alias in pending) continue
            if (alias in knownAliases) continue
            evict(alias)
            store.deleteSession(alias)
            collected.add(alias)
        }
        return collected
    }
}
