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
        assertEquals(alias, PaykitLinkSessionKeys.pendingAliasFromKey("session.pending.$alias"))
        assertEquals(alias, PaykitLinkSessionKeys.sessionAliasFromKey("session.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.sessionAliasFromKey("session.pending.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.pendingAliasFromKey("session.$alias"))
        assertEquals(null, PaykitLinkSessionKeys.sessionAliasFromKey("receiver.$alias"))
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
    fun deathBetweenMarkerDeleteAndKeyStoreWriteBootReconcileCollects() {
        val store = InMemoryPaykitLinkSessionStore()
        val sessions = linkedMapOf("orphan" to "token")
        store.putPendingSession("orphan", "token")
        store.clearPendingMarker("orphan")
        assertTrue(store.hasSessionBearer("orphan"))
        assertFalse(store.hasPendingMarker("orphan"))

        val collected = PaykitLinkDurableReconcile.collectUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
        ) { sessions.remove(it) }

        assertEquals(listOf("orphan"), collected)
        assertTrue(store.bearers.isEmpty())
        assertTrue(sessions.isEmpty())
    }

    @Test
    fun normalPathNothingCollected() {
        val store = InMemoryPaykitLinkSessionStore()
        val sessions = linkedMapOf("kept" to "token")
        store.putPendingSession("kept", "token")
        store.clearPendingMarker("kept")

        val pendingSwept = PaykitLinkDurableReconcile.sweepPendingLeftovers(store) { sessions.remove(it) }
        assertTrue(pendingSwept.isEmpty())
        val collected = PaykitLinkDurableReconcile.collectUnreferencedAdopted(
            store,
            knownAliases = setOf("kept"),
        ) { sessions.remove(it) }

        assertTrue(collected.isEmpty())
        assertEquals(mapOf("kept" to "token"), store.bearers)
        assertEquals(mapOf("kept" to "token"), sessions)
    }

    @Test
    fun reconcileExcludesLegitimatelyPending() {
        val store = InMemoryPaykitLinkSessionStore()
        store.putPendingSession("inflight", "token")
        val collected = PaykitLinkDurableReconcile.collectUnreferencedAdopted(
            store,
            knownAliases = emptySet(),
        ) {}
        assertTrue(collected.isEmpty())
        assertTrue(store.hasSessionBearer("inflight"))
        assertTrue(store.hasPendingMarker("inflight"))
    }
}
