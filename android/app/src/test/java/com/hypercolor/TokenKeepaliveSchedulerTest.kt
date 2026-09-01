package com.hypercolor

import org.junit.Assert.assertEquals
import org.junit.Test

class TokenKeepaliveSchedulerTest {
    @Test
    fun cancelPreventsLaterFire() {
        val poster = RecordingPoster()
        val scheduler = TokenKeepaliveScheduler(poster)
        val events = mutableListOf<String>()
        scheduler.schedule(10L, 1L) { events.add("fire") }
        scheduler.cancel(1L)
        poster.fireAll()
        assertEquals(emptyList<String>(), events)
        assertEquals(0, poster.pendingCount())
    }

    @Test
    fun rescheduleReplacesPreviousCallback() {
        val poster = RecordingPoster()
        val scheduler = TokenKeepaliveScheduler(poster)
        val events = mutableListOf<String>()
        scheduler.schedule(10L, 1L) { events.add("old") }
        scheduler.schedule(10L, 1L) { events.add("new") }
        poster.fireAll()
        assertEquals(listOf("new"), events)
    }

    @Test
    fun cancelledRunnableIsHarmlessIfPosterFiresAnyway() {
        val poster = RecordingPoster()
        val scheduler = TokenKeepaliveScheduler(poster)
        val events = mutableListOf<String>()
        scheduler.schedule(10L, 1L) { events.add("stale") }
        val leaked = poster.snapshot()
        scheduler.cancel(1L)
        scheduler.schedule(10L, 2L) { events.add("current") }
        leaked.forEach { it.run() }
        poster.fireAll()
        assertEquals(listOf("current"), events)
    }
}
