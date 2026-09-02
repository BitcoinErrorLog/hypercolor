package com.hypercolor

/**
 * Tracks one Paykit [ChatAuthFlow] per JS `flowId` so [cancelAuthFlow] can
 * retire the native waiter without JS calling [awaitAuthApproval].
 *
 * Paykit FFI has no auth-flow cancel/abort primitive ([ChatAuthFlow] exposes
 * `authorizationUrl` and `awaitApproval` only). Discard is native-side:
 * mark the id cancelled, drop a not-yet-awaited flow so its relay
 * subscription stops, cancel the in-flight await job, and reject a later
 * await with `auth_flow_cancelled`. A wait already spawned by
 * `awaitApproval` runs to completion inside Paykit and cannot be aborted;
 * the module closes the handle after that FFI await returns so the poll
 * can stop. Unknown ids and a second cancel are no-ops. A flow whose
 * approval has already been surfaced to JS is left untouched.
 *
 * Await ownership is lease-gated. States:
 * - idle: live flow, no owner
 * - reserved(lease): first await admitted, not yet in the FFI wait
 * - awaiting(lease): owner is inside `awaitApproval`
 * - cancelled-with-owner: tombstone whose lease still belongs to the
 *   admitted owner (that owner alone may prune)
 * - cancelled-no-owner: cancel-before-await tombstone; the next await
 *   becomes the unique owner and may prune
 * - surfaced: approval handed to JS; cancel is a no-op
 *
 * A second await while reserved, awaiting, or cancelled-with-owner is
 * [AuthFlowAwaitStart.AlreadyAwaiting] (`validation` / "already awaiting")
 * and must never call [finishAwait]. Post-FFI [markSurfaced] fails closed
 * on a tombstone so a cancelled owner cannot persist a session.
 *
 * [teardown] (module `invalidate`) is sticky [isTornDown]: reserved/awaiting
 * owners are cancelled **with their lease** so post-FFI fails closed and
 * never persists; owner metadata stays until that owner's [finishAwait].
 * Idle flows are returned for an immediate exact-once `close()`. Later
 * start/await/cancel observe [AuthFlowAwaitStart.Unavailable] /
 * [AuthFlowCancelKind.Unavailable] (`unavailable`, not `auth_flow_cancelled`).
 */
internal fun interface AuthFlowCancellable {
    fun cancel()
}

internal enum class AuthFlowCancelKind {
    Cancelled,
    AlreadyCancelled,
    AlreadySurfaced,
    Unknown,
    Unavailable,
}

internal data class AuthFlowCancelOutcome<T>(
    val kind: AuthFlowCancelKind,
    /**
     * UniFFI handle to `close()` immediately: idle / cancel-before-await.
     * Null when an admitted owner still holds the handle and must close
     * exactly once after its FFI path settles.
     */
    val droppedFlow: T? = null,
    val droppedCancellable: AuthFlowCancellable? = null,
)

internal data class AuthFlowTeardown<T>(
    val idleFlows: List<T>,
    val ownerCancellables: List<AuthFlowCancellable>,
)

internal sealed class AuthFlowAwaitStart<out T> {
    data class Ready<T>(val flow: T, val lease: Long) : AuthFlowAwaitStart<T>()
    data class Cancelled(val lease: Long) : AuthFlowAwaitStart<Nothing>()
    data object AlreadyAwaiting : AuthFlowAwaitStart<Nothing>()
    data object Missing : AuthFlowAwaitStart<Nothing>()
    data object Unavailable : AuthFlowAwaitStart<Nothing>()
}

internal class AuthFlowCancelRegistry<T> {
    private val lock = Any()
    private val slots = HashMap<String, Slot<T>>()
    /** Cancelled tombstones: `null` lease is cancelled-no-owner. */
    private val cancelled = HashMap<String, Long?>()
    private val surfaced = HashMap<String, Long>()
    private var nextLease = 1L
    private var tornDown = false

    fun isTornDown(): Boolean = synchronized(lock) { tornDown }

    /**
     * @return false when the module is torn down; the caller must close [flow].
     */
    fun put(id: String, flow: T): Boolean {
        synchronized(lock) {
            if (tornDown) {
                return false
            }
            slots[id] = Slot(flow)
            return true
        }
    }

    fun peek(id: String): T? = synchronized(lock) { slots[id]?.flow }

    fun isCancelled(id: String): Boolean = synchronized(lock) { cancelled.containsKey(id) }

    fun isSurfaced(id: String): Boolean = synchronized(lock) { surfaced.containsKey(id) }

    fun abandon(id: String): T? {
        synchronized(lock) {
            return slots.remove(id)?.flow
        }
    }

    fun startAwait(id: String): AuthFlowAwaitStart<T> {
        synchronized(lock) {
            if (tornDown) {
                return AuthFlowAwaitStart.Unavailable
            }
            if (surfaced.containsKey(id)) {
                return AuthFlowAwaitStart.Missing
            }
            if (cancelled.containsKey(id)) {
                val owner = cancelled[id]
                if (owner != null) {
                    // cancelled-with-owner: secondary must not take the lease
                    // or prune the tombstone while the original is settling.
                    return AuthFlowAwaitStart.AlreadyAwaiting
                }
                val lease = allocLeaseLocked()
                cancelled[id] = lease
                return AuthFlowAwaitStart.Cancelled(lease)
            }
            val slot = slots[id] ?: return AuthFlowAwaitStart.Missing
            if (slot.phase != Phase.Idle || slot.lease != null) {
                return AuthFlowAwaitStart.AlreadyAwaiting
            }
            val lease = allocLeaseLocked()
            slot.lease = lease
            slot.phase = Phase.Reserved
            return AuthFlowAwaitStart.Ready(slot.flow, lease)
        }
    }

    fun markAwaiting(id: String, lease: Long): Boolean {
        synchronized(lock) {
            val slot = slots[id] ?: return false
            if (slot.lease != lease) {
                return false
            }
            if (slot.phase == Phase.Idle) {
                return false
            }
            slot.phase = Phase.Awaiting
            return true
        }
    }

    fun attachCancellable(id: String, cancellable: AuthFlowCancellable) {
        synchronized(lock) {
            val slot = slots[id] ?: return
            slot.cancellable = cancellable
        }
    }

    fun detachCancellable(id: String) {
        synchronized(lock) {
            slots[id]?.cancellable = null
        }
    }

    /**
     * @return false when [id] was cancelled or [lease] is not the owner, so
     * the caller must drop the session and must not resolve JS.
     */
    fun markSurfaced(id: String, lease: Long): Boolean {
        synchronized(lock) {
            if (cancelled.containsKey(id)) {
                return false
            }
            val slot = slots[id] ?: return false
            if (slot.lease != lease) {
                return false
            }
            surfaced[id] = lease
            slots.remove(id)
            return true
        }
    }

    fun cancel(id: String): AuthFlowCancelOutcome<T> {
        synchronized(lock) {
            if (tornDown) {
                return AuthFlowCancelOutcome(AuthFlowCancelKind.Unavailable)
            }
            if (surfaced.containsKey(id)) {
                return AuthFlowCancelOutcome(AuthFlowCancelKind.AlreadySurfaced)
            }
            if (cancelled.containsKey(id)) {
                return AuthFlowCancelOutcome(AuthFlowCancelKind.AlreadyCancelled)
            }
            val slot = slots.remove(id)
            if (slot == null) {
                return AuthFlowCancelOutcome(AuthFlowCancelKind.Unknown)
            }
            cancelled[id] = slot.lease
            val ownerAdmitted = slot.lease != null
            return AuthFlowCancelOutcome(
                AuthFlowCancelKind.Cancelled,
                // Owner closes after FFI. Idle / cancel-before-await closes now.
                droppedFlow = if (ownerAdmitted) null else slot.flow,
                droppedCancellable = slot.cancellable,
            )
        }
    }

    /**
     * Bridge/module invalidation. Idempotent. Marks reserved/awaiting owners
     * cancelled with their lease (do not prune — [finishAwait] is owner-only),
     * returns idle flows for immediate close, and detaches owner jobs to
     * cancel **after** this lock is released.
     */
    fun teardown(): AuthFlowTeardown<T> {
        synchronized(lock) {
            if (tornDown) {
                return AuthFlowTeardown(emptyList(), emptyList())
            }
            tornDown = true
            val idle = ArrayList<T>()
            val ownerCancellables = ArrayList<AuthFlowCancellable>()
            val iterator = slots.entries.iterator()
            while (iterator.hasNext()) {
                val (id, slot) = iterator.next()
                if (slot.lease != null) {
                    cancelled[id] = slot.lease
                    slot.cancellable?.let { ownerCancellables.add(it) }
                } else {
                    idle.add(slot.flow)
                }
                iterator.remove()
            }
            return AuthFlowTeardown(idle, ownerCancellables)
        }
    }

    /**
     * Called when [id]'s JS await promise is settling. Only [lease]'s owner
     * may prune [cancelled] / [surfaced]. Returns a leftover live flow so
     * the caller can close it (failed await). Cancel already dropped the
     * slot; this only prunes matching owner state.
     */
    fun finishAwait(id: String, lease: Long): T? {
        synchronized(lock) {
            if (cancelled.containsKey(id)) {
                val owner = cancelled[id]
                if (owner != lease) {
                    return null
                }
                cancelled.remove(id)
                surfaced.remove(id)
                return slots.remove(id)?.flow
            }
            val surfacedLease = surfaced[id]
            if (surfacedLease != null) {
                if (surfacedLease != lease) {
                    return null
                }
                surfaced.remove(id)
                return slots.remove(id)?.flow
            }
            val slot = slots[id] ?: return null
            if (slot.lease != lease) {
                return null
            }
            return slots.remove(id)?.flow
        }
    }

    fun drainLive(): List<Pair<T, AuthFlowCancellable?>> {
        synchronized(lock) {
            val live = slots.values.map { it.flow to it.cancellable }
            slots.clear()
            cancelled.clear()
            surfaced.clear()
            return live
        }
    }

    private fun allocLeaseLocked(): Long {
        val lease = nextLease
        nextLease += 1L
        return lease
    }

    private enum class Phase {
        Idle,
        Reserved,
        Awaiting,
    }

    private class Slot<T>(
        val flow: T,
        var phase: Phase = Phase.Idle,
        var lease: Long? = null,
        var cancellable: AuthFlowCancellable? = null,
    )
}
