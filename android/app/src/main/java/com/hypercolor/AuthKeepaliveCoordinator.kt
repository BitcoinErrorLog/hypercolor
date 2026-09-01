package com.hypercolor

import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Explicit product authorization ceiling for the Ring-auth foreground
 * keepalive. It is not derived from a multiple of relay hold times.
 *
 * Production default (pinned Paykit AAR / `paykit-rs-official` vendor):
 * - `AuthSubscriptionBuilder::new` uses `DEFAULT_HTTP_RELAY_INBOX`;
 *   `AuthSubscriptionBuilder::start` selects the inbox channel unless
 *   the relay path ends with `/link` (`auth_subscription.rs`).
 * - `AuthSubscription::poll_for_token` calls
 *   `EncryptedAuthChannel.poll(client, None)`.
 * - Inbox `HttpRelayInboxChannel::poll_once` treats a server 408 as
 *   `PollError::Timeout` after a ~25s GET hold
 *   (`http_relay_inbox_channel.rs`).
 * - `HttpRelayInboxChannel::poll` retries those healthy timeout cycles
 *   with no overall deadline (`timeout = None`) and aborts only after
 *   `MAX_FAILURES = 3` consecutive hard transport failures.
 *
 * 35 minutes is therefore a product cap: enough wall time for a human
 * to approve in Ring, far below the Android 15+ 6-hour `dataSync` FGS
 * limit.
 */
internal const val AUTH_KEEPALIVE_MAX_MS = 35 * 60 * 1000L
internal const val AUTH_KEEPALIVE_DISPATCH_TIMEOUT_MS = 5_000L

internal interface AuthKeepaliveOps {
    fun start(instanceToken: Long)
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
    private var nextServiceToken: Long = 0L

    @Volatile
    private var currentServiceToken: Long = 0L

    @Volatile
    private var startingServiceToken: Long = 0L

    fun owner(): String? = owner.owner()

    fun phase(): AuthKeepaliveOwner.Phase = owner.phase()

    fun lifetimeEpoch(): Long = lifetimeEpoch

    fun serviceInstanceToken(): Long =
        if (currentServiceToken != 0L) currentServiceToken else startingServiceToken

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
     * Task-removed / [android.app.Service.onDestroy] reconciliation for
     * one service instance. [instanceToken] must match the token issued
     * at that instance's start. A stale or duplicate callback is ignored
     * and never calls [AuthKeepaliveOps.stop].
     */
    fun handleServiceDisappeared(instanceToken: Long) {
        runSerialized {
            markServiceGoneLocked(instanceToken)
        }
    }

    fun attach() {
        PaykitAuthKeepaliveService.systemTimeoutListener = {
            handleSystemTimeout()
        }
        PaykitAuthKeepaliveService.serviceDisappearedListener = { token ->
            handleServiceDisappeared(token)
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
                startingServiceToken = nextServiceToken + 1L
                nextServiceToken = startingServiceToken
                val instanceToken = startingServiceToken
                try {
                    ops.start(instanceToken)
                    if (!owner.confirmStart(attemptId, claim.generation)) {
                        requestStopLocked()
                        error("auth keepalive start was orphaned")
                    }
                    currentServiceToken = instanceToken
                    startingServiceToken = 0L
                    armLifetimeLocked()
                } catch (error: Throwable) {
                    if (startingServiceToken == instanceToken) {
                        startingServiceToken = 0L
                    }
                    owner.failStart(attemptId, claim.generation)
                    throw error
                }
            }
        }
    }

    private fun releaseLocked(attemptId: String) {
        val shouldStop = owner.release(attemptId)
        if (shouldStop) {
            cancelLifetimeLocked()
            requestStopLocked()
        }
    }

    private fun releaseAllLocked() {
        val shouldStop = owner.releaseAll()
        cancelLifetimeLocked()
        if (shouldStop) {
            requestStopLocked()
        }
    }

    private fun markServiceGoneLocked(instanceToken: Long) {
        if (instanceToken == 0L) return
        if (instanceToken != currentServiceToken && instanceToken != startingServiceToken) {
            return
        }
        val alreadyIdle = owner.phase() == AuthKeepaliveOwner.Phase.Idle && owner.owner() == null
        if (instanceToken == currentServiceToken) {
            currentServiceToken = 0L
        }
        if (instanceToken == startingServiceToken) {
            startingServiceToken = 0L
        }
        if (alreadyIdle) {
            return
        }
        cancelLifetimeLocked()
        owner.releaseAll()
    }

    private fun requestStopLocked() {
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
