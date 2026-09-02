package com.hypercolor

internal class InMemoryPaykitLinkSessionStore : PaykitLinkSessionCatalog {
    val bearers = linkedMapOf<String, String>()
    val pendingMarkers = linkedSetOf<String>()

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
    }

    override fun hasPendingMarker(alias: String): Boolean = alias in pendingMarkers

    override fun hasSessionBearer(alias: String): Boolean = bearers.containsKey(alias)

    override fun listPendingSessionAliases(): List<String> = pendingMarkers.toList()

    override fun listSessionAliases(): List<String> = bearers.keys.toList()
}
