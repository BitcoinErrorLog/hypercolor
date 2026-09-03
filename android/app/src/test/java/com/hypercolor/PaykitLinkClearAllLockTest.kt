package com.hypercolor

import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `clearAllNativeSecrets` must wipe the store and evict `sessions` under
 * the same `synchronized(pendingIo)` monitor the `session()` rotated-bearer
 * write-back holds. Otherwise the interleave [write-back liveness check
 * passes] → [clear commits] → [rotated put] resurrects a bearer (and its
 * in-memory session) the user just wiped.
 *
 * JVM unit tests have no React host; this mirrors the module's locking
 * discipline with the in-memory catalog and pins the source contract.
 */
class PaykitLinkClearAllLockTest {
    @Test
    fun clearAllAndWriteBackCannotResurrectInEitherCompletionOrder() {
        for (clearFirst in listOf(true, false)) {
            val pendingIo = Any()
            val store = InMemoryPaykitLinkSessionStore()
            val sessions = ConcurrentHashMap<String, String>()
            seedAdoptedBearer(store)
            val writeBack = rotatedWriteBack(pendingIo, store, sessions)
            val clearAll = fullClear(pendingIo, store, sessions)
            if (clearFirst) {
                clearAll()
                writeBack()
            } else {
                writeBack()
                clearAll()
            }
            assertNoResidue(store, sessions, "clearFirst=$clearFirst")
        }
    }

    @Test
    fun clearAllAndWriteBackRaceLeavesNoResidue() {
        repeat(200) {
            val pendingIo = Any()
            val store = InMemoryPaykitLinkSessionStore()
            val sessions = ConcurrentHashMap<String, String>()
            seedAdoptedBearer(store)
            val gate = CountDownLatch(1)
            val writer = thread(start = false) {
                gate.await()
                rotatedWriteBack(pendingIo, store, sessions)()
            }
            val clearer = thread(start = false) {
                gate.await()
                fullClear(pendingIo, store, sessions)()
            }
            writer.start()
            clearer.start()
            gate.countDown()
            writer.join()
            clearer.join()
            assertNoResidue(store, sessions, "race iteration $it")
        }
    }

    @Test
    fun clearAllNativeSecrets_sourceScopesFullClearUnderPendingIo() {
        val source = File("src/main/java/com/hypercolor/PaykitLinkModule.kt").readText()
        val body =
            Regex(
                """fun clearAllNativeSecrets\(promise: Promise\) \{([\s\S]*?)\n    \}""",
            ).find(source)
                ?: error("clearAllNativeSecrets not found")
        val clearBody = body.groupValues[1]
        val section =
            Regex(
                """synchronized\(pendingIo\) \{([\s\S]*?)\n            \}""",
            ).find(clearBody)
                ?: error("clearAllNativeSecrets must take synchronized(pendingIo)")
        val locked = section.groupValues[1]
        assertTrue(
            "sessions eviction must be inside synchronized(pendingIo)",
            locked.contains("sessions.clear()"),
        )
        assertTrue(
            "store.clearAll() must be inside synchronized(pendingIo)",
            locked.contains("store.clearAll()"),
        )
        val beforeLock = clearBody.substringBefore("synchronized(pendingIo)")
        assertFalse(
            "no unlocked sessions.clear() may remain before the locked section",
            beforeLock.contains("sessions.clear()"),
        )
        assertFalse(
            "no unlocked store.clearAll() may remain before the locked section",
            beforeLock.contains("store.clearAll()"),
        )
    }

    private fun seedAdoptedBearer(store: InMemoryPaykitLinkSessionStore) {
        store.putPendingSession("alias-1", "bearer-old")
        store.clearPendingMarker("alias-1")
    }

    /** Mirrors `session()`: liveness re-check and rotated put in one section. */
    private fun rotatedWriteBack(
        pendingIo: Any,
        store: InMemoryPaykitLinkSessionStore,
        sessions: ConcurrentHashMap<String, String>,
    ): () -> Unit = {
        synchronized(pendingIo) {
            if (store.hasSessionBearer("alias-1")) {
                store.bearers["alias-1"] = "bearer-rotated"
                sessions["alias-1"] = "bearer-rotated"
            }
        }
    }

    /** Mirrors the fixed `clearAllNativeSecrets` tail. */
    private fun fullClear(
        pendingIo: Any,
        store: InMemoryPaykitLinkSessionStore,
        sessions: ConcurrentHashMap<String, String>,
    ): () -> Unit = {
        synchronized(pendingIo) {
            sessions.clear()
            store.bearers.clear()
            store.pendingMarkers.clear()
            store.quarantines.clear()
        }
    }

    private fun assertNoResidue(
        store: InMemoryPaykitLinkSessionStore,
        sessions: ConcurrentHashMap<String, String>,
        scenario: String,
    ) {
        assertFalse("$scenario: bearer must not resurrect", store.hasSessionBearer("alias-1"))
        assertFalse(
            "$scenario: in-memory session must not outlive the wipe",
            sessions.containsKey("alias-1"),
        )
    }
}
