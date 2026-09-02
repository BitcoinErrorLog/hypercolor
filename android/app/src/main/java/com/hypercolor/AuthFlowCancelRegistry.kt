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
 */
internal fun interface AuthFlowCancellable {
    fun cancel()
}

internal enum class AuthFlowCancelKind {
    Cancelled,
    AlreadyCancelled,
    AlreadySurfaced,
    Unknown,
}

internal data class AuthFlowCancelOutcome<T>(
    val kind: AuthFlowCancelKind,
    val droppedFlow: T? = null,
    val droppedCancellable: AuthFlowCancellable? = null,
)

internal sealed class AuthFlowAwaitStart<out T> {
    data class Ready<T>(val flow: T) : AuthFlowAwaitStart<T>()
    data object Cancelled : AuthFlowAwaitStart<Nothing>()
    data object Missing : AuthFlowAwaitStart<Nothing>()
}

internal class AuthFlowCancelRegistry<T> {
    private val lock = Any()
    private val slots = HashMap<String, Slot<T>>()
    private val cancelled = HashSet<String>()
    private val surfaced = HashSet<String>()

    fun put(id: String, flow: T) {
        synchronized(lock) {
            slots[id] = Slot(flow)
        }
    }

    fun peek(id: String): T? = synchronized(lock) { slots[id]?.flow }

    fun isCancelled(id: String): Boolean = synchronized(lock) { id in cancelled }

    fun isSurfaced(id: String): Boolean = synchronized(lock) { id in surfaced }

    fun abandon(id: String): T? {
        synchronized(lock) {
            return slots.remove(id)?.flow
        }
    }

    fun startAwait(id: String): AuthFlowAwaitStart<T> {
        synchronized(lock) {
            if (id in cancelled) {
                return AuthFlowAwaitStart.Cancelled
            }
            if (id in surfaced) {
                return AuthFlowAwaitStart.Missing
            }
            val slot = slots[id] ?: return AuthFlowAwaitStart.Missing
            if (slot.awaiting) {
                return AuthFlowAwaitStart.Missing
            }
            slot.awaiting = true
            return AuthFlowAwaitStart.Ready(slot.flow)
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
     * @return false when [id] was cancelled, so the caller must drop the
     * session and must not resolve JS.
     */
    fun markSurfaced(id: String): Boolean {
        synchronized(lock) {
            if (id in cancelled) {
                return false
            }
            surfaced.add(id)
            slots.remove(id)
            return true
        }
    }

    fun cancel(id: String): AuthFlowCancelOutcome<T> {
        synchronized(lock) {
            if (id in surfaced) {
                return AuthFlowCancelOutcome(AuthFlowCancelKind.AlreadySurfaced)
            }
            if (id in cancelled) {
                return AuthFlowCancelOutcome(AuthFlowCancelKind.AlreadyCancelled)
            }
            val slot = slots.remove(id)
            if (slot == null) {
                return AuthFlowCancelOutcome(AuthFlowCancelKind.Unknown)
            }
            cancelled.add(id)
            return AuthFlowCancelOutcome(
                AuthFlowCancelKind.Cancelled,
                droppedFlow = slot.flow,
                droppedCancellable = slot.cancellable,
            )
        }
    }

    /**
     * Called when [id]'s JS await promise is settling. Prunes [cancelled] /
     * [surfaced] and returns a leftover live flow so the caller can close it
     * (failed await). Cancel already dropped the slot; this only prunes the id.
     */
    fun finishAwait(id: String): T? {
        synchronized(lock) {
            cancelled.remove(id)
            surfaced.remove(id)
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

    private class Slot<T>(
        val flow: T,
        var awaiting: Boolean = false,
        var cancellable: AuthFlowCancellable? = null,
    )
}
