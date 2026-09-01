package com.hypercolor

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AuthKeepaliveCoordinatorTest {
    @Test
    fun maxLifetimeMatchesThreeRelayHoldsPlusMargin() {
        assertEquals(10 * 60 * 1000L, AUTH_KEEPALIVE_RELAY_HOLD_MS)
        assertEquals(3, AUTH_KEEPALIVE_MAX_POLL_FAILURES)
        assertEquals(5 * 60 * 1000L, AUTH_KEEPALIVE_SCHEDULE_MARGIN_MS)
        assertEquals(35 * 60 * 1000L, AUTH_KEEPALIVE_MAX_MS)
    }

    @Test
    fun startThenReleaseStopsOnce() {
        val env = Env()
        env.coordinator.ensureStarted("flow-a")
        assertEquals(listOf("start"), env.ops.events)
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, env.coordinator.phase())
        env.coordinator.release("flow-a")
        assertEquals(listOf("start", "stop"), env.ops.events)
        assertNull(env.coordinator.owner())
    }

    @Test
    fun staleReleaseCannotStopNewerOwner() {
        val env = Env()
        env.coordinator.ensureStarted("flow-a")
        env.coordinator.ensureStarted("flow-b")
        env.coordinator.release("flow-a")
        assertEquals(listOf("start"), env.ops.events)
        assertEquals("flow-b", env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, env.coordinator.phase())
        env.coordinator.release("flow-b")
        assertEquals(listOf("start", "stop"), env.ops.events)
    }

    @Test
    fun starterSucceedsAfterSupersedeDuringStart() {
        val owner = AuthKeepaliveOwner()
        val ops = RecordingOps {
            owner.claim("flow-b")
        }
        val coordinator = AuthKeepaliveCoordinator(
            ops = ops,
            handler = ImmediateKeepaliveHandler(),
            scheduler = ImmediateKeepaliveScheduler(),
            owner = owner,
        )
        coordinator.ensureStarted("flow-a")
        assertEquals(listOf("start"), ops.events)
        assertEquals("flow-b", coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, coordinator.phase())
        coordinator.ensureStarted("flow-b")
        assertEquals(listOf("start"), ops.events)
        coordinator.release("flow-a")
        assertEquals(listOf("start"), ops.events)
        coordinator.release("flow-b")
        assertEquals(listOf("start", "stop"), ops.events)
    }

    @Test
    fun starterFailureAfterSupersedeLetsNewOwnerStart() {
        val owner = AuthKeepaliveOwner()
        var failNextStart = true
        val ops = RecordingOps {
            owner.claim("flow-b")
            if (failNextStart) {
                failNextStart = false
                throw AuthKeepaliveStartFailed()
            }
        }
        val coordinator = AuthKeepaliveCoordinator(
            ops = ops,
            handler = ImmediateKeepaliveHandler(),
            scheduler = ImmediateKeepaliveScheduler(),
            owner = owner,
        )
        try {
            coordinator.ensureStarted("flow-a")
            fail("expected start failure")
        } catch (_: AuthKeepaliveStartFailed) {
        }
        assertEquals("flow-b", coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, coordinator.phase())
        coordinator.ensureStarted("flow-b")
        assertEquals(listOf("start", "start"), ops.events)
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, coordinator.phase())
        coordinator.release("flow-a")
        assertEquals(listOf("start", "start"), ops.events)
        coordinator.release("flow-b")
        assertEquals(listOf("start", "start", "stop"), ops.events)
    }

    @Test
    fun staleFailureCannotClearNewerConfirmedOwner() {
        val env = Env()
        env.coordinator.ensureStarted("flow-a")
        val staleGeneration = env.owner.generation()
        env.coordinator.ensureStarted("flow-b")
        assertFalse(env.owner.failStart("flow-a", staleGeneration))
        assertEquals("flow-b", env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, env.coordinator.phase())
        assertEquals(listOf("start"), env.ops.events)
    }

    @Test
    fun lifetimeExpiryStopsConfirmedService() {
        val scheduler = ImmediateKeepaliveScheduler()
        val env = Env(scheduler = scheduler, maxLifetimeMs = 10L)
        env.coordinator.ensureStarted("flow-a")
        val epoch = env.coordinator.lifetimeEpoch()
        scheduler.fire(epoch)
        assertEquals(listOf("start", "stop"), env.ops.events)
        assertNull(env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, env.coordinator.phase())
    }

    @Test
    fun cancelledLifetimeCannotStopAfterOwnerReleased() {
        val scheduler = ImmediateKeepaliveScheduler()
        val env = Env(scheduler = scheduler, maxLifetimeMs = 10L)
        env.coordinator.ensureStarted("flow-a")
        val epoch = env.coordinator.lifetimeEpoch()
        env.coordinator.release("flow-a")
        scheduler.fire(epoch)
        assertEquals(listOf("start", "stop"), env.ops.events)
    }

    @Test
    fun rearmOnEnsureResetsLifetimeWithoutSecondStart() {
        val scheduler = ImmediateKeepaliveScheduler()
        val env = Env(scheduler = scheduler, maxLifetimeMs = 10L)
        env.coordinator.ensureStarted("flow-a")
        val firstEpoch = env.coordinator.lifetimeEpoch()
        env.coordinator.ensureStarted("flow-a")
        val secondEpoch = env.coordinator.lifetimeEpoch()
        assertTrue(secondEpoch > firstEpoch)
        assertEquals(setOf(secondEpoch), scheduler.pendingKeys())
        assertEquals(listOf("start"), env.ops.events)
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, env.coordinator.phase())
    }

    @Test
    fun oldLifetimeCallbackCannotReapRearmedAttempt() {
        val scheduler = ImmediateKeepaliveScheduler()
        val env = Env(scheduler = scheduler, maxLifetimeMs = 10L)
        env.coordinator.ensureStarted("flow-a")
        val firstEpoch = env.coordinator.lifetimeEpoch()
        env.coordinator.ensureStarted("flow-a")
        scheduler.fire(firstEpoch)
        assertEquals(listOf("start"), env.ops.events)
        assertEquals("flow-a", env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, env.coordinator.phase())
        scheduler.fire(env.coordinator.lifetimeEpoch())
        assertEquals(listOf("start", "stop"), env.ops.events)
        assertNull(env.coordinator.owner())
    }

    @Test
    fun expiryAfterRearmStopsCurrentAttempt() {
        val scheduler = ImmediateKeepaliveScheduler()
        val env = Env(scheduler = scheduler, maxLifetimeMs = 10L)
        env.coordinator.ensureStarted("flow-a")
        env.coordinator.ensureStarted("flow-a")
        scheduler.fire(env.coordinator.lifetimeEpoch())
        assertEquals(listOf("start", "stop"), env.ops.events)
        assertNull(env.coordinator.owner())
    }

    @Test
    fun systemTimeoutStopsConfirmedService() {
        val env = Env()
        env.coordinator.ensureStarted("flow-a")
        env.coordinator.handleSystemTimeout()
        assertEquals(listOf("start", "stop"), env.ops.events)
        assertNull(env.coordinator.owner())
    }

    @Test
    fun serviceDisappearedReconcilesWithoutStopAndNextAttemptStarts() {
        val env = Env()
        env.coordinator.ensureStarted("flow-a")
        env.coordinator.handleServiceDisappeared()
        assertEquals(listOf("start"), env.ops.events)
        assertNull(env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, env.coordinator.phase())
        env.coordinator.ensureStarted("flow-b")
        assertEquals(listOf("start", "start"), env.ops.events)
        assertEquals("flow-b", env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, env.coordinator.phase())
    }

    @Test
    fun staleServiceGoneCannotClearNewerGeneration() {
        val env = Env()
        env.coordinator.ensureStarted("flow-a")
        env.coordinator.release("flow-a")
        env.coordinator.ensureStarted("flow-b")
        env.coordinator.handleServiceDisappeared()
        assertEquals("flow-b", env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, env.coordinator.phase())
        assertEquals(listOf("start", "stop", "start"), env.ops.events)
    }

    @Test
    fun serializedHandlerRunsStartBeforeQueuedStaleStop() {
        val handler = QueuedKeepaliveHandler()
        val ops = RecordingOps()
        val coordinator = AuthKeepaliveCoordinator(
            ops = ops,
            handler = handler,
            scheduler = ImmediateKeepaliveScheduler(),
        )
        handler.runInline {
            coordinator.ensureStarted("flow-a")
            coordinator.ensureStarted("flow-b")
        }
        handler.enqueue { coordinator.release("flow-a") }
        handler.enqueue { coordinator.ensureStarted("flow-c") }
        handler.drain()
        assertEquals(listOf("start"), ops.events)
        assertEquals("flow-c", coordinator.owner())
        handler.runInline { coordinator.release("flow-c") }
        assertEquals(listOf("start", "stop"), ops.events)
    }

    @Test
    fun stalledHandlerTimeoutDoesNotRunLateStart() {
        val handler = StallingKeepaliveHandler()
        val ops = RecordingOps()
        val coordinator = AuthKeepaliveCoordinator(
            ops = ops,
            handler = handler,
            scheduler = ImmediateKeepaliveScheduler(),
            dispatchTimeoutMs = 20L,
        )
        try {
            coordinator.ensureStarted("flow-a")
            fail("expected dispatch timeout")
        } catch (_: AuthKeepaliveDispatchTimeout) {
        }
        assertEquals(1, handler.queuedCount())
        assertEquals(emptyList<String>(), ops.events)
        handler.runAll()
        assertEquals(emptyList<String>(), ops.events)
        assertNull(coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, coordinator.phase())
    }

    @Test
    fun crossThreadEnsureSerializesOnWorker() {
        val worker = AtomicReference<Thread>()
        val ready = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor { runnable ->
            Thread {
                worker.set(Thread.currentThread())
                ready.countDown()
                runnable.run()
            }
        }
        try {
            executor.execute { }
            assertTrue(ready.await(2, TimeUnit.SECONDS))
            val handler = ExecutorKeepaliveHandler(executor, worker.get())
            val ops = RecordingOps()
            val coordinator = AuthKeepaliveCoordinator(
                ops = ops,
                handler = handler,
                scheduler = ImmediateKeepaliveScheduler(),
            )
            coordinator.ensureStarted("flow-a")
            assertEquals(listOf("start"), ops.events)
            assertEquals("flow-a", coordinator.owner())
            coordinator.release("flow-a")
            assertEquals(listOf("start", "stop"), ops.events)
        } finally {
            executor.shutdownNow()
        }
    }

    private class AuthKeepaliveStartFailed : RuntimeException()

    private class QueuedKeepaliveHandler : AuthKeepaliveHandler {
        private val queue = ArrayDeque<() -> Unit>()
        private var current = false

        override fun post(block: () -> Unit) {
            queue.addLast(block)
        }

        override fun isCurrentThread(): Boolean = current

        fun runInline(block: () -> Unit) {
            current = true
            try {
                block()
            } finally {
                current = false
            }
        }

        fun enqueue(block: () -> Unit) {
            post(block)
        }

        fun drain() {
            while (queue.isNotEmpty()) {
                current = true
                try {
                    queue.removeFirst().invoke()
                } finally {
                    current = false
                }
            }
        }
    }

    private class Env(
        val owner: AuthKeepaliveOwner = AuthKeepaliveOwner(),
        val ops: RecordingOps = RecordingOps(),
        val scheduler: ImmediateKeepaliveScheduler = ImmediateKeepaliveScheduler(),
        maxLifetimeMs: Long = AUTH_KEEPALIVE_MAX_MS,
    ) {
        val coordinator = AuthKeepaliveCoordinator(
            ops = ops,
            handler = ImmediateKeepaliveHandler(),
            scheduler = scheduler,
            owner = owner,
            maxLifetimeMs = maxLifetimeMs,
        )
    }
}
