package com.hypercolor

import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Pinned Paykit AAR (`BitcoinErrorLog/paykit-rs-official`) vendors Pubky
 * auth polling at:
 * `vendor/pubky/src/actors/auth/http_relay_link_channel.rs`
 * and `vendor/pubky/src/actors/auth/auth_subscription.rs`.
 *
 * `AuthSubscription` calls `encrypted_channel.poll(client, None)`. That
 * `poll` has no overall deadline: `PollError::Timeout` retries without
 * bound, and `PollError::Failure` retries until `MAX_FAILURES = 3`.
 * Each HTTP-relay unused-request hold is 10 minutes
 * (`DEFAULT_REQUEST_TIMEOUT` in pubky-core `http-relay/src/http_relay.rs`).
 *
 * Three consecutive failed holds can therefore keep a legitimate wait
 * near 30 minutes. This ceiling is 30 minutes plus a 5-minute
 * scheduling/network margin, still far below the Android 15+ 6-hour
 * `dataSync` foreground-service limit.
 */
internal const val AUTH_KEEPALIVE_RELAY_HOLD_MS = 10 * 60 * 1000L
internal const val AUTH_KEEPALIVE_MAX_POLL_FAILURES = 3
internal const val AUTH_KEEPALIVE_SCHEDULE_MARGIN_MS = 5 * 60 * 1000L
internal const val AUTH_KEEPALIVE_MAX_MS =
    AUTH_KEEPALIVE_RELAY_HOLD_MS * AUTH_KEEPALIVE_MAX_POLL_FAILURES +
        AUTH_KEEPALIVE_SCHEDULE_MARGIN_MS
internal const val AUTH_KEEPALIVE_DISPATCH_TIMEOUT_MS = 5_000L

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

internal interface AuthKeepalivePoster {
    fun postDelayed(delayMs: Long, runnable: Runnable)
    fun remove(runnable: Runnable)
}

internal class MainKeepaliveHandler : AuthKeepaliveHandler {
    private val handler = Handler(Looper.getMainLooper())
    override fun post(block: () -> Unit) {
        handler.post(block)
    }
    override fun isCurrentThread(): Boolean = Looper.myLooper() == Looper.getMainLooper()
}

/**
 * Android-free start/stop lifetime scheduler. Production wraps a main
 * [Handler]; tests inject a poster so expiry/cancel can be fired without
 * sleeping or Looper.
 */
internal class TokenKeepaliveScheduler(
    private val poster: AuthKeepalivePoster,
) : AuthKeepaliveScheduler {
    private val tokens = ConcurrentHashMap<Long, Runnable>()

    override fun schedule(delayMs: Long, key: Long, action: () -> Unit) {
        cancel(key)
        val runnable = object : Runnable {
            override fun run() {
                if (tokens.remove(key, this)) {
                    action()
                }
            }
        }
        tokens[key] = runnable
        poster.postDelayed(delayMs, runnable)
    }

    override fun cancel(key: Long) {
        val runnable = tokens.remove(key) ?: return
        poster.remove(runnable)
    }
}

internal class HandlerKeepaliveScheduler : AuthKeepaliveScheduler {
    private val impl = TokenKeepaliveScheduler(HandlerKeepalivePoster())

    override fun schedule(delayMs: Long, key: Long, action: () -> Unit) {
        impl.schedule(delayMs, key, action)
    }

    override fun cancel(key: Long) {
        impl.cancel(key)
    }
}

private class HandlerKeepalivePoster : AuthKeepalivePoster {
    private val handler = Handler(Looper.getMainLooper())

    override fun postDelayed(delayMs: Long, runnable: Runnable) {
        handler.postDelayed(runnable, delayMs)
    }

    override fun remove(runnable: Runnable) {
        handler.removeCallbacks(runnable)
    }
}

internal class AuthKeepaliveDispatchTimeout : IllegalStateException("auth keepalive dispatch timed out")

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
    private val dispatchTimeoutMs: Long = AUTH_KEEPALIVE_DISPATCH_TIMEOUT_MS,
) {
    @Volatile
    private var lifetimeEpoch: Long = 0L

    @Volatile
    private var expectedStopGeneration: Long? = null

    @Volatile
    private var staleDestroyGeneration: Long? = null

    fun owner(): String? = owner.owner()

    fun phase(): AuthKeepaliveOwner.Phase = owner.phase()

    fun lifetimeEpoch(): Long = lifetimeEpoch

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

    /**
     * Task-removed / [android.app.Service.onDestroy] reconciliation.
     * Clears confirmed ownership without calling [AuthKeepaliveOps.stop],
     * so a disappearing service cannot recurse into stop/onDestroy or
     * reap a newer generation.
     */
    fun handleServiceDisappeared() {
        runSerialized {
            markServiceGoneLocked()
        }
    }

    fun attach() {
        PaykitAuthKeepaliveService.systemTimeoutListener = {
            handleSystemTimeout()
        }
        PaykitAuthKeepaliveService.serviceDisappearedListener = {
            handleServiceDisappeared()
        }
    }

    fun detach() {
        PaykitAuthKeepaliveService.systemTimeoutListener = null
        PaykitAuthKeepaliveService.serviceDisappearedListener = null
    }

    private fun ensureStartedLocked(attemptId: String) {
        val claim = owner.claim(attemptId)
        when (claim.kind) {
            AuthKeepaliveOwner.ClaimKind.AlreadyConfirmed,
            AuthKeepaliveOwner.ClaimKind.AdoptedConfirmed,
            -> {
                armLifetimeLocked()
            }
            AuthKeepaliveOwner.ClaimKind.AwaitUnconfirmed ->
                error("auth keepalive start is still unconfirmed")
            AuthKeepaliveOwner.ClaimKind.Start -> {
                try {
                    ops.start()
                    if (!owner.confirmStart(attemptId, claim.generation)) {
                        requestStopLocked(claim.generation)
                        error("auth keepalive start was orphaned")
                    }
                    staleDestroyGeneration = expectedStopGeneration
                    expectedStopGeneration = null
                    armLifetimeLocked()
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
            cancelLifetimeLocked()
            requestStopLocked(generation)
        }
    }

    private fun releaseAllLocked() {
        val generation = owner.generation()
        val shouldStop = owner.releaseAll()
        cancelLifetimeLocked()
        if (shouldStop) {
            requestStopLocked(generation)
        }
    }

    private fun markServiceGoneLocked() {
        val generation = owner.generation()
        val stale = staleDestroyGeneration
        if (stale != null && generation != stale) {
            staleDestroyGeneration = null
            return
        }
        if (owner.phase() == AuthKeepaliveOwner.Phase.Idle && owner.owner() == null) {
            return
        }
        cancelLifetimeLocked()
        owner.releaseAll()
        expectedStopGeneration = null
        staleDestroyGeneration = null
    }

    private fun requestStopLocked(generation: Long) {
        expectedStopGeneration = generation
        ops.stop()
    }

    private fun armLifetimeLocked() {
        cancelLifetimeLocked()
        lifetimeEpoch += 1L
        val epoch = lifetimeEpoch
        val generation = owner.generation()
        scheduler.schedule(maxLifetimeMs, epoch) {
            runSerialized {
                expireIfCurrentLocked(epoch, generation)
            }
        }
    }

    private fun cancelLifetimeLocked() {
        scheduler.cancel(lifetimeEpoch)
    }

    private fun expireIfCurrentLocked(epoch: Long, generation: Long) {
        if (epoch != lifetimeEpoch) return
        if (generation != owner.generation()) return
        releaseAllLocked()
    }

    private fun runSerialized(block: () -> Unit) {
        if (handler.isCurrentThread()) {
            block()
            return
        }
        val gate = DispatchGate()
        val done = CountDownLatch(1)
        var failure: Throwable? = null
        handler.post {
            val accepted = synchronized(gate) {
                if (gate.cancelled) {
                    false
                } else {
                    gate.started = true
                    true
                }
            }
            if (!accepted) {
                done.countDown()
                return@post
            }
            try {
                block()
            } catch (error: Throwable) {
                failure = error
            } finally {
                done.countDown()
            }
        }
        if (!done.await(dispatchTimeoutMs, TimeUnit.MILLISECONDS)) {
            val started = synchronized(gate) {
                if (!gate.started) {
                    gate.cancelled = true
                    false
                } else {
                    true
                }
            }
            if (!started) {
                throw AuthKeepaliveDispatchTimeout()
            }
            if (!done.await(dispatchTimeoutMs, TimeUnit.MILLISECONDS)) {
                throw AuthKeepaliveDispatchTimeout()
            }
        }
        val thrown = failure
        if (thrown != null) throw thrown
    }

    private class DispatchGate {
        var cancelled: Boolean = false
        var started: Boolean = false
    }
}
