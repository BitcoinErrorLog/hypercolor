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
 * approval has already been confirmed ([confirmPending]) is left untouched.
 *
 * Await ownership is lease-gated. States:
 * - idle: live flow, no owner
 * - reserved(lease): first await admitted, not yet in the FFI wait
 * - awaiting(lease): owner is inside `awaitApproval`
 * - cancelled-with-owner: tombstone whose lease still belongs to the
 *   admitted owner (that owner alone may prune)
 * - cancelled-no-owner: cancel-before-await tombstone; the next await
 *   becomes the unique owner and may prune
 * - surfaced: owner confirmed the pending persist; cancel is a no-op
 *
 * Session adoption is **not** resolver invocation. RN 0.81.5
 * `promise.resolve` only schedules JS via `CallInvoker::invokeAsync`.
 * Native is the authority:
 *
 *   beginPending(alias)  → alias is teardown-visible (in-memory pending)
 *   persist bearer + durable pending marker **outside** this lock
 *   confirmPending        → flow may leave the owner slot; alias stays pending
 *   resolve(alias)        → schedules JS; not adoption
 *   adoptPending(alias)   → only this clears pending; session is retained
 *   teardown / process-death sweep → delete every still-pending alias
 *
 * A second await while reserved, awaiting, or cancelled-with-owner is
 * [AuthFlowAwaitStart.AlreadyAwaiting] (`validation` / "already awaiting")
 * and must never call [finishAwait]. Post-FFI [beginPending] /
 * [confirmPending] fail closed on torn-down / tombstone so a cancelled or
 * invalidated owner cannot persist a session.
 *
 * [teardown] (module `invalidate`) is sticky [isTornDown]: reserved/
 * awaiting owners are cancelled **with their lease** so post-FFI fails
 * closed and never persists; owner metadata stays until that owner's
 * [finishAwait]. Idle flows are returned for an immediate exact-once
 * `close()`. Every still-pending alias is returned for delete (bearer,
 * `sessions`, durable marker). Later start/await/cancel observe
 * [AuthFlowAwaitStart.Unavailable] / [AuthFlowCancelKind.Unavailable]
 * (`unavailable`, not `auth_flow_cancelled`).
 *
 * [drainLive] (`clearAllNativeSecrets`, user sign-out) is not sticky
 * teardown. It returns the same idle/owner split as [teardown] plus
 * pending aliases. Caller closes idle immediately; cancel owners and let
 * only their `finally` close. In-flight owners reject `auth_flow_cancelled`
 * (user discard) and must not persist. Pending aliases are cleared here so
 * sign-out cannot leave an unadopted bearer.
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
    /** Aliases still pending JS [adoptPending]; caller must delete them. */
    val pendingAliases: List<String> = emptyList(),
)

internal sealed class AuthFlowAwaitStart<out T> {
    data class Ready<T>(val flow: T, val lease: Long) : AuthFlowAwaitStart<T>()
    data class Cancelled(val lease: Long) : AuthFlowAwaitStart<Nothing>()
    data object AlreadyAwaiting : AuthFlowAwaitStart<Nothing>()
    data object Missing : AuthFlowAwaitStart<Nothing>()
    data object Unavailable : AuthFlowAwaitStart<Nothing>()
}

internal class AuthFlowCancelRegistry<T> {
    /**
     * JVM intrinsic monitor (`synchronized`): reentrant. No registry method
     * calls another registry method, so re-entry is unused. Store I/O never
     * runs under this monitor. Cannot self-deadlock; contrast iOS `NSLock`.
     */
    private val lock = Any()
    private val slots = HashMap<String, Slot<T>>()
    /** Cancelled tombstones: `null` lease is cancelled-no-owner. */
    private val cancelled = HashMap<String, Long?>()
    private val surfaced = HashMap<String, Long>()
    /** Teardown-visible pending session aliases keyed independently of flow ids. */
    private val pendingAliases = HashSet<String>()
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

    fun isCancelled(id: String): Boolean = synchronized(lock) { cancelled.containsKey(id) }

    fun isPending(alias: String): Boolean = synchronized(lock) { pendingAliases.contains(alias) }

    /**
     * Session aliases that are still in-flight: pending (after persist,
     * before adopt). Reserved/awaiting auth flows have no session alias
     * until [beginPending]; after that they are in this set. Adopting is
     * tracked by the module, not this registry.
     */
    fun inFlightSessionAliases(): Set<String> = synchronized(lock) { pendingAliases.toSet() }

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
     * Sign-in / sign-up persist with no auth-flow owner. Fails closed when
     * torn down so invalidation cannot leave a new unadopted bearer.
     */
    fun registerPending(alias: String): Boolean {
        synchronized(lock) {
            if (tornDown) {
                return false
            }
            pendingAliases.add(alias)
            return true
        }
    }

    /**
     * Owner is still valid: record [alias] as teardown-visible pending.
     * Secure-store I/O happens **outside** this lock. Returns false when
     * torn down, cancelled, or [lease] is not the owner: the caller must
     * not persist, must not resolve JS, and must reject `unavailable` if
     * [isTornDown] else `auth_flow_cancelled`.
     */
    fun beginPending(id: String, lease: Long, alias: String): Boolean {
        synchronized(lock) {
            if (tornDown) {
                return false
            }
            if (cancelled.containsKey(id)) {
                return false
            }
            val slot = slots[id] ?: return false
            if (slot.lease != lease) {
                return false
            }
            pendingAliases.add(alias)
            return true
        }
    }

    /**
     * Persist succeeded. Flow may leave the owner slot; [alias] stays in
     * the pending set until [adoptPending]. Returns false when torn down,
     * cancelled, lease mismatch, or teardown already drained [alias]:
     * the caller must roll back the store write and must not resolve JS.
     */
    fun confirmPending(id: String, lease: Long, alias: String): Boolean {
        synchronized(lock) {
            if (tornDown) {
                return false
            }
            if (cancelled.containsKey(id)) {
                return false
            }
            if (!pendingAliases.contains(alias)) {
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

    /**
     * JS acknowledgement. Only this removes [alias] from pending. Unknown
     * or already-adopted aliases return false (`unavailable`).
     */
    fun adoptPending(alias: String): Boolean {
        synchronized(lock) {
            return pendingAliases.remove(alias)
        }
    }

    /** Persist failed before confirm, or confirm lost the race: drop in-memory pending. */
    fun dropPending(alias: String) {
        synchronized(lock) {
            pendingAliases.remove(alias)
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
     * Bridge/module invalidation. Idempotent. Marks reserved/awaiting
     * owners cancelled with their lease (do not prune — [finishAwait] is
     * owner-only), returns idle flows for immediate close, detaches owner
     * jobs to cancel **after** this lock is released, and returns every
     * still-pending alias for delete. Adopted aliases are absent from
     * pending and are not rolled back.
     */
    fun teardown(): AuthFlowTeardown<T> {
        synchronized(lock) {
            if (tornDown) {
                return AuthFlowTeardown(emptyList(), emptyList(), emptyList())
            }
            tornDown = true
            return drainOwnersLocked(tombstoneOwners = true, dropStaleTombstones = false)
        }
    }

    /**
     * Sign-out / [PaykitLinkModule.clearAllNativeSecrets]. Not sticky
     * teardown: a later [put] still succeeds. Same idle/owner split as
     * [teardown] — caller closes idle immediately and cancels owners so
     * only [AuthFlowAwait] `finally` closes. Owners are tombstoned with
     * their lease and reject `auth_flow_cancelled`. Pending aliases are
     * drained so an unadopted bearer cannot survive sign-out.
     */
    fun drainLive(): AuthFlowTeardown<T> {
        synchronized(lock) {
            return drainOwnersLocked(tombstoneOwners = true, dropStaleTombstones = true)
        }
    }

    /**
     * Called when [id]'s JS await promise is settling. Only [lease]'s owner
     * may prune [cancelled] / [surfaced]. Returns a leftover live flow so
     * the caller can close it (failed await). Cancel already dropped the
     * slot; this only prunes matching owner state. Does not drop pending
     * session aliases.
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

    private fun drainOwnersLocked(
        tombstoneOwners: Boolean,
        dropStaleTombstones: Boolean,
    ): AuthFlowTeardown<T> {
        val idle = ArrayList<T>()
        val ownerCancellables = ArrayList<AuthFlowCancellable>()
        val ownerTombstones = HashMap<String, Long>()
        val iterator = slots.entries.iterator()
        while (iterator.hasNext()) {
            val (id, slot) = iterator.next()
            val lease = slot.lease
            if (lease != null) {
                if (tombstoneOwners) {
                    ownerTombstones[id] = lease
                }
                slot.cancellable?.let { ownerCancellables.add(it) }
            } else {
                idle.add(slot.flow)
            }
            iterator.remove()
        }
        if (dropStaleTombstones) {
            cancelled.clear()
        }
        if (tombstoneOwners) {
            for ((id, lease) in ownerTombstones) {
                cancelled[id] = lease
            }
        }
        surfaced.clear()
        val pending = pendingAliases.toList()
        pendingAliases.clear()
        return AuthFlowTeardown(idle, ownerCancellables, pending)
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
