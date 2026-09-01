package com.hypercolor

/**
 * Race-safe ownership for the Ring-auth foreground keepalive.
 *
 * A stale attempt must not stop a newer attempt's service. [claim] and
 * [release] are keyed by the Paykit auth `flowId` (the attempt token).
 */
internal class AuthKeepaliveOwner {
    private val lock = Any()
    private var ownerId: String? = null

    enum class ClaimResult {
        /** No owner; caller must start the foreground service. */
        Start,

        /** This attempt already owns the keepalive; do not start again. */
        AlreadyRunning,

        /**
         * Ownership moved from another attempt. The service should already
         * be running; do not call `startForegroundService` (the app may
         * already be backgrounded).
         */
        Adopted,
    }

    fun claim(attemptId: String): ClaimResult {
        synchronized(lock) {
            val previous = ownerId
            ownerId = attemptId
            return when (previous) {
                attemptId -> ClaimResult.AlreadyRunning
                null -> ClaimResult.Start
                else -> ClaimResult.Adopted
            }
        }
    }

    /** Returns true iff the caller should stop the service. */
    fun release(attemptId: String): Boolean {
        synchronized(lock) {
            if (ownerId != attemptId) return false
            ownerId = null
            return true
        }
    }

    /** Returns true iff a service was owned and should stop. */
    fun releaseAll(): Boolean {
        synchronized(lock) {
            val hadOwner = ownerId != null
            ownerId = null
            return hadOwner
        }
    }

    fun owner(): String? = synchronized(lock) { ownerId }
}
