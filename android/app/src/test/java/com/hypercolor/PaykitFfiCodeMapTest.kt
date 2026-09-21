package com.hypercolor

import org.junit.Assert.assertEquals
import org.junit.Test

class PaykitFfiCodeMapTest {
    @Test
    fun inFlightAndParkedConflictMapToUnavailable() {
        assertEquals("unavailable", mapPaykitFfiCode("in_flight"))
        assertEquals("unavailable", mapPaykitFfiCode("parked_result_conflict"))
    }

    @Test
    fun keepsExistingCoarseMappings() {
        assertEquals("network", mapPaykitFfiCode("transport_error"))
        assertEquals("auth", mapPaykitFfiCode("signin_failed"))
        assertEquals("consumed", mapPaykitFfiCode("consumed"))
        assertEquals("validation", mapPaykitFfiCode("validation"))
        assertEquals("protocol", mapPaykitFfiCode("unknown_ffi"))
    }
}
