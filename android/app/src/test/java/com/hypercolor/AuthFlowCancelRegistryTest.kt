package com.hypercolor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AuthFlowCancelRegistryTest {
    @Test
    fun cancelBeforeApprovalDoesNotSurface() {
        val registry = AuthFlowCancelRegistry<String>()
        val cancellable = RecordingCancellable()
        registry.put("flow-a", "auth-flow")
        val started = registry.startAwait("flow-a")
        val ready = started as? AuthFlowAwaitStart.Ready ?: run {
            fail("expected Ready")
            return
        }
        assertSame("auth-flow", ready.flow)
        registry.attachCancellable("flow-a", cancellable)

        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, outcome.kind)
        assertSame("auth-flow", outcome.droppedFlow)
        assertSame(cancellable, outcome.droppedCancellable)
        outcome.droppedCancellable?.cancel()
        assertTrue(cancellable.cancelled)
        assertTrue(registry.isCancelled("flow-a"))
        assertFalse(registry.markSurfaced("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Cancelled)
    }

    @Test
    fun cancelBeforeAwaitDropsFlowAndRejectsLaterAwait() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, outcome.kind)
        assertSame("auth-flow", outcome.droppedFlow)
        assertNull(outcome.droppedCancellable)
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Cancelled)
        assertFalse(registry.markSurfaced("flow-a"))
    }

    @Test
    fun cancelAfterApprovalAlreadySurfacedIsNoOp() {
        val registry = AuthFlowCancelRegistry<String>()
        val cancellable = RecordingCancellable()
        registry.put("flow-a", "auth-flow")
        registry.startAwait("flow-a")
        registry.attachCancellable("flow-a", cancellable)
        assertTrue(registry.markSurfaced("flow-a"))
        assertTrue(registry.isSurfaced("flow-a"))

        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.AlreadySurfaced, outcome.kind)
        assertNull(outcome.droppedFlow)
        assertNull(outcome.droppedCancellable)
        assertFalse(cancellable.cancelled)
        assertFalse(registry.isCancelled("flow-a"))
    }

    @Test
    fun unknownIdIsNoOp() {
        val registry = AuthFlowCancelRegistry<String>()
        val outcome = registry.cancel("missing")
        assertEquals(AuthFlowCancelKind.Unknown, outcome.kind)
        assertNull(outcome.droppedFlow)
        assertNull(outcome.droppedCancellable)
        assertFalse(registry.isCancelled("missing"))
        assertTrue(registry.startAwait("missing") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun cancelIsIdempotent() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val first = registry.cancel("flow-a")
        val second = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, first.kind)
        assertSame("auth-flow", first.droppedFlow)
        assertEquals(AuthFlowCancelKind.AlreadyCancelled, second.kind)
        assertNull(second.droppedFlow)
        assertNull(second.droppedCancellable)
        assertTrue(registry.isCancelled("flow-a"))
    }

    @Test
    fun abandonDoesNotMarkCancelled() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        assertSame("auth-flow", registry.abandon("flow-a"))
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Unknown, outcome.kind)
    }

    @Test
    fun secondAwaitOfLiveFlowIsMissing() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Ready)
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    private class RecordingCancellable : AuthFlowCancellable {
        var cancelled: Boolean = false
        override fun cancel() {
            cancelled = true
        }
    }
}
