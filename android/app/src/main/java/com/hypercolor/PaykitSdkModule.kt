package com.hypercolor

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.synonym.paykit.EncryptedLinkHandshakeRole
import com.synonym.paykit.EncryptedLinkRecoveryMarkerPolicy
import com.synonym.paykit.EndpointManagementScope
import com.synonym.paykit.LinkedPeerHandshakeReport
import com.synonym.paykit.LinkedPeerState
import com.synonym.paykit.PaykitAndroid
import com.synonym.paykit.PaykitException
import com.synonym.paykit.PaykitSdk
import com.synonym.paykit.PaykitSdkConfig
import com.synonym.paykit.PublicContactSharingPolicy
import com.synonym.paykit.PubkySessionAccess
import com.synonym.paykit.ReceiverNoiseSecretKey
import com.synonym.paykit.SdkPubkySessionProvider
import com.synonym.paykit.SdkStateBlob
import com.synonym.paykit.SdkStateBlobSnapshot
import com.synonym.paykit.SdkStateBlobStore
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

/**
 * Native Paykit SDK bridge. The blob store and session provider run on the
 * calling thread and never round-trip the React Native bridge.
 *
 * Product code must not call initiate/accept/advance/clear. Those SDK methods
 * are not exported here.
 */
class PaykitSdkModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val job = SupervisorJob()
    private val scope = CoroutineScope(job + Dispatchers.IO)
    private val owners = ConcurrentHashMap<String, OwnerRuntime>()

    override fun getName(): String = "PaykitSdkModule"

    override fun initialize() {
        super.initialize()
        PaykitAndroid.initializeOrThrow(reactApplicationContext)
    }

    override fun invalidate() {
        for (runtime in owners.values) {
            runCatching { runtime.sdk.destroy() }
        }
        owners.clear()
        job.cancel()
        super.invalidate()
    }

    @ReactMethod
    fun bindOwner(
        ownerPubky: String,
        sessionAlias: String,
        receiverAlias: String,
        receiverPath: String,
        promise: Promise,
    ) {
        launch(promise) {
            requireText(ownerPubky)
            requireText(sessionAlias)
            requireText(receiverAlias)
            requireText(receiverPath)
            val existing = owners[ownerPubky]
            if (
                existing != null &&
                existing.session.sessionAlias == sessionAlias &&
                existing.session.receiverAlias == receiverAlias &&
                existing.receiverPath == receiverPath
            ) {
                promise.resolve(null)
                return@launch
            }
            existing?.let {
                owners.remove(ownerPubky, it)
                runCatching { it.sdk.destroy() }
            }
            val session = OwnerSessionProvider(
                PaykitLinkStore(reactApplicationContext.applicationContext),
                sessionAlias,
                receiverAlias,
            )
            val store = OwnerBlobStore(reactApplicationContext.applicationContext, ownerPubky)
            val config = PaykitSdkConfig(
                receiverPath,
                "hypercolor.app",
                EndpointManagementScope.MANAGED_ONLY,
                EncryptedLinkRecoveryMarkerPolicy.ENABLED,
                PublicContactSharingPolicy.LOCAL_ONLY,
                60uL,
                60uL,
                2uL,
            )
            val sdk = PaykitSdk(store, session, config)
            sdk.initialize()
            val runtime = OwnerRuntime(sdk, session, receiverPath)
            val raced = owners.putIfAbsent(ownerPubky, runtime)
            if (raced != null) {
                sdk.destroy()
            }
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun ensureLinkWithPeer(ownerPubky: String, peerPubky: String, receiverPath: String, promise: Promise) {
        launch(promise) {
            val sdk = requireSdk(ownerPubky)
            try {
                val report = sdk.ensureLinkWithPeer(peerPubky, receiverPath, 2u)
                promise.resolve(handshakeMap(report, leaseSkipped = false))
            } catch (error: PaykitException.Policy) {
                if (isLeaseSkip(error)) {
                    promise.resolve(leaseSkippedMap(peerPubky, receiverPath))
                } else {
                    throw error
                }
            } catch (error: PaykitException.RecoveryRequired) {
                promise.resolve(recoveryMap(peerPubky, receiverPath))
            }
        }
    }

    @ReactMethod
    fun observeEncryptedLinkRecoveryMarker(
        ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        promise: Promise,
    ) {
        launch(promise) {
            val sdk = requireSdk(ownerPubky)
            try {
                val report = sdk.observeEncryptedLinkRecoveryMarker(peerPubky, receiverPath)
                try {
                    val map = Arguments.createMap()
                    map.putString("state", stateName(report.state))
                    map.putBoolean("remoteMarkerChanged", report.remoteMarkerChanged)
                    map.putString("localAttemptId", report.localAttemptId)
                    map.putString("remoteAttemptId", report.remoteAttemptId)
                    promise.resolve(map)
                } finally {
                    report.destroy()
                }
            } catch (error: PaykitException.RecoveryRequired) {
                val map = Arguments.createMap()
                map.putString("state", "RECOVERY_REQUIRED")
                map.putBoolean("remoteMarkerChanged", false)
                promise.resolve(map)
            }
        }
    }

    @ReactMethod
    fun enqueueOpaquePrivateApplicationMessageJson(
        ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        rawJson: String,
        promise: Promise,
    ) {
        launch(promise) {
            val sdk = requireSdk(ownerPubky)
            val id = sdk.enqueueOpaquePrivateApplicationMessageJson(peerPubky, receiverPath, rawJson)
            val map = Arguments.createMap()
            map.putString("queueId", id.toString())
            promise.resolve(map)
        }
    }

    @ReactMethod
    fun processOutboundPrivateMessages(
        ownerPubky: String,
        peerPubky: String,
        receiverPath: String,
        promise: Promise,
    ) {
        launch(promise) {
            val sdk = requireSdk(ownerPubky)
            val report = sdk.processOutboundPrivateMessages(peerPubky, receiverPath)
            try {
                val sent = Arguments.createArray()
                for (id in report.sent) sent.pushString(id.toString())
                val failed = Arguments.createArray()
                for (failure in report.failed) {
                    val item = Arguments.createMap()
                    item.putString("queueId", failure.outboundMessageId.toString())
                    val category = failure.error.category()
                    item.putString("category", category)
                    failure.error.destroy()
                    failed.pushMap(item)
                }
                val map = Arguments.createMap()
                map.putArray("sent", sent)
                map.putArray("failed", failed)
                promise.resolve(map)
            } finally {
                report.destroy()
            }
        }
    }

    @ReactMethod
    fun receivePrivateMessages(ownerPubky: String, peerPubky: String, receiverPath: String, promise: Promise) {
        launch(promise) {
            val sdk = requireSdk(ownerPubky)
            val report = sdk.receivePrivateMessages(peerPubky, receiverPath)
            val ids = Arguments.createArray()
            for (id in report.streamItemIds) ids.pushString(id.toString())
            val map = Arguments.createMap()
            map.putString("receiveBatchId", report.receiveBatchId.toString())
            map.putArray("streamItemIds", ids)
            promise.resolve(map)
        }
    }

    @ReactMethod
    fun privateStreamItems(ownerPubky: String, rawIds: ReadableArray, promise: Promise) {
        launch(promise) {
            val sdk = requireSdk(ownerPubky)
            val ids = ArrayList<ULong>(rawIds.size())
            for (index in 0 until rawIds.size()) {
                val text = when (rawIds.getType(index)) {
                    com.facebook.react.bridge.ReadableType.String -> rawIds.getString(index)
                    com.facebook.react.bridge.ReadableType.Number -> rawIds.getDouble(index).toLong().toString()
                    else -> throw PaykitException.Protocol("validation", "stream item id")
                } ?: throw PaykitException.Protocol("validation", "stream item id")
                ids.add(text.toULong())
            }
            val items = sdk.privateStreamItems(ids)
            val out = Arguments.createArray()
            for (item in items) {
                val map = Arguments.createMap()
                map.putString("streamItemId", item.streamItemId.toString())
                map.putString("counterparty", item.counterparty)
                map.putString("path", item.counterpartyReceiverPath)
                map.putString("kind", item.kind)
                map.putString("rawJson", item.rawJson)
                map.putString("eventId", item.eventId)
                out.pushMap(map)
            }
            promise.resolve(out)
        }
    }

    @ReactMethod
    fun deleteOwnerState(ownerPubky: String, promise: Promise) {
        launch(promise) {
            val runtime = owners.remove(ownerPubky)
            runtime?.let { runCatching { it.sdk.destroy() } }
            SdkBlobDatabase.deleteOwner(reactApplicationContext.applicationContext, ownerPubky)
            promise.resolve(null)
        }
    }

    private fun requireSdk(ownerPubky: String): PaykitSdk {
        return owners[ownerPubky]?.sdk
            ?: throw PaykitException.Identity("not_bound", "sdk owner is not bound")
    }

    private fun launch(promise: Promise, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (error: Throwable) {
                if (error is CancellationException) {
                    promise.reject("unavailable", "unavailable")
                    throw error
                }
                val mapped = mapSdkError(error)
                Log.e(
                    TAG,
                    "sdk error type=${error.javaClass.simpleName} mapped=${mapped.first} msg=${safeSdkMessage(error)}",
                )
                promise.reject(mapped.first, mapped.second)
            }
        }
    }
}

private class OwnerRuntime(
    val sdk: PaykitSdk,
    val session: OwnerSessionProvider,
    val receiverPath: String,
)

private class OwnerSessionProvider(
    private val store: PaykitLinkStore,
    @Volatile var sessionAlias: String,
    @Volatile var receiverAlias: String,
) : SdkPubkySessionProvider {
    override fun loadSessionAccess(): PubkySessionAccess? {
        val session = store.getString(PaykitLinkStore.sessionKey(sessionAlias))
        val hex = store.getString(PaykitLinkStore.receiverKey(receiverAlias))
        if (session == null && hex == null) return null
        if (session == null || hex == null) {
            throw PaykitException.Identity("session_incomplete", "session unavailable")
        }
        val bytes = decodeHex(hex) ?: throw PaykitException.Identity("receiver_secret", "receiver secret invalid")
        return PubkySessionAccess(session, null, ReceiverNoiseSecretKey(bytes))
    }

    override fun publicStorageAvailable(): Boolean = true

    /** Does not delete the chat session bearer. SDK sign-out must not wipe it. */
    override fun clearSessionAccess() = Unit
}

private class OwnerBlobStore(
    private val context: Context,
    private val ownerPubky: String,
) : SdkStateBlobStore {
    override fun loadStateBlob(): SdkStateBlobSnapshot? {
        val row = SdkBlobDatabase.load(context, ownerPubky) ?: return null
        return SdkStateBlobSnapshot(SdkStateBlob(row.blob), row.revision)
    }

    override fun saveStateBlobAtomically(blob: SdkStateBlob, expectedRevision: String?): String {
        return SdkBlobDatabase.save(context, ownerPubky, blob.exportBytes(), expectedRevision)
    }
}

private data class SdkBlobRow(val blob: ByteArray, val revision: String)

private object SdkBlobDatabase {
    private val lock = Any()
    private var opened: SQLiteDatabase? = null

    fun load(context: Context, ownerPubky: String): SdkBlobRow? {
        synchronized(lock) {
            database(context).rawQuery(
                "SELECT blob, revision FROM paykit_sdk_state WHERE owner_pubky = ?",
                arrayOf(ownerPubky),
            ).use { cursor ->
                if (!cursor.moveToFirst()) return null
                return SdkBlobRow(cursor.getBlob(0), cursor.getString(1))
            }
        }
    }

    fun save(context: Context, ownerPubky: String, bytes: ByteArray, expectedRevision: String?): String {
        synchronized(lock) {
            val db = database(context)
            db.beginTransaction()
            try {
                val current = currentRevision(db, ownerPubky)
                if (current == null) {
                    if (expectedRevision != null) {
                        throw PaykitException.Storage("revision_conflict", "revision mismatch")
                    }
                } else if (expectedRevision != current) {
                    throw PaykitException.Storage("revision_conflict", "revision mismatch")
                }
                val revision = UUID.randomUUID().toString()
                val values = ContentValues()
                values.put("owner_pubky", ownerPubky)
                values.put("blob", bytes)
                values.put("revision", revision)
                values.put("updated_at", System.currentTimeMillis())
                if (current == null) {
                    if (db.insert("paykit_sdk_state", null, values) == -1L) {
                        throw PaykitException.Storage("write_failed", "state write failed")
                    }
                } else {
                    val updated = db.update(
                        "paykit_sdk_state",
                        values,
                        "owner_pubky = ? AND revision = ?",
                        arrayOf(ownerPubky, current),
                    )
                    if (updated != 1) {
                        throw PaykitException.Storage("revision_conflict", "revision mismatch")
                    }
                }
                db.setTransactionSuccessful()
                return revision
            } finally {
                db.endTransaction()
            }
        }
    }

    fun deleteOwner(context: Context, ownerPubky: String) {
        synchronized(lock) {
            database(context).delete("paykit_sdk_state", "owner_pubky = ?", arrayOf(ownerPubky))
        }
    }

    private fun currentRevision(db: SQLiteDatabase, ownerPubky: String): String? {
        db.rawQuery(
            "SELECT revision FROM paykit_sdk_state WHERE owner_pubky = ?",
            arrayOf(ownerPubky),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return cursor.getString(0)
        }
    }

    private fun database(context: Context): SQLiteDatabase {
        try {
            opened?.let { if (it.isOpen) return it }
            val parent = context.getDatabasePath("defaultDatabase").parentFile
                ?: throw PaykitException.Storage("storage", "database directory missing")
            if (!parent.exists() && !parent.mkdirs()) {
                throw PaykitException.Storage("storage", "database directory missing")
            }
            val file = File(parent, "hypercolor.db")
            val db = SQLiteDatabase.openOrCreateDatabase(file, null)
            // journal_mode and busy_timeout return a row. execSQL rejects that
            // with SQLITE_OK "query or rawQuery methods only" and the SDK
            // surfaces it as a storage failure on the first link call.
            if (!db.enableWriteAheadLogging()) {
                db.rawQuery("PRAGMA journal_mode=WAL", null).use { cursor -> cursor.moveToFirst() }
            }
            db.rawQuery("PRAGMA busy_timeout=5000", null).use { cursor -> cursor.moveToFirst() }
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS paykit_sdk_state (
                  owner_pubky TEXT PRIMARY KEY,
                  blob BLOB NOT NULL,
                  revision TEXT NOT NULL,
                  updated_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            opened = db
            return db
        } catch (error: PaykitException) {
            throw error
        } catch (error: Exception) {
            throw PaykitException.Storage("storage", storageMessage(error))
        }
    }

    private fun storageMessage(error: Exception): String {
        val raw = error.message ?: error.javaClass.simpleName
        return raw.replace(Regex("[0-9a-fA-F]{16,}"), "[HEX]").take(160)
    }
}

private fun handshakeMap(report: LinkedPeerHandshakeReport, leaseSkipped: Boolean): WritableMap {
    val map = Arguments.createMap()
    map.putString("counterparty", report.counterparty)
    map.putString("path", report.counterpartyReceiverPath)
    map.putString("state", stateName(report.state))
    map.putString("generation", report.generation.toString())
    map.putString("role", roleName(report.handshakeRole))
    map.putBoolean("leaseSkipped", leaseSkipped)
    return map
}

private fun leaseSkippedMap(peerPubky: String, receiverPath: String): WritableMap {
    val map = Arguments.createMap()
    map.putString("counterparty", peerPubky)
    map.putString("path", receiverPath)
    map.putBoolean("leaseSkipped", true)
    return map
}

private fun recoveryMap(peerPubky: String, receiverPath: String): WritableMap {
    val map = Arguments.createMap()
    map.putString("counterparty", peerPubky)
    map.putString("path", receiverPath)
    map.putString("state", "RECOVERY_REQUIRED")
    map.putString("generation", "0")
    map.putString("role", "UNKNOWN")
    map.putBoolean("leaseSkipped", false)
    return map
}

private fun stateName(state: LinkedPeerState): String = when (state) {
    LinkedPeerState.NOT_LINKED -> "NOT_LINKED"
    LinkedPeerState.LINKING -> "LINKING"
    LinkedPeerState.LINKED -> "LINKED"
    LinkedPeerState.RECOVERY_REQUIRED -> "RECOVERY_REQUIRED"
    LinkedPeerState.BLOCKED -> "BLOCKED"
    LinkedPeerState.UNKNOWN -> "UNKNOWN"
}

private fun roleName(role: EncryptedLinkHandshakeRole?): String = when (role) {
    EncryptedLinkHandshakeRole.INITIATOR -> "INITIATOR"
    EncryptedLinkHandshakeRole.RESPONDER -> "RESPONDER"
    EncryptedLinkHandshakeRole.UNKNOWN, null -> "UNKNOWN"
}

private fun isLeaseSkip(error: PaykitException.Policy): Boolean {
    val context = error.context
    return context.contains("already in progress")
}

private fun mapSdkError(error: Throwable): Pair<String, String> = when (error) {
    is PaykitException.Transport, is PaykitException.NotFound -> "network" to "network error"
    is PaykitException.Identity -> "auth" to "authentication failed"
    is PaykitException.RecoveryRequired -> "recovery_required" to "recovery required"
    is PaykitException.Protocol -> "protocol" to "protocol error"
    else -> "protocol" to "protocol error: ${safeSdkMessage(error)}"
}

/** Redact pubkys, hex, and bearer-shaped strings before a log or JS error. */
private fun safeSdkMessage(error: Throwable): String {
    val cause = error.cause
    val raw = buildString {
        append(error.message ?: "")
        if (cause != null) {
            append(" cause=")
            append(cause.javaClass.simpleName)
            append(":")
            append(cause.message ?: "")
        }
    }
    return raw
        .replace(Regex("pubky[a-z0-9]{20,}"), "pubky[PUBKY]")
        .replace(Regex("[A-Za-z0-9._~-]{8,}:[A-Za-z0-9+/=._~-]{8,}"), "[SESSION]")
        .replace(Regex("[0-9a-fA-F]{16,}"), "[HEX]")
        .take(240)
}

private fun requireText(value: String) {
    if (value.isBlank()) throw PaykitException.Protocol("validation", "validation failed")
}

private fun decodeHex(hex: String): ByteArray? {
    val clean = hex.trim()
    if (clean.isEmpty() || clean.length % 2 != 0) return null
    val out = ByteArray(clean.length / 2)
    for (index in out.indices) {
        val byte = clean.substring(index * 2, index * 2 + 2).toIntOrNull(16) ?: return null
        out[index] = byte.toByte()
    }
    return out
}

private const val TAG = "PaykitSdk"
