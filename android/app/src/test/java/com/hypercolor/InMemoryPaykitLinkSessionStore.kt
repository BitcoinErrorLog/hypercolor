package com.hypercolor

internal class InMemoryPaykitLinkSessionStore : PaykitLinkSessionCatalog {
    val bearers = linkedMapOf<String, String>()
    val pendingMarkers = linkedSetOf<String>()
    val quarantines = linkedMapOf<String, PaykitLinkQuarantineRecord>()
    var storedBootCounter: Long = 0L

    override fun putPendingSession(alias: String, bearer: String) {
        bearers[alias] = bearer
        pendingMarkers.add(alias)
    }

    override fun clearPendingMarker(alias: String) {
        pendingMarkers.remove(alias)
    }

    override fun deleteSession(alias: String) {
        bearers.remove(alias)
        pendingMarkers.remove(alias)
        quarantines.remove(alias)
    }

    override fun hasPendingMarker(alias: String): Boolean = alias in pendingMarkers

    override fun hasSessionBearer(alias: String): Boolean = bearers.containsKey(alias)

    override fun listPendingSessionAliases(): List<String> = pendingMarkers.toList()

    override fun listSessionAliases(): List<String> = bearers.keys.toList()

    override fun getBootCounter(): Long = storedBootCounter

    override fun setBootCounter(value: Long) {
        storedBootCounter = value
    }

    override fun getQuarantine(alias: String): PaykitLinkQuarantineRecord? = quarantines[alias]

    override fun putQuarantine(alias: String, record: PaykitLinkQuarantineRecord) {
        quarantines[alias] = record
    }

    override fun clearQuarantine(alias: String) {
        quarantines.remove(alias)
    }
}
