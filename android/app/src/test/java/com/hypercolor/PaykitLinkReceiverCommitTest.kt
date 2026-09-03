package com.hypercolor

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Receiver Noise secrets must flush with commit() (not apply()), matching
 * session material. Process death between apply() and flush would leave JS
 * holding a receiverAlias native never persisted.
 *
 * JVM unit tests have no Robolectric; this asserts the source contract that
 * [PaykitLinkStore.putReceiverSecret] routes through [PaykitLinkStore.commitEdits]
 * while the async [PaykitLinkStore.putString] path keeps apply().
 */
class PaykitLinkReceiverCommitTest {
    @Test
    fun putReceiverSecret_sourceUsesCommitEditsNotApply() {
        val source = File("src/main/java/com/hypercolor/PaykitLinkModule.kt").readText()
        val putReceiver =
            Regex(
                """fun putReceiverSecret\(alias: String, secret: String\) \{([\s\S]*?)\n    \}""",
            ).find(source)
                ?: error("putReceiverSecret not found")
        val body = putReceiver.groupValues[1]
        assertTrue(
            "putReceiverSecret must flush via commitEdits",
            body.contains("commitEdits"),
        )
        assertTrue(
            "putReceiverSecret must not use apply() fire-and-forget",
            !body.contains(".apply()"),
        )
        val putString =
            Regex(
                """fun putString\(key: String, value: String\) \{([\s\S]*?)\n    \}""",
            ).find(source)
                ?: error("putString not found")
        assertTrue(
            "putString may keep apply() for non-durable paths",
            putString.groupValues[1].contains(".apply()"),
        )
    }
}
