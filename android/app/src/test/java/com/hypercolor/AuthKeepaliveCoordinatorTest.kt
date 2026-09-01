package com.hypercolor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class AuthKeepaliveCoordinatorTest {
    @Test
    fun maxLifetimeMatchesHttpRelayUnusedRequestTimeout() {
        assertEquals(10 * 60 * 1000L, AUTH_KEEPALIVE_MAX_MS)
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
        val scheduler = ImmediateKeepaliveScheduler()
        val coordinator = AuthKeepaliveCoordinator(
            ops = ops,
            handler = ImmediateKeepaliveHandler(),
            scheduler = scheduler,
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
            org.junit.Assert.fail("expected start failure")
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
        val generation = env.owner.generation()
        scheduler.fire(generation)
        assertEquals(listOf("start", "stop"), env.ops.events)
        assertNull(env.coordinator.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, env.coordinator.phase())
    }

    @Test
    fun cancelledLifetimeCannotStopAfterOwnerReleased() {
        val scheduler = ImmediateKeepaliveScheduler()
        val env = Env(scheduler = scheduler, maxLifetimeMs = 10L)
        env.coordinator.ensureStarted("flow-a")
        val generation = env.owner.generation()
        env.coordinator.release("flow-a")
        scheduler.fire(generation)
        assertEquals(listOf("start", "stop"), env.ops.events)
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
    fun serializedHandlerRunsStartBeforeQueuedStaleStop() {
        val handler = QueuedKeepaliveHandler()
        val ops = RecordingOps()
        val owner = AuthKeepaliveOwner()
        val coordinator = AuthKeepaliveCoordinator(
            ops = ops,
            handler = handler,
            scheduler = ImmediateKeepaliveScheduler(),
            owner = owner,
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

    private class AuthKeepaliveStartFailed : RuntimeException()

    private class RecordingOps(
        private val onStart: () -> Unit = {},
    ) : AuthKeepaliveOps {
        val events = mutableListOf<String>()

        override fun start() {
            events.add("start")
            onStart()
        }

        override fun stop() {
            events.add("stop")
        }
    }

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
