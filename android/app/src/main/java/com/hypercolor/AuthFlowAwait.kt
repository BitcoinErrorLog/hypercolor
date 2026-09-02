package com.hypercolor

import kotlinx.coroutines.CancellationException as CoroutineCancellationException
import kotlinx.coroutines.Job
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
 */
internal object AuthFlowAwait {
    const val ALREADY_AWAITING_MESSAGE = "already awaiting"
    const val UNKNOWN_FLOW_MESSAGE = "unknown auth flow"
    const val CANCELLED_MESSAGE = "auth flow cancelled"

    suspend fun <T, S> execute(
        flows: AuthFlowCancelRegistry<T>,
        id: String,
        awaitFfi: suspend (T) -> S,
        closeFlow: (T?) -> Unit,
        onOwnerStart: () -> Unit = {},
        onOwnerFinish: () -> Unit = {},
    ): S {
        when (val start = flows.startAwait(id)) {
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
                    if (flows.isCancelled(id)) {
                        throw AuthFlowBridgeReject("auth_flow_cancelled", CANCELLED_MESSAGE)
                    }
                    val session = awaitFfi(flow)
                    if (!flows.markSurfaced(id, lease)) {
                        throw AuthFlowBridgeReject("auth_flow_cancelled", CANCELLED_MESSAGE)
                    }
                    return session
                } catch (error: Throwable) {
                    if (error is AuthFlowBridgeReject && error.code == "auth_flow_cancelled") {
                        throw error
                    }
                    if (flows.isCancelled(id) || isCoroutineCancellation(error)) {
                        throw AuthFlowBridgeReject("auth_flow_cancelled", CANCELLED_MESSAGE)
                    }
                    throw error
                } finally {
                    flows.detachCancellable(id)
                    val cancelled = flows.isCancelled(id)
                    val leftover = flows.finishAwait(id, lease)
                    try {
                        onOwnerFinish()
                    } finally {
                        if (leftover != null) {
                            closeFlow(leftover)
                        } else if (cancelled) {
                            closeFlow(flow)
                        }
                    }
                }
            }
        }
    }

    private fun isCoroutineCancellation(error: Throwable): Boolean {
        return error is CoroutineCancellationException || error is JavaCancellationException
    }
}
