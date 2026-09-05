package com.hypercolor

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Native `probeInboundEncryptedLink` parks NoInbound and pre-GETs an FFI
 * derived slot that can miss wasm/lib msg1. The Android probe must drive
 * `acceptEncryptedLink` + `advance` like the web wasm binding.
 */
class PaykitLinkProbeParkTest {
    @Test
    fun probeInboundLink_usesAcceptAdvanceNotFfiProbePark() {
        val source = File("src/main/java/com/hypercolor/PaykitLinkModule.kt").readText()
        val probe =
            Regex(
                """fun probeInboundLink\([\s\S]*?\n    \}""",
            ).find(source)
                ?: error("probeInboundLink not found")
        val body = probe.value
        assertTrue(
            "inbound probe must accept then advance, matching wasm",
            body.contains("acceptEncryptedLink(") && body.contains("handshake.advance()"),
        )
        assertFalse(
            "must not call the FFI probe that parks NoInbound / uses a separate slot addr",
            body.contains("probeInboundEncryptedLink("),
        )
        assertTrue(
            "unchanged snapshot must be none",
            body.contains("before == after") && body.contains("\"none\""),
        )
    }
}
