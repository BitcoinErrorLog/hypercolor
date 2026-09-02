package com.hypercolor

import kotlinx.coroutines.CancellationException as CoroutineCancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import java.util.concurrent.CancellationException as JavaCancellationException
import kotlin.coroutines.coroutineContext

internal class AuthFlowBridgeReject(
    val code: String,
    override val message: String,
) : Exception(message)

/**
 * Shared await body for [PaykitLinkModule.awaitAuthApproval] and the
 * coroutine harness tests. Duplicate calls never receive a lease and must
 * not prune another owner's cancellation tombstone.
 *
 * Error codes:
 * - `auth_flow_cancelled` — registry/user [AuthFlowCancelRegistry.cancel]
 * - `unavailable` — module [AuthFlowCancelRegistry.teardown] / missing module
 * Coroutine-scope cancellation without a tombstone is rethrown so the
 * module launcher can map it to `unavailable`.
 */
internal object AuthFlowAwait {
    const val ALREADY_AWAITING_MESSAGE = "already awaiting"
    const val UNKNOWN_FLOW_MESSAGE = "unknown auth flow"
    const val CANCELLED_MESSAGE = "auth flow cancelled"
    const val UNAVAILABLE_MESSAGE = "unavailable"

    suspend fun <T, S> execute(
        flows: AuthFlowCancelRegistry<T>,
        id: String,
        awaitFfi: suspend (T) -> S,
        closeFlow: (T?) -> Unit,
        onOwnerStart: () -> Unit = {},
        onOwnerFinish: () -> Unit = {},
    ): S {
        when (val start = flows.startAwait(id)) {
            is AuthFlowAwaitStart.Unavailable ->
                throw AuthFlowBridgeReject("unavailable", UNAVAILABLE_MESSAGE)
            is AuthFlowAwaitStart.AlreadyAwaiting ->
                throw AuthFlowBridgeReject("validation", ALREADY_AWAITING_MESSAGE)
            is AuthFlowAwaitStart.Missing ->
                throw AuthFlowBridgeReject("validation", UNKNOWN_FLOW_MESSAGE)
            is AuthFlowAwaitStart.Cancelled -> {
                flows.finishAwait(id, start.lease)
                throw AuthFlowBridgeReject("auth_flow_cancelled", CANCELLED_MESSAGE)
            }
            is AuthFlowAwaitStart.Ready -> {
                val flow = start.flow
                val lease = start.lease
                try {
                    onOwnerStart()
                    val job = coroutineContext[Job]
                    if (job != null) {
                        flows.attachCancellable(id, AuthFlowCancellable { job.cancel() })
                    }
                    flows.markAwaiting(id, lease)
                    if (flows.isTornDown()) {
                        throw AuthFlowBridgeReject("unavailable", UNAVAILABLE_MESSAGE)
                    }
                    if (flows.isCancelled(id)) {
                        throw AuthFlowBridgeReject("auth_flow_cancelled", CANCELLED_MESSAGE)
                    }
                    coroutineContext.ensureActive()
                    val session = awaitFfi(flow)
                    if (!flows.markSurfaced(id, lease)) {
                        if (flows.isTornDown()) {
                            throw AuthFlowBridgeReject("unavailable", UNAVAILABLE_MESSAGE)
                        }
                        throw AuthFlowBridgeReject("auth_flow_cancelled", CANCELLED_MESSAGE)
                    }
                    return session
                } catch (error: Throwable) {
                    if (error is AuthFlowBridgeReject) {
                        throw error
                    }
                    if (flows.isTornDown()) {
                        throw AuthFlowBridgeReject("unavailable", UNAVAILABLE_MESSAGE)
                    }
                    if (flows.isCancelled(id)) {
                        throw AuthFlowBridgeReject("auth_flow_cancelled", CANCELLED_MESSAGE)
                    }
                    if (isCoroutineCancellation(error)) {
                        throw error
                    }
                    throw error
                } finally {
                    flows.detachCancellable(id)
                    flows.finishAwait(id, lease)
                    try {
                        onOwnerFinish()
                    } finally {
                        // Exact-once: this admitted owner always closes after
                        // the FFI path settles. Cancel must not also close.
                        closeFlow(flow)
                    }
                }
            }
        }
    }

    private fun isCoroutineCancellation(error: Throwable): Boolean {
        return error is CoroutineCancellationException || error is JavaCancellationException
    }
}
