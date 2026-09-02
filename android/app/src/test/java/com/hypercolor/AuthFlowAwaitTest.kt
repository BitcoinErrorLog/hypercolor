package com.hypercolor

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        registry.put("flow-a", flow)

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

        // B rejects validation / "already awaiting" — duplicate registration
        // is rejected before a second owner exists, so cancel only affects A.
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
        outcome.droppedCancellable?.cancel()
        outcome.droppedFlow?.close()

        flow.complete("session-must-not-persist")

        val ownerErr = ownerSettled.await() as AuthFlowBridgeReject
        assertEquals("auth_flow_cancelled", ownerErr.code)
        assertTrue(persisted.isEmpty())
        assertTrue(flow.closed)
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun cancelBeforeAwaitRejectsCancelledAndOwnerPrunesTombstone() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        registry.put("flow-a", flow)
        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, outcome.kind)
        outcome.droppedFlow?.close()
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
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun secondaryAwaitDuringCancelledOwnerDoesNotPruneOrPersist() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val persisted = mutableListOf<String>()
        registry.put("flow-a", flow)

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
        outcome.droppedCancellable?.cancel()
        outcome.droppedFlow?.close()
        assertTrue(registry.isCancelled("flow-a"))

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
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun successfulOwnerClosesOnlyOnceAndSecondAwaitIsMissing() = runBlocking {
        val flow = FakeAuthFlow()
        val registry = AuthFlowCancelRegistry<FakeAuthFlow>()
        val closes = AtomicInteger(0)
        registry.put("flow-a", flow)
        flow.complete("ok")

        val session = AuthFlowAwait.execute(
            flows = registry,
            id = "flow-a",
            awaitFfi = { flow.awaitApproval() },
            closeFlow = {
                closes.incrementAndGet()
                it?.close()
            },
        )
        assertEquals("ok", session)
        assertEquals(0, closes.get())
        assertFalse(flow.closed)

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
        val cancel = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Unknown, cancel.kind)
        assertFalse(registry.isCancelled("flow-a"))
    }

    private class FakeAuthFlow {
        private val gate = CompletableDeferred<String>()
        var closed: Boolean = false
            private set

        suspend fun awaitApproval(): String = withContext(NonCancellable) { gate.await() }

        fun complete(session: String) {
            check(gate.complete(session)) { "approval already completed" }
        }

        fun close() {
            closed = true
        }
    }
}
