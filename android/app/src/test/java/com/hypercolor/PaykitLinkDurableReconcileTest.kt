package com.hypercolor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaykitLinkDurableReconcileTest {
    @Test
    fun sessionKeysParsePendingAndSessionPrefixes() {
        val alias = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        assertEquals("session.$alias", PaykitLinkSessionKeys.sessionKey(alias))
        assertEquals("session.pending.$alias", PaykitLinkSessionKeys.sessionPendingKey(alias))
        assertEquals("reconcile.quarantine.$alias", PaykitLinkSessionKeys.quarantineKey(alias))
        assertEquals(alias, PaykitLinkSessionKeys.pendingAliasFromKey("session.pending.$alias"))
        assertEquals(alias, PaykitLinkSessionKeys.sessionAliasFromKey("session.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.sessionAliasFromKey("session.pending.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.pendingAliasFromKey("session.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.sessionAliasFromKey("receiver.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.sessionAliasFromKey("reconcile.quarantine.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.sessionAliasFromKey("reconcile.boot"))
        assertEquals(alias, PaykitLinkSessionKeys.quarantineAliasFromKey("reconcile.quarantine.$alias"))
    }

    @Test
    fun putPendingSessionWritesMarkerAndBearerTogether() {
        val store = InMemoryPaykitLinkSessionStore()
        store.putPendingSession("a1", "token")
        assertEquals(mapOf("a1" to "token"), store.bearers)
        assertTrue(store.pendingMarkers.contains("a1"))
        assertTrue(store.hasPendingMarker("a1"))
        assertTrue(store.hasSessionBearer("a1"))
        assertEquals(listOf("a1"), store.listPendingSessionAliases())
        assertEquals(listOf("a1"), store.listSessionAliases())
    }

    @Test
    fun sessionGuardRefusesPendingAndUnknown() {
        assertTrue(PaykitLinkSessionGuard.isPending(pendingInMemory = true, durablePending = false))
        assertTrue(PaykitLinkSessionGuard.isPending(pendingInMemory = false, durablePending = true))
        assertFalse(PaykitLinkSessionGuard.isPending(pendingInMemory = false, durablePending = false))

        val store = InMemoryPaykitLinkSessionStore()
        store.putPendingSession("pending", "token")
        assertTrue(
            PaykitLinkSessionGuard.isPending(
                pendingInMemory = false,
                durablePending = store.hasPendingMarker("pending"),
            ),
        )
        assertFalse(store.hasSessionBearer("unknown"))
        assertFalse(store.hasPendingMarker("unknown"))
        assertFalse(
            PaykitLinkSessionGuard.isPending(
                pendingInMemory = false,
                durablePending = store.hasPendingMarker("unknown"),
            ),
        )
    }

    @Test
    fun sessionGuardPinsPendingRefusalUsedByRestoreFallback() {
        val registry = AuthFlowCancelRegistry<String>()
        val store = InMemoryPaykitLinkSessionStore()
        registry.registerPending("pending")
        store.putPendingSession("pending", "token")
        assertTrue(
            PaykitLinkSessionGuard.isPending(
                registry.isPending("pending"),
                store.hasPendingMarker("pending"),
            ),
        )
        assertTrue(registry.adoptPending("pending"))
        store.clearPendingMarker("pending")
        assertFalse(
            PaykitLinkSessionGuard.isPending(
                registry.isPending("pending"),
                store.hasPendingMarker("pending"),
            ),
        )
        assertTrue(store.hasSessionBearer("pending"))
        assertFalse(store.hasSessionBearer("unknown"))
        assertFalse(
            PaykitLinkSessionGuard.isPending(
                registry.isPending("unknown"),
                store.hasPendingMarker("unknown"),
            ),
        )
    }

    @Test
    fun deathBeforeAdoptPendingSweepCollects() {
        val store = InMemoryPaykitLinkSessionStore()
        val sessions = linkedMapOf("pending" to "token")
        store.putPendingSession("pending", "token")

        val swept = PaykitLinkDurableReconcile.sweepPendingLeftovers(store) { sessions.remove(it) }

        assertEquals(listOf("pending"), swept)
        assertTrue(store.bearers.isEmpty())
        assertTrue(store.pendingMarkers.isEmpty())
        assertTrue(sessions.isEmpty())
    }

    @Test
    fun firstUnownedSightingQuarantinesInsteadOfDeleting() {
        val store = InMemoryPaykitLinkSessionStore()
        val sessions = linkedMapOf("orphan" to "token")
        store.putPendingSession("orphan", "token")
        store.clearPendingMarker("orphan")
        assertTrue(store.hasSessionBearer("orphan"))
        assertFalse(store.hasPendingMarker("orphan"))

        val result = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
            inFlightAliases = emptySet(),
            nowMs = 1_700_000_000_000L,
        ) { sessions.remove(it) }

        assertEquals(1L, result.bootCounter)
        assertEquals(listOf("orphan"), result.quarantined)
        assertTrue(result.deleted.isEmpty())
        assertEquals(mapOf("orphan" to "token"), store.bearers)
        assertEquals(mapOf("orphan" to "token"), sessions)
        assertEquals(
            PaykitLinkQuarantineRecord(1L, 1_700_000_000_000L),
            store.getQuarantine("orphan"),
        )
    }

    @Test
    fun secondConsecutiveUnownedBootDeletes() {
        val store = InMemoryPaykitLinkSessionStore()
        val sessions = linkedMapOf("orphan" to "token")
        store.putPendingSession("orphan", "token")
        store.clearPendingMarker("orphan")

        PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
            inFlightAliases = emptySet(),
            nowMs = 1L,
        ) { sessions.remove(it) }
        val second = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
            inFlightAliases = emptySet(),
            nowMs = 2L,
        ) { sessions.remove(it) }

        assertEquals(2L, second.bootCounter)
        assertEquals(listOf("orphan"), second.deleted)
        assertTrue(second.quarantined.isEmpty())
        assertTrue(store.bearers.isEmpty())
        assertTrue(sessions.isEmpty())
        assertEquals(null, store.getQuarantine("orphan"))
    }

    @Test
    fun ownedInBetweenClearsQuarantine() {
        val store = InMemoryPaykitLinkSessionStore()
        store.putPendingSession("kept", "token")
        store.clearPendingMarker("kept")

        PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
            inFlightAliases = emptySet(),
            nowMs = 1L,
        ) {}
        assertTrue(store.getQuarantine("kept") != null)

        val owned = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = setOf("kept"),
            inFlightAliases = emptySet(),
            nowMs = 2L,
        ) {}
        assertTrue(owned.cleared.contains("kept"))
        assertEquals(null, store.getQuarantine("kept"))
        assertEquals(mapOf("kept" to "token"), store.bearers)

        val again = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
            inFlightAliases = emptySet(),
            nowMs = 3L,
        ) {}
        assertEquals(listOf("kept"), again.quarantined)
        assertTrue(again.deleted.isEmpty())
        assertTrue(store.hasSessionBearer("kept"))
    }

    @Test
    fun inFlightAliasIsExcluded() {
        val store = InMemoryPaykitLinkSessionStore()
        store.putPendingSession("inflight", "token")
        store.clearPendingMarker("inflight")
        val registry = AuthFlowCancelRegistry<String>()
        registry.registerPending("inflight")

        val result = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
            inFlightAliases = registry.inFlightSessionAliases(),
            nowMs = 1L,
        ) {}
        assertTrue(result.quarantined.isEmpty())
        assertTrue(result.deleted.isEmpty())
        assertTrue(result.skippedInFlight.contains("inflight"))
        assertTrue(store.hasSessionBearer("inflight"))
        assertEquals(null, store.getQuarantine("inflight"))
    }

    @Test
    fun durablePendingIsExcludedEvenWhenNotInInFlightSet() {
        val store = InMemoryPaykitLinkSessionStore()
        store.putPendingSession("inflight", "token")
        val collected = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
            inFlightAliases = emptySet(),
            nowMs = 1L,
        ) {}
        assertTrue(collected.quarantined.isEmpty())
        assertTrue(collected.deleted.isEmpty())
        assertTrue(store.hasSessionBearer("inflight"))
        assertTrue(store.hasPendingMarker("inflight"))
    }

    @Test
    fun normalPathNothingCollected() {
        val store = InMemoryPaykitLinkSessionStore()
        val sessions = linkedMapOf("kept" to "token")
        store.putPendingSession("kept", "token")
        store.clearPendingMarker("kept")

        val pendingSwept = PaykitLinkDurableReconcile.sweepPendingLeftovers(store) { sessions.remove(it) }
        assertTrue(pendingSwept.isEmpty())
        val collected = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            knownAliases = setOf("kept"),
            inFlightAliases = emptySet(),
            nowMs = 1L,
        ) { sessions.remove(it) }

        assertTrue(collected.quarantined.isEmpty())
        assertTrue(collected.deleted.isEmpty())
        assertEquals(mapOf("kept" to "token"), store.bearers)
        assertEquals(mapOf("kept" to "token"), sessions)
        assertEquals(1L, collected.bootCounter)
    }

    @Test
    fun quarantineActionMatchesTwoSightingProtocol() {
        assertEquals(
            PaykitLinkQuarantineAction.SkipInFlight,
            PaykitLinkDurableReconcile.quarantineAction(false, true, null, 1L),
        )
        assertEquals(
            PaykitLinkQuarantineAction.FirstSighting,
            PaykitLinkDurableReconcile.quarantineAction(false, false, null, 1L),
        )
        assertEquals(
            PaykitLinkQuarantineAction.SubsequentDelete,
            PaykitLinkDurableReconcile.quarantineAction(false, false, 1L, 2L),
        )
        assertEquals(
            PaykitLinkQuarantineAction.ClearOwned,
            PaykitLinkDurableReconcile.quarantineAction(true, false, 1L, 2L),
        )
        assertEquals(
            PaykitLinkQuarantineAction.None,
            PaykitLinkDurableReconcile.quarantineAction(true, false, null, 2L),
        )
        assertEquals(
            PaykitLinkQuarantineAction.None,
            PaykitLinkDurableReconcile.quarantineAction(false, false, 2L, 2L),
        )
    }

    @Test
    fun bootCounterPersistsAcrossReconcileCalls() {
        val store = InMemoryPaykitLinkSessionStore()
        store.putPendingSession("orphan", "token")
        store.clearPendingMarker("orphan")
        PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            emptySet(),
            emptySet(),
            10L,
        ) {}
        assertEquals(1L, store.getBootCounter())
        PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
            store,
            emptySet(),
            emptySet(),
            11L,
        ) {}
        assertEquals(2L, store.getBootCounter())
    }
}
