package com.hypercolor

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Coroutine-level stand-in for [PaykitLinkModule.awaitAuthApproval] against a
 * fake Paykit flow whose `awaitApproval` is non-abortable (matches UniFFI).
 */
class AuthFlowAwaitTest {
    @Test
    fun duplicateAwaitThenCancelDoesNotPersistOriginalApproval() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val persisted = mutableListOf<String>()
        assertTrue(registry.put("flow-a", flow))

        val enteredFfi = CompletableDeferred<Unit>()
        val ownerSettled = CompletableDeferred<Throwable?>()
        launch {
            try {
                val session = AuthFlowAwait.execute(
                    flows = registry,
                    id = "flow-a",
                    awaitFfi = {
                        enteredFfi.complete(Unit)
                        flow.awaitApproval()
                    },
                    closeFlow = { it?.close() },
                )
                persisted.add(session)
                withContext(NonCancellable) { ownerSettled.complete(null) }
            } catch (error: Throwable) {
                withContext(NonCancellable) { ownerSettled.complete(error) }
            }
        }
        enteredFfi.await()

        val duplicate = runCatching {
            AuthFlowAwait.execute(
                flows = registry,
                id = "flow-a",
                awaitFfi = { error("duplicate must not reach FFI") },
                closeFlow = { it?.close() },
            )
        }
        val dup = duplicate.exceptionOrNull() as AuthFlowBridgeReject
        assertEquals("validation", dup.code)
        assertEquals(AuthFlowAwait.ALREADY_AWAITING_MESSAGE, dup.message)

        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, outcome.kind)
        assertNull(outcome.droppedFlow)
        outcome.droppedCancellable?.cancel()
        outcome.droppedFlow?.close()

        flow.complete("session-must-not-persist")

        val ownerErr = ownerSettled.await() as AuthFlowBridgeReject
        assertEquals("auth_flow_cancelled", ownerErr.code)
        assertTrue(persisted.isEmpty())
        assertEquals(1, flow.closeCount.get())
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun cancelBeforeAwaitRejectsCancelledAndOwnerPrunesTombstone() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        assertTrue(registry.put("flow-a", flow))
        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, outcome.kind)
        assertSame(flow, outcome.droppedFlow)
        outcome.droppedFlow?.close()
        assertEquals(1, flow.closeCount.get())
        assertTrue(registry.isCancelled("flow-a"))

        val result = runCatching {
            AuthFlowAwait.execute(
                flows = registry,
                id = "flow-a",
                awaitFfi = { error("cancel-before-await must not reach FFI") },
                closeFlow = { it?.close() },
            )
        }
        val err = result.exceptionOrNull() as AuthFlowBridgeReject
        assertEquals("auth_flow_cancelled", err.code)
        assertEquals(1, flow.closeCount.get())
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun secondaryAwaitDuringCancelledOwnerDoesNotPruneOrPersist() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val persisted = mutableListOf<String>()
        assertTrue(registry.put("flow-a", flow))

        val enteredFfi = CompletableDeferred<Unit>()
        val ownerSettled = CompletableDeferred<Throwable?>()
        launch {
            try {
                val session = AuthFlowAwait.execute(
                    flows = registry,
                    id = "flow-a",
                    awaitFfi = {
                        enteredFfi.complete(Unit)
                        flow.awaitApproval()
                    },
                    closeFlow = { it?.close() },
                )
                persisted.add(session)
                withContext(NonCancellable) { ownerSettled.complete(null) }
            } catch (error: Throwable) {
                withContext(NonCancellable) { ownerSettled.complete(error) }
            }
        }
        enteredFfi.await()

        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, outcome.kind)
        assertNull(outcome.droppedFlow)
        outcome.droppedCancellable?.cancel()
        outcome.droppedFlow?.close()
        assertTrue(registry.isCancelled("flow-a"))
        assertEquals(0, flow.closeCount.get())

        val secondary = runCatching {
            AuthFlowAwait.execute(
                flows = registry,
                id = "flow-a",
                awaitFfi = { error("secondary must not reach FFI") },
                closeFlow = { it?.close() },
            )
        }
        val secondaryErr = secondary.exceptionOrNull() as AuthFlowBridgeReject
        assertEquals("validation", secondaryErr.code)
        assertEquals(AuthFlowAwait.ALREADY_AWAITING_MESSAGE, secondaryErr.message)
        assertTrue(registry.isCancelled("flow-a"))

        flow.complete("session-must-not-persist")

        val ownerErr = ownerSettled.await() as AuthFlowBridgeReject
        assertEquals("auth_flow_cancelled", ownerErr.code)
        assertTrue(persisted.isEmpty())
        assertEquals(1, flow.closeCount.get())
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun successfulOwnerClosesOnlyOnceAndSecondAwaitIsMissing() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        assertTrue(registry.put("flow-a", flow))
        flow.complete("ok")

        val session = AuthFlowAwait.execute(
            flows = registry,
            id = "flow-a",
            awaitFfi = { flow.awaitApproval() },
            closeFlow = { it?.close() },
        )
        assertEquals("ok", session)
        assertEquals(1, flow.closeCount.get())

        val second = runCatching {
            AuthFlowAwait.execute(
                flows = registry,
                id = "flow-a",
                awaitFfi = { error("consumed id must not reach FFI") },
                closeFlow = { it?.close() },
            )
        }
        val err = second.exceptionOrNull() as AuthFlowBridgeReject
        assertEquals("validation", err.code)
        assertEquals(AuthFlowAwait.UNKNOWN_FLOW_MESSAGE, err.message)
        assertEquals(1, flow.closeCount.get())
        val cancel = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Unknown, cancel.kind)
        assertFalse(registry.isCancelled("flow-a"))
    }

    @Test
    fun failedAwaitClosesExactlyOnce() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        assertTrue(registry.put("flow-a", flow))
        val boom = IllegalStateException("ffi failed")
        val result = runCatching {
            AuthFlowAwait.execute(
                flows = registry,
                id = "flow-a",
                awaitFfi = { throw boom },
                closeFlow = { it?.close() },
            )
        }
        assertSame(boom, result.exceptionOrNull())
        assertEquals(1, flow.closeCount.get())
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun scopeCancellationWithoutRegistryCancelIsUnavailableAtBridge() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        assertTrue(registry.put("flow-a", flow))
        val enteredWait = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<String>()
        val settled = CompletableDeferred<Throwable?>()
        val job = launch {
            try {
                executeAtBridge(
                    flows = registry,
                    id = "flow-a",
                    awaitFfi = {
                        enteredWait.complete(Unit)
                        gate.await()
                    },
                    closeFlow = { it?.close() },
                )
                withContext(NonCancellable) { settled.complete(null) }
            } catch (error: Throwable) {
                withContext(NonCancellable) { settled.complete(error) }
            }
        }
        enteredWait.await()
        assertFalse(registry.isCancelled("flow-a"))
        job.cancel()
        val err = settled.await() as AuthFlowBridgeReject
        assertEquals("unavailable", err.code)
        assertEquals(AuthFlowAwait.UNAVAILABLE_MESSAGE, err.message)
        assertEquals(1, flow.closeCount.get())
        assertFalse(registry.isCancelled("flow-a"))
        assertFalse(registry.isTornDown())
    }

    @Test
    fun teardownDuringAwaitRejectsUnavailableAndDoesNotPersist() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val persisted = mutableListOf<String>()
        assertTrue(registry.put("flow-a", flow))
        val enteredFfi = CompletableDeferred<Unit>()
        val settled = CompletableDeferred<Throwable?>()
        launch {
            try {
                val session = executeAtBridge(
                    flows = registry,
                    id = "flow-a",
                    awaitFfi = {
                        enteredFfi.complete(Unit)
                        flow.awaitApproval()
                    },
                    closeFlow = { it?.close() },
                )
                persisted.add(session)
                withContext(NonCancellable) { settled.complete(null) }
            } catch (error: Throwable) {
                withContext(NonCancellable) { settled.complete(error) }
            }
        }
        enteredFfi.await()
        val snapshot = registry.teardown()
        snapshot.ownerCancellables.forEach { it.cancel() }
        snapshot.idleFlows.forEach { it.close() }
        assertTrue(registry.isTornDown())
        assertTrue(registry.isCancelled("flow-a"))
        assertEquals(0, flow.closeCount.get())

        flow.complete("session-must-not-persist")

        val err = settled.await() as AuthFlowBridgeReject
        assertEquals("unavailable", err.code)
        assertEquals(AuthFlowAwait.UNAVAILABLE_MESSAGE, err.message)
        assertTrue(persisted.isEmpty())
        assertEquals(1, flow.closeCount.get())
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Unavailable)
    }

    @Test
    fun teardownAfterApprovalBeforePersistDoesNotWriteOrResolve() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val store = FakeSessionStore()
        val resolves = AtomicInteger(0)
        val rejects = mutableListOf<String>()
        assertTrue(registry.put("flow-a", flow))
        flow.complete("session-token")
        val enteredCommit = CompletableDeferred<Unit>()
        val releaseCommit = CompletableDeferred<Unit>()
        val settled = CompletableDeferred<Throwable?>()
        launch {
            try {
                executeAtBridge(
                    flows = registry,
                    id = "flow-a",
                    awaitFfi = { flow.awaitApproval() },
                    closeFlow = { it?.close() },
                    persist = { token ->
                        store.write(token)
                        resolves.incrementAndGet()
                    },
                    onBeforeCommit = {
                        enteredCommit.complete(Unit)
                        withContext(NonCancellable) { releaseCommit.await() }
                    },
                )
                withContext(NonCancellable) { settled.complete(null) }
            } catch (error: Throwable) {
                if (error is AuthFlowBridgeReject) {
                    rejects.add(error.code)
                }
                withContext(NonCancellable) { settled.complete(error) }
            }
        }
        enteredCommit.await()
        assertTrue(store.writes.isEmpty())
        assertEquals(0, resolves.get())
        val snapshot = registry.teardown()
        snapshot.ownerCancellables.forEach { it.cancel() }
        snapshot.idleFlows.forEach { it.close() }
        assertEquals(0, flow.closeCount.get())
        releaseCommit.complete(Unit)
        val err = settled.await() as AuthFlowBridgeReject
        assertEquals("unavailable", err.code)
        assertEquals(AuthFlowAwait.UNAVAILABLE_MESSAGE, err.message)
        assertEquals(listOf("unavailable"), rejects)
        assertTrue(store.writes.isEmpty())
        assertEquals(0, resolves.get())
        assertEquals(1, flow.closeCount.get())
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Unavailable)
    }

    @Test
    fun commitWinsThenTeardownDoesNotRollbackAdoptedSession() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val store = FakeSessionStore()
        val resolves = AtomicInteger(0)
        assertTrue(registry.put("flow-a", flow))
        flow.complete("session-token")
        val session = executeAtBridge(
            flows = registry,
            id = "flow-a",
            awaitFfi = { flow.awaitApproval() },
            closeFlow = { it?.close() },
            persist = { token ->
                store.write(token)
                resolves.incrementAndGet()
            },
        )
        assertEquals("session-token", session)
        assertEquals(listOf("session-token"), store.writes)
        assertEquals(1, resolves.get())
        assertEquals(1, flow.closeCount.get())
        val snapshot = registry.teardown()
        snapshot.ownerCancellables.forEach { it.cancel() }
        snapshot.idleFlows.forEach { it.close() }
        assertEquals(listOf("session-token"), store.writes)
        assertEquals(1, resolves.get())
        assertEquals(1, flow.closeCount.get())
        assertTrue(registry.isTornDown())
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Unavailable)
    }

    @Test
    fun clearAllDuringAdmittedAwaitClosesOnceAndRejectsCancelled() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val store = FakeSessionStore()
        val resolves = AtomicInteger(0)
        assertTrue(registry.put("flow-a", flow))
        val enteredFfi = CompletableDeferred<Unit>()
        val settled = CompletableDeferred<Throwable?>()
        launch {
            try {
                executeAtBridge(
                    flows = registry,
                    id = "flow-a",
                    awaitFfi = {
                        enteredFfi.complete(Unit)
                        flow.awaitApproval()
                    },
                    closeFlow = { it?.close() },
                    persist = { token ->
                        store.write(token)
                        resolves.incrementAndGet()
                    },
                )
                withContext(NonCancellable) { settled.complete(null) }
            } catch (error: Throwable) {
                withContext(NonCancellable) { settled.complete(error) }
            }
        }
        enteredFfi.await()
        val snapshot = registry.drainLive()
        assertTrue(snapshot.idleFlows.isEmpty())
        assertEquals(1, snapshot.ownerCancellables.size)
        snapshot.ownerCancellables.forEach { it.cancel() }
        snapshot.idleFlows.forEach { it.close() }
        assertEquals(0, flow.closeCount.get())
        assertFalse(registry.isTornDown())
        assertTrue(registry.isCancelled("flow-a"))
        flow.complete("session-must-not-persist")
        val err = settled.await() as AuthFlowBridgeReject
        assertEquals("auth_flow_cancelled", err.code)
        assertEquals(AuthFlowAwait.CANCELLED_MESSAGE, err.message)
        assertTrue(store.writes.isEmpty())
        assertEquals(0, resolves.get())
        assertEquals(1, flow.closeCount.get())
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    /**
     * Mirrors [PaykitLinkModule] launch mapping: registry cancel stays
     * `auth_flow_cancelled`; unrelated coroutine cancellation is `unavailable`.
     */
    private suspend fun <T, S> executeAtBridge(
        flows: AuthFlowCancelRegistry<T>,
        id: String,
        awaitFfi: suspend (T) -> S,
        closeFlow: (T?) -> Unit,
        persist: (S) -> Unit = {},
        onBeforeCommit: suspend () -> Unit = {},
    ): S {
        return try {
            AuthFlowAwait.execute(
                flows = flows,
                id = id,
                awaitFfi = awaitFfi,
                closeFlow = closeFlow,
                persist = persist,
                onBeforeCommit = onBeforeCommit,
            )
        } catch (error: Throwable) {
            if (error is AuthFlowBridgeReject) {
                throw error
            }
            if (error is CancellationException) {
                throw AuthFlowBridgeReject("unavailable", AuthFlowAwait.UNAVAILABLE_MESSAGE)
            }
            throw error
        }
    }

    private class FakeSessionStore {
        val writes = mutableListOf<String>()

        fun write(token: String) {
            writes.add(token)
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
