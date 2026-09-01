package com.hypercolor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthKeepaliveOwnerTest {
    @Test
    fun claimOnEmptyRequiresStart() {
        val owner = AuthKeepaliveOwner()
        assertEquals(AuthKeepaliveOwner.ClaimResult.Start, owner.claim("flow-a"))
        assertEquals("flow-a", owner.owner())
    }

    @Test
    fun reclaimSameAttemptIsAlreadyRunning() {
        val owner = AuthKeepaliveOwner()
        owner.claim("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimResult.AlreadyRunning, owner.claim("flow-a"))
        assertEquals("flow-a", owner.owner())
    }

    @Test
    fun supersedingAttemptAdoptsWithoutStop() {
        val owner = AuthKeepaliveOwner()
        owner.claim("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimResult.Adopted, owner.claim("flow-b"))
        assertFalse(owner.release("flow-a"))
        assertEquals("flow-b", owner.owner())
        assertTrue(owner.release("flow-b"))
        assertNull(owner.owner())
    }

    @Test
    fun releaseIsIdempotentForTheOwner() {
        val owner = AuthKeepaliveOwner()
        owner.claim("flow-a")
        assertTrue(owner.release("flow-a"))
        assertFalse(owner.release("flow-a"))
        assertNull(owner.owner())
    }

    @Test
    fun staleReleaseDoesNotStopNewerAttempt() {
        val owner = AuthKeepaliveOwner()
        owner.claim("flow-old")
        owner.claim("flow-new")
        assertFalse(owner.release("flow-old"))
        assertEquals("flow-new", owner.owner())
    }

    @Test
    fun releaseAllStopsWhoeverOwns() {
        val owner = AuthKeepaliveOwner()
        assertFalse(owner.releaseAll())
        owner.claim("flow-a")
        assertTrue(owner.releaseAll())
        assertNull(owner.owner())
        assertFalse(owner.release("flow-a"))
    }

    @Test
    fun claimAfterReleaseStartsAgain() {
        val owner = AuthKeepaliveOwner()
        owner.claim("flow-a")
        owner.release("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimResult.Start, owner.claim("flow-b"))
    }
}
