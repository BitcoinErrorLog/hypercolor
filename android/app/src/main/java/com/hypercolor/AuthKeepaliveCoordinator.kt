package com.hypercolor

import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch

/**
 * pubky-core HTTP relay unused-request timeout:
 * `DEFAULT_REQUEST_TIMEOUT = Duration::from_secs(10 * 60)` in
 * `http-relay/src/http_relay.rs`.
 *
 * Paykit `ChatAuthFlow.awaitApproval()` has no timeout argument; the wait
 * ends on approval or when that relay times out. This ceiling matches the
 * 10-minute bound so the foreground service cannot linger for the Android
 * 15+ 6-hour `dataSync` limit.
 */
internal const val AUTH_KEEPALIVE_MAX_MS = 10 * 60 * 1000L

internal interface AuthKeepaliveOps {
    fun start()
    fun stop()
}

internal interface AuthKeepaliveHandler {
    fun post(block: () -> Unit)
    fun isCurrentThread(): Boolean
}

internal interface AuthKeepaliveScheduler {
    fun schedule(delayMs: Long, key: Long, action: () -> Unit)
    fun cancel(key: Long)
}

internal class ImmediateKeepaliveHandler : AuthKeepaliveHandler {
    override fun post(block: () -> Unit) = block()
    override fun isCurrentThread(): Boolean = true
}

internal class MainKeepaliveHandler : AuthKeepaliveHandler {
    private val handler = Handler(Looper.getMainLooper())
    override fun post(block: () -> Unit) {
        handler.post(block)
    }
    override fun isCurrentThread(): Boolean = Looper.myLooper() == Looper.getMainLooper()
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
}

internal class HandlerKeepaliveScheduler : AuthKeepaliveScheduler {
    private val handler = Handler(Looper.getMainLooper())
    private val tokens = ConcurrentHashMap<Long, Runnable>()

    override fun schedule(delayMs: Long, key: Long, action: () -> Unit) {
        val runnable = Runnable {
            tokens.remove(key)
            action()
        }
        tokens[key] = runnable
        handler.postDelayed(runnable, delayMs)
    }

    override fun cancel(key: Long) {
        val runnable = tokens.remove(key) ?: return
        handler.removeCallbacks(runnable)
    }
}

/**
 * Serializes every ownership transition and every service start/stop on
 * [handler] so a stale stop cannot overtake a newer start.
 */
internal class AuthKeepaliveCoordinator(
    private val ops: AuthKeepaliveOps,
    private val handler: AuthKeepaliveHandler,
    private val scheduler: AuthKeepaliveScheduler,
    private val owner: AuthKeepaliveOwner = AuthKeepaliveOwner(),
    private val maxLifetimeMs: Long = AUTH_KEEPALIVE_MAX_MS,
) {
    fun owner(): String? = owner.owner()

    fun phase(): AuthKeepaliveOwner.Phase = owner.phase()

    fun ensureStarted(attemptId: String) {
        runSerialized {
            ensureStartedLocked(attemptId)
        }
    }

    fun release(attemptId: String) {
        runSerialized {
            releaseLocked(attemptId)
        }
    }

    fun releaseAll() {
        runSerialized {
            releaseAllLocked()
        }
    }

    fun handleSystemTimeout() {
        runSerialized {
            releaseAllLocked()
        }
    }

    fun attach() {
        PaykitAuthKeepaliveService.systemTimeoutListener = {
            handleSystemTimeout()
        }
    }

    fun detach() {
        PaykitAuthKeepaliveService.systemTimeoutListener = null
    }

    private fun ensureStartedLocked(attemptId: String) {
        val claim = owner.claim(attemptId)
        when (claim.kind) {
            AuthKeepaliveOwner.ClaimKind.AlreadyConfirmed,
            AuthKeepaliveOwner.ClaimKind.AdoptedConfirmed,
            -> return
            AuthKeepaliveOwner.ClaimKind.AwaitUnconfirmed ->
                error("auth keepalive start is still unconfirmed")
            AuthKeepaliveOwner.ClaimKind.Start -> {
                try {
                    ops.start()
                    if (!owner.confirmStart(attemptId, claim.generation)) {
                        ops.stop()
                        error("auth keepalive start was orphaned")
                    }
                    scheduler.schedule(maxLifetimeMs, claim.generation) {
                        runSerialized { releaseAllLocked() }
                    }
                } catch (error: Throwable) {
                    owner.failStart(attemptId, claim.generation)
                    throw error
                }
            }
        }
    }

    private fun releaseLocked(attemptId: String) {
        val generation = owner.generation()
        val shouldStop = owner.release(attemptId)
        if (shouldStop) {
            scheduler.cancel(generation)
            ops.stop()
        }
    }

    private fun releaseAllLocked() {
        val generation = owner.generation()
        val shouldStop = owner.releaseAll()
        scheduler.cancel(generation)
        if (shouldStop) {
            ops.stop()
        }
    }

    private fun runSerialized(block: () -> Unit) {
        if (handler.isCurrentThread()) {
            block()
            return
        }
        val done = CountDownLatch(1)
        var failure: Throwable? = null
        handler.post {
            try {
                block()
            } catch (error: Throwable) {
                failure = error
            } finally {
                done.countDown()
            }
        }
        done.await()
        val thrown = failure
        if (thrown != null) throw thrown
    }
}
