package com.hypercolor

/**
 * Race-safe ownership and start-lifecycle for the Ring-auth foreground
 * keepalive.
 *
 * Lifecycle is [Phase.Idle] → [Phase.Starting] → [Phase.Confirmed]. A
 * superseding claim must not treat an unconfirmed start as a running
 * service. A stale [failStart] / [release] must not clear a newer owner.
 *
 * [generation] increments on every new [ClaimKind.Start] so a late
 * confirm/fail from a previous start cannot mutate the current attempt.
 */
internal class AuthKeepaliveOwner {
    private val lock = Any()
    private var ownerId: String? = null
    private var phase: Phase = Phase.Idle
    private var generation: Long = 0L

    enum class Phase { Idle, Starting, Confirmed }

    enum class ClaimKind {
        /** Caller must start the service, then [confirmStart] or [failStart]. */
        Start,

        /** This attempt already owns a confirmed service. */
        AlreadyConfirmed,

        /** Ownership moved onto a service that is already confirmed. */
        AdoptedConfirmed,

        /**
         * A start is in flight (this attempt or another). The owner
         * surface exposes this so tests can drive confirm/fail; the
         * production coordinator is serialized and fail-closes if it
         * ever observes this kind instead of treating the service as
         * running.
         */
        AwaitUnconfirmed,
    }

    data class ClaimResult(
        val kind: ClaimKind,
        val generation: Long,
    )

    fun claim(attemptId: String): ClaimResult {
        synchronized(lock) {
            if (ownerId == attemptId) {
                return when (phase) {
                    Phase.Confirmed -> ClaimResult(ClaimKind.AlreadyConfirmed, generation)
                    Phase.Starting -> ClaimResult(ClaimKind.AwaitUnconfirmed, generation)
                    Phase.Idle -> beginStart(attemptId)
                }
            }
            return when (phase) {
                Phase.Confirmed -> {
                    ownerId = attemptId
                    ClaimResult(ClaimKind.AdoptedConfirmed, generation)
                }
                Phase.Starting -> {
                    ownerId = attemptId
                    ClaimResult(ClaimKind.AwaitUnconfirmed, generation)
                }
                Phase.Idle -> beginStart(attemptId)
            }
        }
    }

    /**
     * Marks the in-flight start confirmed. Returns true when this generation
     * is still the current start. If ownership was cleared while starting,
     * returns false so the starter stops the orphaned service.
     */
    fun confirmStart(attemptId: String, startGeneration: Long): Boolean {
        synchronized(lock) {
            if (startGeneration != generation || phase != Phase.Starting) return false
            if (ownerId == null) {
                phase = Phase.Idle
                return false
            }
            phase = Phase.Confirmed
            return true
        }
    }

    /**
     * Records that [startGeneration] failed. Clears ownership only when this
     * attempt still owns. A newer owner is left in [Phase.Idle] so it can
     * [claim] [ClaimKind.Start].
     */
    fun failStart(attemptId: String, startGeneration: Long): Boolean {
        synchronized(lock) {
            if (startGeneration != generation || phase != Phase.Starting) return false
            phase = Phase.Idle
            if (ownerId == attemptId) {
                ownerId = null
            }
            return true
        }
    }

    /** Returns true iff the caller should stop the confirmed service. */
    fun release(attemptId: String): Boolean {
        synchronized(lock) {
            if (ownerId != attemptId) return false
            val shouldStop = phase == Phase.Confirmed
            ownerId = null
            if (phase == Phase.Confirmed) {
                phase = Phase.Idle
            }
            return shouldStop
        }
    }

    /** Returns true iff a confirmed service should stop. */
    fun releaseAll(): Boolean {
        synchronized(lock) {
            val shouldStop = phase == Phase.Confirmed
            ownerId = null
            phase = Phase.Idle
            return shouldStop
        }
    }

    fun owner(): String? = synchronized(lock) { ownerId }

    fun phase(): Phase = synchronized(lock) { phase }

    fun generation(): Long = synchronized(lock) { generation }

    private fun beginStart(attemptId: String): ClaimResult {
        ownerId = attemptId
        phase = Phase.Starting
        generation += 1L
        return ClaimResult(ClaimKind.Start, generation)
    }
}
