package com.hypercolor

import java.util.concurrent.Executor

internal class ImmediateKeepaliveHandler : AuthKeepaliveHandler {
    override fun post(block: () -> Unit) = block()
    override fun isCurrentThread(): Boolean = true
}

/** Test scheduler: records work by key and fires it only when the test asks. */
internal class ImmediateKeepaliveScheduler : AuthKeepaliveScheduler {
    private val pending = LinkedHashMap<Long, () -> Unit>()

    override fun schedule(delayMs: Long, key: Long, action: () -> Unit) {
        pending[key] = action
    }

    override fun cancel(key: Long) {
        pending.remove(key)
    }

    fun fire(key: Long) {
        pending.remove(key)?.invoke()
    }

    fun pendingKeys(): Set<Long> = pending.keys.toSet()
}

internal class RecordingOps(
    private val onStart: () -> Unit = {},
) : AuthKeepaliveOps {
    val events = mutableListOf<String>()

    override fun start(instanceToken: Long) {
        events.add("start")
        onStart()
    }

    override fun stop() {
        events.add("stop")
    }
}

internal class StallingKeepaliveHandler : AuthKeepaliveHandler {
    private val queue = ArrayDeque<() -> Unit>()
    private var current = false

    override fun post(block: () -> Unit) {
        queue.addLast(block)
    }

    override fun isCurrentThread(): Boolean = current

    fun queuedCount(): Int = queue.size

    fun runAll() {
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

internal class ExecutorKeepaliveHandler(
    private val executor: Executor,
    private val worker: Thread,
) : AuthKeepaliveHandler {
    override fun post(block: () -> Unit) {
        executor.execute(block)
    }

    override fun isCurrentThread(): Boolean = Thread.currentThread() === worker
}

internal class RecordingPoster : AuthKeepalivePoster {
    private val delayed = LinkedHashMap<Runnable, Long>()

    override fun postDelayed(delayMs: Long, runnable: Runnable) {
        delayed[runnable] = delayMs
    }

    override fun remove(runnable: Runnable) {
        delayed.remove(runnable)
    }

    fun fireAll() {
        val runnables = delayed.keys.toList()
        delayed.clear()
        runnables.forEach { it.run() }
    }

    fun pendingCount(): Int = delayed.size

    fun snapshot(): List<Runnable> = delayed.keys.toList()
}
