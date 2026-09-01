package com.hypercolor

import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class AuthFlowSlotsTest {
    @Test
    fun takeIsOneShot() {
        val slots = AuthFlowSlots<String>()
        val value = "auth-flow"
        slots.put("flow-a", value)
        assertSame(value, slots.peek("flow-a"))
        assertSame(value, slots.take("flow-a"))
        assertNull(slots.peek("flow-a"))
        assertNull(slots.take("flow-a"))
    }

    @Test
    fun startFailureCanRetainUnreadFlow() {
        val slots = AuthFlowSlots<String>()
        slots.put("flow-a", "auth-flow")
        val startFailed = true
        if (startFailed) {
            assertSame("auth-flow", slots.peek("flow-a"))
        }
        assertSame("auth-flow", slots.take("flow-a"))
    }

    @Test
    fun concurrentTakeYieldsExactlyOneWinner() {
        val slots = AuthFlowSlots<String>()
        slots.put("flow-a", "auth-flow")
        val barrier = CyclicBarrier(2)
        val done = CountDownLatch(2)
        val wins = AtomicInteger(0)
        val misses = AtomicInteger(0)
        repeat(2) {
            Thread {
                try {
                    barrier.await()
                    if (slots.take("flow-a") == null) {
                        misses.incrementAndGet()
                    } else {
                        wins.incrementAndGet()
                    }
                } finally {
                    done.countDown()
                }
            }.start()
        }
        done.await()
        assertEquals(1, wins.get())
        assertEquals(1, misses.get())
        assertNull(slots.take("flow-a"))
    }

    @Test
    fun clearDropsUnreadFlows() {
        val slots = AuthFlowSlots<String>()
        slots.put("flow-a", "auth-flow")
        slots.clear()
        assertNull(slots.peek("flow-a"))
        assertNull(slots.take("flow-a"))
    }
}
