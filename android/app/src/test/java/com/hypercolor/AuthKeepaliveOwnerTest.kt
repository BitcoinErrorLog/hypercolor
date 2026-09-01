package com.hypercolor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthKeepaliveOwnerTest {
    @Test
    fun claimOnEmptyRequiresStart() {
        val owner = AuthKeepaliveOwner()
        val claim = owner.claim("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimKind.Start, claim.kind)
        assertEquals("flow-a", owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Starting, owner.phase())
        assertEquals(1L, claim.generation)
    }

    @Test
    fun reclaimSameAttemptWhileStartingWaits() {
        val owner = AuthKeepaliveOwner()
        val first = owner.claim("flow-a")
        val second = owner.claim("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimKind.AwaitUnconfirmed, second.kind)
        assertEquals(first.generation, second.generation)
        assertEquals("flow-a", owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Starting, owner.phase())
    }

    @Test
    fun confirmThenReclaimIsAlreadyConfirmed() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        assertTrue(owner.confirmStart("flow-a", start.generation))
        val again = owner.claim("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimKind.AlreadyConfirmed, again.kind)
        assertEquals(start.generation, again.generation)
    }

    @Test
    fun supersedeDuringStartingDoesNotAdoptAsRunning() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        val adopted = owner.claim("flow-b")
        assertEquals(AuthKeepaliveOwner.ClaimKind.AwaitUnconfirmed, adopted.kind)
        assertEquals(start.generation, adopted.generation)
        assertEquals("flow-b", owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Starting, owner.phase())
    }

    @Test
    fun starterSucceedsAfterSupersedeConfirmsForNewOwner() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimKind.AwaitUnconfirmed, owner.claim("flow-b").kind)
        assertTrue(owner.confirmStart("flow-a", start.generation))
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, owner.phase())
        assertEquals("flow-b", owner.owner())
        val ready = owner.claim("flow-b")
        assertEquals(AuthKeepaliveOwner.ClaimKind.AlreadyConfirmed, ready.kind)
        assertFalse(owner.release("flow-a"))
        assertTrue(owner.release("flow-b"))
        assertNull(owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, owner.phase())
    }

    @Test
    fun starterFailureAfterSupersedeLeavesNewOwnerIdleToRetry() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        assertEquals(AuthKeepaliveOwner.ClaimKind.AwaitUnconfirmed, owner.claim("flow-b").kind)
        assertTrue(owner.failStart("flow-a", start.generation))
        assertEquals("flow-b", owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, owner.phase())
        val retry = owner.claim("flow-b")
        assertEquals(AuthKeepaliveOwner.ClaimKind.Start, retry.kind)
        assertNotEquals(start.generation, retry.generation)
    }

    @Test
    fun staleFailureDoesNotClearNewerOwnership() {
        val owner = AuthKeepaliveOwner()
        val first = owner.claim("flow-a")
        assertTrue(owner.failStart("flow-a", first.generation))
        val second = owner.claim("flow-b")
        assertEquals(AuthKeepaliveOwner.ClaimKind.Start, second.kind)
        assertFalse(owner.failStart("flow-a", first.generation))
        assertEquals("flow-b", owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Starting, owner.phase())
        assertEquals(second.generation, owner.generation())
    }

    @Test
    fun staleConfirmDoesNotConfirmNewerStart() {
        val owner = AuthKeepaliveOwner()
        val first = owner.claim("flow-a")
        assertTrue(owner.failStart("flow-a", first.generation))
        val second = owner.claim("flow-b")
        assertFalse(owner.confirmStart("flow-a", first.generation))
        assertEquals(AuthKeepaliveOwner.Phase.Starting, owner.phase())
        assertTrue(owner.confirmStart("flow-b", second.generation))
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, owner.phase())
    }

    @Test
    fun releaseBeforeConfirmDoesNotStop() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        assertFalse(owner.release("flow-a"))
        assertNull(owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Starting, owner.phase())
        assertFalse(owner.confirmStart("flow-a", start.generation))
        assertEquals(AuthKeepaliveOwner.Phase.Idle, owner.phase())
    }

    @Test
    fun releaseAfterConfirmStopsOnlyCurrentOwner() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        assertTrue(owner.confirmStart("flow-a", start.generation))
        owner.claim("flow-b")
        assertFalse(owner.release("flow-a"))
        assertEquals("flow-b", owner.owner())
        assertTrue(owner.release("flow-b"))
        assertNull(owner.owner())
        assertFalse(owner.release("flow-b"))
    }

    @Test
    fun releaseAllStopsOnlyWhenConfirmed() {
        val owner = AuthKeepaliveOwner()
        assertFalse(owner.releaseAll())
        val start = owner.claim("flow-a")
        assertFalse(owner.releaseAll())
        assertNull(owner.owner())
        assertEquals(AuthKeepaliveOwner.Phase.Idle, owner.phase())
        val retry = owner.claim("flow-b")
        assertTrue(owner.confirmStart("flow-b", retry.generation))
        assertTrue(owner.releaseAll())
        assertNull(owner.owner())
        assertFalse(owner.release("flow-b"))
        assertEquals(start.generation + 1L, retry.generation)
    }

    @Test
    fun claimAfterConfirmedReleaseStartsAgain() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        assertTrue(owner.confirmStart("flow-a", start.generation))
        assertTrue(owner.release("flow-a"))
        val again = owner.claim("flow-b")
        assertEquals(AuthKeepaliveOwner.ClaimKind.Start, again.kind)
        assertEquals(AuthKeepaliveOwner.Phase.Starting, owner.phase())
    }

    @Test
    fun adoptConfirmedDoesNotRestart() {
        val owner = AuthKeepaliveOwner()
        val start = owner.claim("flow-a")
        assertTrue(owner.confirmStart("flow-a", start.generation))
        val adopted = owner.claim("flow-b")
        assertEquals(AuthKeepaliveOwner.ClaimKind.AdoptedConfirmed, adopted.kind)
        assertEquals(start.generation, adopted.generation)
        assertEquals(AuthKeepaliveOwner.Phase.Confirmed, owner.phase())
    }
}
