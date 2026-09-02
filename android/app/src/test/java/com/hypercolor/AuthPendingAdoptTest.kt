package com.hypercolor

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Seams "resolver scheduled" from "JS ran" the way RN 0.81.5 actually
 * works: `promise.resolve` only queues `CallInvoker::invokeAsync`. Adoption
 * is [AuthFlowCancelRegistry.adoptPending], not the resolve counter.
 *
 * Module invalidate maps to [AuthFlowCancelRegistry.teardown] plus deleting
 * every still-pending alias from the durable store and in-memory sessions.
 */
class AuthPendingAdoptTest {
    @Test
    fun resolverScheduledThenInvalidateBeforeJsAdoptDeletesBearer() = runBlocking {
        val harness = Harness()
        harness.approve("session-token")

        assertEquals(1, harness.resolver.scheduled)
        assertEquals(0, harness.resolver.delivered)
        assertEquals(setOf("alias-1"), harness.store.bearers.keys)
        assertTrue(harness.store.pendingMarkers.contains("alias-1"))
        assertEquals(mapOf("alias-1" to "session-token"), harness.sessions)
        assertTrue(harness.registry.isPending("alias-1"))

        harness.invalidate()

        assertTrue(harness.store.bearers.isEmpty())
        assertTrue(harness.store.pendingMarkers.isEmpty())
        assertTrue(harness.sessions.isEmpty())
        assertFalse(harness.registry.isPending("alias-1"))
        assertEquals(1, harness.flow.closeCount.get())

        assertFalse(harness.deliverJsAdopt())
        assertTrue(harness.store.bearers.isEmpty())
        assertTrue(harness.sessions.isEmpty())
    }

    @Test
    fun adoptThenInvalidateRetainsSession() = runBlocking {
        val harness = Harness()
        harness.approve("session-token")
        assertTrue(harness.deliverJsAdopt())

        assertEquals(1, harness.resolver.scheduled)
        assertEquals(1, harness.resolver.delivered)
        assertFalse(harness.store.pendingMarkers.contains("alias-1"))
        assertEquals(mapOf("alias-1" to "session-token"), harness.store.bearers)
        assertEquals(mapOf("alias-1" to "session-token"), harness.sessions)

        harness.invalidate()

        assertEquals(mapOf("alias-1" to "session-token"), harness.store.bearers)
        assertEquals(mapOf("alias-1" to "session-token"), harness.sessions)
        assertTrue(harness.store.pendingMarkers.isEmpty())
        assertFalse(harness.registry.isPending("alias-1"))
    }

    @Test
    fun adoptUnknownOrNonPendingIsTypedFailure() {
        val harness = Harness()
        assertFalse(harness.registry.adoptPending("missing"))
        harness.registry.registerPending("alias-live")
        harness.store.putPending("alias-live", "token")
        harness.sessions["alias-live"] = "token"
        assertTrue(harness.registry.adoptPending("alias-live"))
        harness.store.clearPendingMarker("alias-live")
        assertFalse(harness.registry.adoptPending("alias-live"))
        assertEquals(mapOf("alias-live" to "token"), harness.store.bearers)
    }

    @Test
    fun initSweepDeletesDurablePendingLeftovers() {
        val store = FakeDurableStore()
        val sessions = linkedMapOf("orphan" to "leftover-bearer")
        store.putPending("orphan", "leftover-bearer")
        val leftovers = store.pendingMarkers.toList()
        for (alias in leftovers) {
            sessions.remove(alias)
            store.delete(alias)
        }
        assertTrue(store.bearers.isEmpty())
        assertTrue(store.pendingMarkers.isEmpty())
        assertTrue(sessions.isEmpty())
    }

    @Test
    fun clearAllDrainsPendingAndDeletesBearers() = runBlocking {
        val harness = Harness()
        harness.approve("session-token")
        assertTrue(harness.registry.isPending("alias-1"))

        val snapshot = harness.registry.drainLive()
        assertEquals(listOf("alias-1"), snapshot.pendingAliases)
        for (alias in snapshot.pendingAliases) {
            harness.sessions.remove(alias)
            harness.store.delete(alias)
        }
        assertTrue(harness.store.bearers.isEmpty())
        assertTrue(harness.store.pendingMarkers.isEmpty())
        assertTrue(harness.sessions.isEmpty())
        assertFalse(harness.registry.isPending("alias-1"))
        assertFalse(harness.registry.isTornDown())
        assertFalse(harness.registry.adoptPending("alias-1"))
    }

    private class Harness {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val store = FakeDurableStore()
        val sessions = linkedMapOf<String, String>()
        val resolver = ScheduledJsBridge()

        init {
            check(registry.put("flow-a", flow))
        }

        suspend fun approve(token: String) {
            flow.complete(token)
            AuthFlowAwait.execute(
                flows = registry,
                id = "flow-a",
                awaitFfi = { flow.awaitApproval() },
                closeFlow = { it?.close() },
                persist = { value, alias ->
                    store.putPending(alias, value)
                    sessions[alias] = value
                },
                rollbackPending = { alias ->
                    sessions.remove(alias)
                    store.delete(alias)
                    registry.dropPending(alias)
                },
                scheduleResolve = { _, alias ->
                    resolver.schedule(alias)
                },
                nextAlias = { "alias-1" },
            )
        }

        fun invalidate() {
            val snapshot = registry.teardown()
            snapshot.ownerCancellables.forEach { it.cancel() }
            snapshot.idleFlows.forEach { it.close() }
            for (alias in snapshot.pendingAliases) {
                sessions.remove(alias)
                store.delete(alias)
            }
        }

        fun deliverJsAdopt(): Boolean {
            val alias = resolver.deliver() ?: return false
            if (!registry.adoptPending(alias)) {
                return false
            }
            store.clearPendingMarker(alias)
            return true
        }
    }

    /**
     * Native resolver invocation vs JS continuation. Scheduling does not
     * run [deliver]; that is the missing r8/r9 seam.
     */
    private class ScheduledJsBridge {
        var scheduled = 0
        var delivered = 0
        var payload: String? = null

        fun schedule(alias: String) {
            scheduled += 1
            payload = alias
        }

        fun deliver(): String? {
            val alias = payload ?: return null
            delivered += 1
            return alias
        }
    }

    class FakeDurableStore {
        val bearers = linkedMapOf<String, String>()
        val pendingMarkers = linkedSetOf<String>()

        fun putPending(alias: String, bearer: String) {
            bearers[alias] = bearer
            pendingMarkers.add(alias)
        }

        fun clearPendingMarker(alias: String) {
            pendingMarkers.remove(alias)
        }

        fun delete(alias: String) {
            bearers.remove(alias)
            pendingMarkers.remove(alias)
        }
    }

    private class FakeAuthFlow {
        private val gate = CompletableDeferred<String>()
        val closeCount = AtomicInteger(0)

        suspend fun awaitApproval(): String = withContext(NonCancellable) { gate.await() }

        fun complete(session: String) {
            check(gate.complete(session)) { "approval already completed" }
        }

        fun close() {
            closeCount.incrementAndGet()
        }
    }
}
