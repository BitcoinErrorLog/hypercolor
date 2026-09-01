package com.hypercolor

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.synonym.paykit.ChatAuthFlow
import com.synonym.paykit.ChatClient
import com.synonym.paykit.ChatLink
import com.synonym.paykit.ChatLinkHandshake
import com.synonym.paykit.ChatProbeResult
import com.synonym.paykit.ChatReceiverCapabilities
import com.synonym.paykit.ChatSession
import com.synonym.paykit.AttachmentCiphertext
import com.synonym.paykit.PaykitAndroid
import com.synonym.paykit.PaykitException
import com.synonym.paykit.attachmentDecrypt as paykitAttachmentDecrypt
import com.synonym.paykit.attachmentEncrypt as paykitAttachmentEncrypt
import com.synonym.paykit.generateAttachmentKey as paykitGenerateAttachmentKey
import com.synonym.paykit.generateReceiverNoiseSecretKeyHex
import com.synonym.paykit.receiverNoisePublicKeyFromSecretHex
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

class PaykitLinkModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val job = SupervisorJob()
    private val scope = CoroutineScope(job + Dispatchers.IO)
    private val store = PaykitLinkStore(reactContext.applicationContext)
    private val clientMutex = Mutex()
    private var client: ChatClient? = null
    private val sessions = ConcurrentHashMap<String, ChatSession>()
    private val flows = AuthFlowSlots<ChatAuthFlow>()
    private val handles = ConcurrentHashMap<String, LinkHandle>()
    private val keepalive = AuthKeepaliveCoordinator(
        ops = object : AuthKeepaliveOps {
            override fun start() {
                PaykitAuthKeepaliveService.start(reactApplicationContext.applicationContext)
            }

            override fun stop() {
                PaykitAuthKeepaliveService.stop(reactApplicationContext.applicationContext)
            }
        },
        handler = MainKeepaliveHandler(),
        scheduler = HandlerKeepaliveScheduler(),
    )

    override fun getName(): String = "PaykitLinkModule"

    override fun initialize() {
        super.initialize()
        PaykitAndroid.initializeOrThrow(reactApplicationContext)
        keepalive.attach()
    }

    override fun invalidate() {
        try {
            keepalive.releaseAll()
        } catch (error: Throwable) {
            Log.e(PAYKIT_LINK_LOG_TAG, "auth keepalive release failed type=${error.javaClass.name}")
        }
        keepalive.detach()
        job.cancel()
        super.invalidate()
    }

    @ReactMethod
    fun generateReceiverKey(promise: Promise) {
        launch(promise) {
            val secret = generateReceiverNoiseSecretKeyHex()
            val publicKey = receiverNoisePublicKeyFromSecretHex(secret)
            val alias = UUID.randomUUID().toString()
            store.putString(PaykitLinkStore.receiverKey(alias), secret)
            resolveMap(promise) {
                putString("receiverAlias", alias)
                putString("noisePublicKey", publicKey)
            }
        }
    }

    @ReactMethod
    fun getReceiverPublicKey(receiverAlias: String, promise: Promise) {
        launch(promise) {
            promise.resolve(receiverNoisePublicKeyFromSecretHex(receiverSecret(receiverAlias)))
        }
    }

    @ReactMethod
    fun startAuthFlow(capabilities: String, relayUrl: String?, promise: Promise) {
        launch(promise) {
            val flow = chatClient().startAuthFlow(
                canonicalizeCapabilities(requireText(capabilities, "capabilities")),
                optionalText(relayUrl),
            )
            val flowId = UUID.randomUUID().toString()
            flows.put(flowId, flow)
            try {
                startAuthKeepalive(flowId)
            } catch (error: Throwable) {
                flows.take(flowId)
                throw if (error is PaykitLinkBridgeError) error else mapError(error)
            }
            resolveMap(promise) {
                putString("flowId", flowId)
                putString("authorizationUrl", flow.authorizationUrl())
            }
        }
    }

    @ReactMethod
    fun awaitAuthApproval(flowId: String, promise: Promise) {
        launch(promise) {
            val id = requireText(flowId, "flowId")
            if (flows.peek(id) == null) {
                throw PaykitLinkBridgeError("validation", "unknown auth flow")
            }
            startAuthKeepalive(id)
            val flow = flows.take(id)
                ?: throw PaykitLinkBridgeError("validation", "unknown auth flow")
            try {
                persistSession(flow.awaitApproval(), promise)
            } finally {
                releaseAuthKeepalive(id)
            }
        }
    }

    @ReactMethod
    fun stopAuthKeepalive(flowId: String, promise: Promise) {
        launch(promise) {
            releaseAuthKeepalive(requireText(flowId, "flowId"))
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun signinWithSecret(identitySecretHex: String, promise: Promise) {
        if (!BuildConfig.DEBUG) {
            promise.reject("unavailable", "secret import is disabled in release builds")
            return
        }
        launch(promise) {
            persistSession(
                chatClient().signinWithSecret(requireText(identitySecretHex, "identitySecretHex")),
                promise,
            )
        }
    }

    @ReactMethod
    fun signupWithSecret(
        identitySecretHex: String,
        homeserverPublicKey: String,
        signupToken: String?,
        promise: Promise,
    ) {
        if (!BuildConfig.DEBUG) {
            promise.reject("unavailable", "secret import is disabled in release builds")
            return
        }
        launch(promise) {
            persistSession(
                chatClient().signupWithSecret(
                    requireText(identitySecretHex, "identitySecretHex"),
                    requireText(homeserverPublicKey, "homeserverPublicKey"),
                    optionalText(signupToken),
                ),
                promise,
            )
        }
    }

    @ReactMethod
    fun restoreSession(sessionAlias: String, promise: Promise) {
        launch(promise) {
            val session = session(requireText(sessionAlias, "sessionAlias"))
            resolveMap(promise) { putString("pubky", session.pubky()) }
        }
    }

    @ReactMethod
    fun signOutSession(sessionAlias: String, promise: Promise) {
        launch(promise) {
            val alias = requireText(sessionAlias, "sessionAlias")
            sessions.remove(alias)
            store.delete(PaykitLinkStore.sessionKey(alias))
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun clearAllNativeSecrets(promise: Promise) {
        launch(promise) {
            sessions.clear()
            flows.clear()
            handles.clear()
            keepalive.releaseAll()
            clientMutex.withLock { client = null }
            store.clearAll()
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun publishReceiverMarker(
        sessionAlias: String,
        receiverAlias: String,
        receiverPath: String,
        promise: Promise,
    ) {
        launch(promise) {
            val session = session(requireText(sessionAlias, "sessionAlias"))
            val publicKey = receiverNoisePublicKeyFromSecretHex(receiverSecret(receiverAlias))
            session.publishReceiverMarker(
                requireText(receiverPath, "receiverPath"),
                publicKey,
                ChatReceiverCapabilities(
                    privatePayments = true,
                    paymentRequests = false,
                    receipts = false,
                    outgoingPayments = false,
                ),
            )
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun getReceiverMarker(peerPubky: String, receiverPath: String, promise: Promise) {
        launch(promise) {
            try {
                val marker = chatClient().getReceiverMarker(
                    requireText(peerPubky, "peerPubky"),
                    requireText(receiverPath, "receiverPath"),
                )
                if (marker == null) {
                    promise.resolve(null)
                    return@launch
                }
                resolveMap(promise) {
                    putString("noisePublicKey", marker.noisePublicKey)
                    putString("capabilitiesJson", capabilitiesJson(marker.capabilities))
                }
            } catch (error: PaykitException) {
                if (ffiCode(error) == "not_found") {
                    promise.resolve(null)
                } else {
                    throw error
                }
            }
        }
    }

    @ReactMethod
    fun removeReceiverMarker(sessionAlias: String, receiverPath: String, promise: Promise) {
        launch(promise) {
            session(requireText(sessionAlias, "sessionAlias"))
                .removeReceiverMarker(requireText(receiverPath, "receiverPath"))
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun putPublic(
        sessionAlias: String,
        url: String,
        content: String,
        homeserverOrigin: String,
        promise: Promise,
    ) {
        launch(promise) {
            writePublic(
                session(requireText(sessionAlias, "sessionAlias")),
                requireText(url, "url"),
                content,
                requireText(homeserverOrigin, "homeserverOrigin"),
                "PUT",
            )
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun deletePublic(
        sessionAlias: String,
        url: String,
        homeserverOrigin: String,
        promise: Promise,
    ) {
        launch(promise) {
            writePublic(
                session(requireText(sessionAlias, "sessionAlias")),
                requireText(url, "url"),
                null,
                requireText(homeserverOrigin, "homeserverOrigin"),
                "DELETE",
            )
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun initiateLink(
        sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        promise: Promise,
    ) {
        launch(promise) {
            val args = linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath,
            )
            val handshake = args.session.initiateEncryptedLink(
                args.receiverSecret,
                args.peerPubky,
                args.peerNoisePublicKey,
                args.localReceiverPath,
                args.remoteReceiverPath,
            )
            val context = SnapshotContext(
                ownerPubky = args.session.pubky(),
                peerPubky = args.peerPubky,
                localReceiverPath = args.localReceiverPath,
                remoteReceiverPath = args.remoteReceiverPath,
                role = SnapshotRole.INITIATOR,
            )
            val linkId = UUID.randomUUID().toString()
            handles[linkId] = LinkHandle(LinkKind.Handshake(handshake), context)
            resolveMap(promise) {
                putString("linkId", linkId)
                putString("snapshot", store.encryptSnapshot(handshake.snapshot(), context))
            }
        }
    }

    @ReactMethod
    fun probeInboundLink(
        sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        promise: Promise,
    ) {
        launch(promise) {
            val args = linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath,
            )
            when (
                val probed = args.session.probeInboundEncryptedLink(
                    args.receiverSecret,
                    args.peerPubky,
                    args.peerNoisePublicKey,
                    args.localReceiverPath,
                    args.remoteReceiverPath,
                )
            ) {
                is ChatProbeResult.NoInbound -> {
                    resolveMap(promise) { putString("result", "none") }
                }
                is ChatProbeResult.Pending -> {
                    val context = SnapshotContext(
                        ownerPubky = args.session.pubky(),
                        peerPubky = args.peerPubky,
                        localReceiverPath = args.localReceiverPath,
                        remoteReceiverPath = args.remoteReceiverPath,
                        role = SnapshotRole.RESPONDER,
                    )
                    val linkId = UUID.randomUUID().toString()
                    handles[linkId] = LinkHandle(LinkKind.Handshake(probed.handshake), context)
                    resolveMap(promise) {
                        putString("result", "pending")
                        putString("linkId", linkId)
                        putString("snapshot", store.encryptSnapshot(probed.handshake.snapshot(), context))
                    }
                }
                is ChatProbeResult.Established -> {
                    val context = SnapshotContext(
                        ownerPubky = args.session.pubky(),
                        peerPubky = args.peerPubky,
                        localReceiverPath = args.localReceiverPath,
                        remoteReceiverPath = args.remoteReceiverPath,
                        role = SnapshotRole.LINK,
                    )
                    val linkId = UUID.randomUUID().toString()
                    handles[linkId] = LinkHandle(LinkKind.Established(probed.link), context)
                    resolveMap(promise) {
                        putString("result", "established")
                        putString("linkId", linkId)
                        putString("snapshot", store.encryptSnapshot(probed.link.snapshot(), context))
                    }
                }
            }
        }
    }

    @ReactMethod
    fun advanceHandshake(linkId: String, promise: Promise) {
        launch(promise) {
            val id = requireText(linkId, "linkId")
            val handle = handle(id)
            val handshake = (handle.kind as? LinkKind.Handshake)?.handshake
                ?: throw PaykitLinkBridgeError("validation", "linkId is not a handshake")
            val step = handshake.advance()
            val link = step.link
            if (step.complete && link != null) {
                val context = handle.context.copy(role = SnapshotRole.LINK)
                handles[id] = LinkHandle(LinkKind.Established(link), context)
                resolveMap(promise) {
                    putString("status", "established")
                    putString("snapshot", store.encryptSnapshot(link.snapshot(), context))
                }
            } else {
                resolveMap(promise) {
                    putString("status", "pending")
                    putString("snapshot", store.encryptSnapshot(handshake.snapshot(), handle.context))
                }
            }
        }
    }

    @ReactMethod
    fun restoreHandshake(
        sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        snapshot: String,
        promise: Promise,
    ) {
        launch(promise) {
            val args = linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath,
            )
            val restored = store.decryptHandshakeSnapshot(
                requireText(snapshot, "snapshot"),
                args.session.pubky(),
                args.peerPubky,
                args.localReceiverPath,
                args.remoteReceiverPath,
            )
            val handshake = args.session.restoreEncryptedLinkHandshake(
                args.receiverSecret,
                args.peerPubky,
                args.localReceiverPath,
                args.remoteReceiverPath,
                restored.plaintext,
            )
            val context = SnapshotContext(
                ownerPubky = args.session.pubky(),
                peerPubky = args.peerPubky,
                localReceiverPath = args.localReceiverPath,
                remoteReceiverPath = args.remoteReceiverPath,
                role = restored.role,
            )
            val linkId = UUID.randomUUID().toString()
            handles[linkId] = LinkHandle(LinkKind.Handshake(handshake), context)
            resolveMap(promise) {
                putString("linkId", linkId)
                putString("status", "pending")
            }
        }
    }

    @ReactMethod
    fun restoreLink(
        sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        snapshot: String,
        promise: Promise,
    ) {
        launch(promise) {
            val args = linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath,
            )
            val context = SnapshotContext(
                ownerPubky = args.session.pubky(),
                peerPubky = args.peerPubky,
                localReceiverPath = args.localReceiverPath,
                remoteReceiverPath = args.remoteReceiverPath,
                role = SnapshotRole.LINK,
            )
            val plaintext = store.decryptSnapshot(requireText(snapshot, "snapshot"), context)
            val link = args.session.restoreEncryptedLink(
                args.receiverSecret,
                args.peerPubky,
                args.localReceiverPath,
                args.remoteReceiverPath,
                plaintext,
            )
            val linkId = UUID.randomUUID().toString()
            handles[linkId] = LinkHandle(LinkKind.Established(link), context)
            resolveMap(promise) { putString("linkId", linkId) }
        }
    }

    @ReactMethod
    fun sendPrivateMessageJson(linkId: String, rawJson: String, promise: Promise) {
        launch(promise) {
            val handle = handle(requireText(linkId, "linkId"))
            val link = (handle.kind as? LinkKind.Established)?.link
                ?: throw PaykitLinkBridgeError("validation", "linkId is not an established link")
            link.sendPrivateApplicationMessageJson(requireText(rawJson, "rawJson"))
            resolveMap(promise) {
                putString("snapshot", store.encryptSnapshot(link.snapshot(), handle.context.asLink()))
            }
        }
    }

    @ReactMethod
    fun receivePrivateMessages(linkId: String, promise: Promise) {
        launch(promise) {
            val handle = handle(requireText(linkId, "linkId"))
            val link = (handle.kind as? LinkKind.Established)?.link
                ?: throw PaykitLinkBridgeError("validation", "linkId is not an established link")
            val inbound = link.receivePrivateApplicationMessages()
            val messages = Arguments.createArray()
            inbound.forEach { message ->
                messages.pushMap(
                    Arguments.createMap().apply {
                        message.version?.let { putInt("version", it.toInt()) } ?: putNull("version")
                        message.kind?.let { putString("kind", it) } ?: putNull("kind")
                        putString("rawJson", message.rawJson)
                    },
                )
            }
            resolveMap(promise) {
                putArray("messages", messages)
                putString("snapshot", store.encryptSnapshot(link.snapshot(), handle.context.asLink()))
            }
        }
    }

    @ReactMethod
    fun clearLinkOutbox(
        sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
        promise: Promise,
    ) {
        launch(promise) {
            val args = linkArgs(
                sessionAlias,
                receiverAlias,
                peerPubky,
                peerNoisePublicKey,
                localReceiverPath,
                remoteReceiverPath,
            )
            val deleted = args.session.clearEncryptedLinkOutbox(
                args.receiverSecret,
                args.peerPubky,
                args.peerNoisePublicKey,
                args.localReceiverPath,
                args.remoteReceiverPath,
            )
            promise.resolve(deleted.toDouble())
        }
    }

    @ReactMethod
    fun closeLink(linkId: String, promise: Promise) {
        launch(promise) {
            val handle = handles.remove(requireText(linkId, "linkId"))
            val link = (handle?.kind as? LinkKind.Established)?.link
            link?.closeLink()
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun generateAttachmentKey(promise: Promise) {
        launch(promise) {
            promise.resolve(paykitGenerateAttachmentKey())
        }
    }

    @ReactMethod
    fun attachmentEncrypt(plaintextB64: String, keyB64: String, aad: String?, promise: Promise) {
        launch(promise) {
            val sealed: AttachmentCiphertext = paykitAttachmentEncrypt(
                requireText(plaintextB64, "plaintextB64"),
                requireText(keyB64, "keyB64"),
                optionalText(aad),
            )
            resolveMap(promise) {
                putString("nonceB64", sealed.nonceB64)
                putString("ciphertextB64", sealed.ciphertextB64)
                putString("algorithm", sealed.algorithm)
            }
        }
    }

    @ReactMethod
    fun attachmentDecrypt(
        ciphertextB64: String,
        keyB64: String,
        nonceB64: String,
        aad: String?,
        promise: Promise,
    ) {
        launch(promise) {
            promise.resolve(
                paykitAttachmentDecrypt(
                    requireText(ciphertextB64, "ciphertextB64"),
                    requireText(keyB64, "keyB64"),
                    requireText(nonceB64, "nonceB64"),
                    optionalText(aad),
                ),
            )
        }
    }

    private fun startAuthKeepalive(attemptId: String) {
        try {
            keepalive.ensureStarted(attemptId)
        } catch (error: Throwable) {
            Log.e(PAYKIT_LINK_LOG_TAG, "auth keepalive start failed type=${error.javaClass.name}")
            throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
        }
    }

    private fun releaseAuthKeepalive(attemptId: String) {
        try {
            keepalive.release(attemptId)
        } catch (error: Throwable) {
            Log.e(PAYKIT_LINK_LOG_TAG, "auth keepalive release failed type=${error.javaClass.name}")
            throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
        }
    }

    private fun launch(promise: Promise, block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (error: Throwable) {
                val mapped = mapError(error)
                promise.reject(mapped.code, mapped.message)
            }
        }
    }

    private suspend fun chatClient(): ChatClient {
        clientMutex.withLock {
            client?.let { return it }
            val created = ChatClient()
            client = created
            return created
        }
    }

    private fun persistSession(session: ChatSession, promise: Promise) {
        val alias = UUID.randomUUID().toString()
        store.putString(PaykitLinkStore.sessionKey(alias), session.exportSession())
        sessions[alias] = session
        resolveMap(promise) {
            putString("sessionAlias", alias)
            putString("pubky", session.pubky())
        }
    }

    private suspend fun session(alias: String): ChatSession {
        sessions[alias]?.let { return it }
        val bearer = store.getString(PaykitLinkStore.sessionKey(alias))
            ?: throw PaykitLinkBridgeError("auth", "session alias not found")
        val restored = chatClient().restoreSession(bearer)
        store.putString(PaykitLinkStore.sessionKey(alias), restored.exportSession())
        sessions[alias] = restored
        return restored
    }

    private fun receiverSecret(alias: String): String {
        return store.getString(PaykitLinkStore.receiverKey(requireText(alias, "receiverAlias")))
            ?: throw PaykitLinkBridgeError("validation", "receiver alias not found")
    }

    private fun handle(linkId: String): LinkHandle {
        return handles[linkId] ?: throw PaykitLinkBridgeError("validation", "unknown linkId")
    }

    private suspend fun linkArgs(
        sessionAlias: String,
        receiverAlias: String,
        peerPubky: String,
        peerNoisePublicKey: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
    ): LinkCallArgs {
        return LinkCallArgs(
            session = session(requireText(sessionAlias, "sessionAlias")),
            receiverSecret = receiverSecret(receiverAlias),
            peerPubky = requireText(peerPubky, "peerPubky"),
            peerNoisePublicKey = requireText(peerNoisePublicKey, "peerNoisePublicKey"),
            localReceiverPath = requireText(localReceiverPath, "localReceiverPath"),
            remoteReceiverPath = requireText(remoteReceiverPath, "remoteReceiverPath"),
        )
    }

    private fun writePublic(
        session: ChatSession,
        url: String,
        content: String?,
        origin: String,
        method: String,
    ) {
        val owner = session.pubky()
        val path = ownerStoragePath(url, owner)
        val originClean = origin.trim().trimEnd('/')
        val exported = session.exportSession()
        val cookie = homeserverSessionCookie(exported, owner)
        val target = URL("$originClean$path?pubky-host=$owner")
        val conn = (target.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            setRequestProperty("Cookie", "$owner=$cookie")
            setRequestProperty("pubky-host", owner)
            setRequestProperty("Content-Type", "text/plain; charset=utf-8")
            connectTimeout = 30_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            doInput = true
            doOutput = content != null
        }
        try {
            if (content != null) {
                conn.outputStream.use { it.write(content.toByteArray(StandardCharsets.UTF_8)) }
            }
            val code = conn.responseCode
            if (BuildConfig.DEBUG) {
                Log.d(
                    PAYKIT_LINK_LOG_TAG,
                    "writePublic method=$method status=$code exportLen=${exported.length} cookieLen=${cookie.length} pathLen=${path.length}",
                )
            }
            if (code == 401 || code == 403) {
                throw PaykitLinkBridgeError("auth", staticMessage("auth"))
            }
            if (code !in 200..299) {
                throw PaykitLinkBridgeError("protocol", staticMessage("protocol"))
            }
        } catch (error: PaykitLinkBridgeError) {
            throw error
        } catch (_: IOException) {
            throw PaykitLinkBridgeError("network", staticMessage("network"))
        } finally {
            conn.disconnect()
        }
    }

    private fun ownerStoragePath(url: String, expectedOwner: String): String {
        val prefix = "pubky://"
        if (!url.startsWith(prefix)) {
            throw PaykitLinkBridgeError("validation", "url must be a pubky:// URI")
        }
        val rest = url.removePrefix(prefix)
        val slash = rest.indexOf('/')
        if (slash < 0) {
            throw PaykitLinkBridgeError("validation", "url is missing a path")
        }
        val owner = rest.substring(0, slash)
        val path = rest.substring(slash)
        if (owner != expectedOwner) {
            throw PaykitLinkBridgeError("validation", "url owner does not match session")
        }
        if (!path.startsWith("/pub/")) {
            throw PaykitLinkBridgeError("validation", "url path must start with /pub/")
        }
        return path
    }

    /**
     * Paykit `exportSession()` is pubky-sdk `export_secret()`:
     * `<pubkey>:<cookie_secret>`. The homeserver cookie value is only the
     * secret (26-char Crockford). Sending the whole token 401s.
     */
    private fun homeserverSessionCookie(exported: String, owner: String): String {
        val trimmed = exported.trim()
        val sep = trimmed.indexOf(':')
        if (sep > 0) {
            val pubky = trimmed.substring(0, sep)
            val secret = trimmed.substring(sep + 1)
            if (pubky == owner && secret.isNotEmpty()) {
                return secret
            }
        }
        return trimmed
    }

    private fun requireText(value: String?, name: String): String {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isEmpty()) {
            throw PaykitLinkBridgeError("validation", "$name is required")
        }
        return trimmed
    }

    private fun optionalText(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        return trimmed.ifEmpty { null }
    }

    private fun capabilitiesJson(capabilities: ChatReceiverCapabilities): String {
        return JSONObject()
            .put("privatePayments", capabilities.privatePayments)
            .put("paymentRequests", capabilities.paymentRequests)
            .put("receipts", capabilities.receipts)
            .put("outgoingPayments", capabilities.outgoingPayments)
            .toString()
    }

    // Inline so callers may invoke suspend functions inside the builder lambda
    // from within the module's coroutine bodies.
    private inline fun resolveMap(promise: Promise, builder: WritableMap.() -> Unit) {
        promise.resolve(Arguments.createMap().apply(builder))
    }

    private fun ffiCode(error: PaykitException): String? = when (error) {
        is PaykitException.Storage -> error.code
        is PaykitException.Identity -> error.code
        is PaykitException.Transport -> error.code
        is PaykitException.NotFound -> error.code
        is PaykitException.Protocol -> error.code
        is PaykitException.Policy -> error.code
        is PaykitException.PaymentAdapter -> error.code
        is PaykitException.RecoveryRequired -> error.code
        else -> null
    }

    private fun mapError(error: Throwable): PaykitLinkBridgeError {
        if (error is PaykitLinkBridgeError) return error
        val paykit = error as? PaykitException
        if (paykit != null) {
            val code = ffiCode(paykit) ?: "protocol"
            val coarse = mapFfiCode(code)
            // Never log raw FFI text — codes can carry an auth URL/client secret.
            if (isLoggableFfiCode(code)) {
                Log.e(PAYKIT_LINK_LOG_TAG, "Paykit FFI error code=$code mapped=$coarse")
            } else {
                Log.e(PAYKIT_LINK_LOG_TAG, "Paykit FFI error codeLen=${code.length} mapped=$coarse")
            }
            return PaykitLinkBridgeError(coarse, staticMessage(coarse))
        }
        Log.e(PAYKIT_LINK_LOG_TAG, "unmapped native error type=${error.javaClass.name}")
        return PaykitLinkBridgeError("protocol", staticMessage("protocol"))
    }

    /**
     * Chat FFI `Capabilities::try_from` comma-splits. Passing the joined
     * grant as one `Capability` fails (two `:`). Re-join valid entries.
     */
    private fun canonicalizeCapabilities(raw: String): String {
        val parts = raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.isEmpty()) {
            throw PaykitLinkBridgeError("validation", staticMessage("validation"))
        }
        for (part in parts) {
            if (!part.startsWith("/") || part.count { it == ':' } != 1) {
                throw PaykitLinkBridgeError("validation", staticMessage("validation"))
            }
        }
        return parts.joinToString(",")
    }

    private fun isLoggableFfiCode(code: String): Boolean {
        if (code.isEmpty() || code.length > FFI_CODE_LOG_MAX) return false
        return code.all { it in 'a'..'z' || it == '_' }
    }

    private fun mapFfiCode(code: String): String = when (code) {
        "transport_error", "send_failed", "receive_failed", "auth_flow_failed" -> "network"
        "signin_failed", "signup_failed", "session_restore_failed", "capabilities_missing" -> "auth"
        "validation" -> "validation"
        "consumed" -> "consumed"
        else -> "protocol"
    }

    private fun staticMessage(code: String): String = when (code) {
        "network" -> "network error"
        "auth" -> "authentication failed"
        "validation" -> "validation failed"
        "consumed" -> "resource consumed"
        "unavailable" -> "unavailable"
        else -> "protocol error"
    }
}

private const val PAYKIT_LINK_LOG_TAG = "PaykitLink"
private const val FFI_CODE_LOG_MAX = 64

private data class PaykitLinkBridgeError(
    val code: String,
    override val message: String,
) : Exception(message)

private data class LinkCallArgs(
    val session: ChatSession,
    val receiverSecret: String,
    val peerPubky: String,
    val peerNoisePublicKey: String,
    val localReceiverPath: String,
    val remoteReceiverPath: String,
)

private enum class SnapshotRole(val wire: String) {
    INITIATOR("initiator"),
    RESPONDER("responder"),
    LINK("link"),
}

private data class SnapshotContext(
    val ownerPubky: String,
    val peerPubky: String,
    val localReceiverPath: String,
    val remoteReceiverPath: String,
    val role: SnapshotRole,
) {
    val aad: ByteArray
        get() = "$ownerPubky|$peerPubky|$localReceiverPath|$remoteReceiverPath|${role.wire}"
            .toByteArray(StandardCharsets.UTF_8)

    fun asLink(): SnapshotContext = copy(role = SnapshotRole.LINK)
}

private sealed class LinkKind {
    data class Handshake(val handshake: ChatLinkHandshake) : LinkKind()
    data class Established(val link: ChatLink) : LinkKind()
}

private data class LinkHandle(
    val kind: LinkKind,
    val context: SnapshotContext,
)

private class PaykitLinkStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun putString(key: String, value: String) {
        prefs.edit().putString(key, wrap(value.toByteArray(StandardCharsets.UTF_8), key.toByteArray(StandardCharsets.UTF_8))).apply()
    }

    fun getString(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        return String(unwrap(stored, key.toByteArray(StandardCharsets.UTF_8)), StandardCharsets.UTF_8)
    }

    fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }

    fun clearAll() {
        val keys = prefs.all.keys.toList()
        if (keys.isNotEmpty()) {
            val editor = prefs.edit()
            for (key in keys) {
                editor.remove(key)
            }
            editor.apply()
        }
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (keyStore.containsAlias(MASTER_ALIAS)) {
                keyStore.deleteEntry(MASTER_ALIAS)
            }
        } catch (_: Exception) {
            // Prefs entries are already gone; snapshot key deletion is best-effort.
        }
    }

    suspend fun encryptSnapshot(plaintext: String, context: SnapshotContext): String {
        return seal(plaintext.toByteArray(StandardCharsets.UTF_8), context.aad)
    }

    fun decryptSnapshot(ciphertext: String, context: SnapshotContext): String {
        return try {
            String(open(ciphertext, context.aad), StandardCharsets.UTF_8)
        } catch (error: Exception) {
            throw PaykitLinkBridgeError("protocol", "snapshot decrypt failed")
        }
    }

    fun decryptHandshakeSnapshot(
        ciphertext: String,
        ownerPubky: String,
        peerPubky: String,
        localReceiverPath: String,
        remoteReceiverPath: String,
    ): HandshakePlaintext {
        var last: Exception = PaykitLinkBridgeError("protocol", "snapshot decrypt failed")
        for (role in listOf(SnapshotRole.INITIATOR, SnapshotRole.RESPONDER)) {
            val context = SnapshotContext(ownerPubky, peerPubky, localReceiverPath, remoteReceiverPath, role)
            try {
                return HandshakePlaintext(decryptSnapshot(ciphertext, context), role)
            } catch (error: Exception) {
                last = error
            }
        }
        throw last
    }

    private fun wrap(plaintext: ByteArray, aad: ByteArray): String = seal(plaintext, aad)

    private fun unwrap(blob: String, aad: ByteArray): ByteArray = open(blob, aad)

    private fun seal(plaintext: ByteArray, aad: ByteArray): String {
        // AndroidKeyStore AES-GCM keys require randomized encryption (default).
        // Passing a caller-generated IV throws InvalidAlgorithmParameterException
        // on API 36+; the Keystore supplies cipher.iv after init.
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, masterKey())
        cipher.updateAAD(aad)
        val iv = cipher.iv
        if (iv == null || iv.size != IV_SIZE) {
            throw PaykitLinkBridgeError("protocol", "keystore IV invalid")
        }
        val sealed = cipher.doFinal(plaintext)
        val out = ByteArray(iv.size + sealed.size)
        System.arraycopy(iv, 0, out, 0, iv.size)
        System.arraycopy(sealed, 0, out, iv.size, sealed.size)
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun open(blob: String, aad: ByteArray): ByteArray {
        val data = Base64.decode(blob, Base64.DEFAULT)
        if (data.size < IV_SIZE + TAG_SIZE) {
            throw PaykitLinkBridgeError("protocol", "snapshot decrypt failed")
        }
        val iv = data.copyOfRange(0, IV_SIZE)
        val sealed = data.copyOfRange(IV_SIZE, data.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(sealed)
    }

    private fun masterKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(MASTER_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                MASTER_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    data class HandshakePlaintext(
        val plaintext: String,
        val role: SnapshotRole,
    )

    companion object {
        private const val PREFS = "hypercolor.paykitlink"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val MASTER_ALIAS = "hypercolor.paykitlink.aead"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE = 12
        private const val TAG_SIZE = 16
        private const val TAG_BITS = 128

        fun receiverKey(alias: String): String = "receiver.$alias"
        fun sessionKey(alias: String): String = "session.$alias"
    }
}
