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
        assertFalse(registry.markSurfaced("flow-a", ready.lease))
        // cancelled-with-owner: secondary must not become the pruner.
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.AlreadyAwaiting)
        assertTrue(registry.isCancelled("flow-a"))
        assertNull(registry.finishAwait("flow-a", ready.lease))
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun cancelBeforeAwaitDropsFlowAndRejectsLaterAwait() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Cancelled, outcome.kind)
        assertSame("auth-flow", outcome.droppedFlow)
        assertNull(outcome.droppedCancellable)
        val started = registry.startAwait("flow-a")
        val cancelled = started as? AuthFlowAwaitStart.Cancelled ?: run {
            fail("expected Cancelled")
            return
        }
        assertFalse(registry.markSurfaced("flow-a", cancelled.lease))
        assertNull(registry.finishAwait("flow-a", cancelled.lease))
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun cancelAfterApprovalAlreadySurfacedIsNoOp() {
        val registry = AuthFlowCancelRegistry<String>()
        val cancellable = RecordingCancellable()
        registry.put("flow-a", "auth-flow")
        val ready = registry.startAwait("flow-a") as AuthFlowAwaitStart.Ready
        registry.attachCancellable("flow-a", cancellable)
        assertTrue(registry.markSurfaced("flow-a", ready.lease))
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
    fun secondAwaitOfLiveFlowIsAlreadyAwaiting() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val first = registry.startAwait("flow-a")
        assertTrue(first is AuthFlowAwaitStart.Ready)
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.AlreadyAwaiting)
        val ready = first as AuthFlowAwaitStart.Ready
        assertTrue(registry.markAwaiting("flow-a", ready.lease))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.AlreadyAwaiting)
    }

    @Test
    fun finishAwaitPrunesCancelledAndReturnsLeftoverFlow() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val ready = registry.startAwait("flow-a") as AuthFlowAwaitStart.Ready
        assertSame("auth-flow", registry.finishAwait("flow-a", ready.lease))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)

        registry.put("flow-b", "auth-flow-b")
        registry.cancel("flow-b")
        assertTrue(registry.isCancelled("flow-b"))
        assertNull(registry.finishAwait("flow-b", 99L))
        assertTrue(registry.isCancelled("flow-b"))
        val cancelled = registry.startAwait("flow-b") as AuthFlowAwaitStart.Cancelled
        assertNull(registry.finishAwait("flow-b", cancelled.lease))
        assertFalse(registry.isCancelled("flow-b"))
        assertTrue(registry.startAwait("flow-b") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun finishAwaitPrunesSurfaced() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val ready = registry.startAwait("flow-a") as AuthFlowAwaitStart.Ready
        assertTrue(registry.markSurfaced("flow-a", ready.lease))
        assertTrue(registry.isSurfaced("flow-a"))
        assertNull(registry.finishAwait("flow-a", ready.lease))
        assertFalse(registry.isSurfaced("flow-a"))
    }

    @Test
    fun finishAwaitWrongLeaseDoesNotPruneCancelledOwner() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val ready = registry.startAwait("flow-a") as AuthFlowAwaitStart.Ready
        registry.cancel("flow-a")
        assertTrue(registry.isCancelled("flow-a"))
        assertNull(registry.finishAwait("flow-a", ready.lease + 1L))
        assertTrue(registry.isCancelled("flow-a"))
        assertFalse(registry.markSurfaced("flow-a", ready.lease))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.AlreadyAwaiting)
        assertNull(registry.finishAwait("flow-a", ready.lease))
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    @Test
    fun cancelUnknownDoesNotTombstoneConsumedId() {
        val registry = AuthFlowCancelRegistry<String>()
        registry.put("flow-a", "auth-flow")
        val ready = registry.startAwait("flow-a") as AuthFlowAwaitStart.Ready
        assertTrue(registry.markSurfaced("flow-a", ready.lease))
        assertNull(registry.finishAwait("flow-a", ready.lease))
        val outcome = registry.cancel("flow-a")
        assertEquals(AuthFlowCancelKind.Unknown, outcome.kind)
        assertFalse(registry.isCancelled("flow-a"))
        assertTrue(registry.startAwait("flow-a") is AuthFlowAwaitStart.Missing)
    }

    private class RecordingCancellable : AuthFlowCancellable {
        var cancelled: Boolean = false
        override fun cancel() {
            cancelled = true
        }
    }
}
