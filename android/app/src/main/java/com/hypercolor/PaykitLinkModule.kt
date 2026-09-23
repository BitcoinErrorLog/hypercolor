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
import org.json.JSONArray
import org.json.JSONObject
import uniffi.pubkycore.getHomeserver as pubkyGetHomeserver
import uniffi.pubkycore.resolveHttps as pubkyResolveHttps
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CancellationException as CoroutineCancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.CancellationException as JavaCancellationException

class PaykitLinkModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val job = SupervisorJob()
    private val scope = CoroutineScope(job + Dispatchers.IO)
    private val store = PaykitLinkStore(reactContext.applicationContext)
    private val clientMutex = Mutex()
    /**
     * Serializes pending-session store I/O. JVM intrinsic monitor
     * (`synchronized`): reentrant, so the owning thread can re-enter this
     * object. It is never nested with the registry monitor: persist / adopt
     * / teardown-delete / sweep take this only after the short state
     * transition returns. Cannot self-deadlock the way iOS `NSLock` did
     * when a lock-taking sweep ran inside `awaitAuthApproval`.
     */
    private val pendingIo = Any()
    /** Aliases inside [adoptAuthSession] after pending is dropped. */
    private val adoptingAliases = HashSet<String>()
    private var client: ChatClient? = null
    private val sessions = ConcurrentHashMap<String, ChatSession>()
    private val flows = AuthFlowCancelRegistry<ChatAuthFlow>()
    private val handles = ConcurrentHashMap<String, LinkHandle>()
    private val linkOpMutexes = ConcurrentHashMap<String, Mutex>()
    private val keepalive = AuthKeepaliveCoordinator(
        ops = object : AuthKeepaliveOps {
            override fun start(instanceToken: Long) {
                PaykitAuthKeepaliveService.start(
                    reactApplicationContext.applicationContext,
                    instanceToken,
                )
            }

            override fun stop() {
                PaykitAuthKeepaliveService.stop(reactApplicationContext.applicationContext)
            }
        },
        handler = MainKeepaliveHandler(),
        scheduler = HandlerKeepaliveScheduler(),
    )

    override fun getName(): String = "PaykitLinkModule"

    private fun opaquePeer(peer: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(peer.toByteArray(StandardCharsets.UTF_8))
        return digest.take(4).joinToString("") { b -> "%02x".format(b) }
    }

    override fun initialize() {
        super.initialize()
        PaykitAndroid.initializeOrThrow(reactApplicationContext)
        keepalive.attach()
        sweepDurablePendingFromPreviousProcess()
    }

    override fun invalidate() {
        // Teardown first so in-flight NonCancellable FFI cannot persist.
        // Pending aliases (not JS-adopted) are deleted: bearer, sessions,
        // durable marker. Adopted aliases are absent from pending and
        // are retained. Owner jobs are cancelled after the registry lock;
        // idle flows close here; admitted owners close exactly once in
        // AuthFlowAwait.finally. Store I/O runs on pendingIo, not the
        // registry monitor.
        val snapshot = flows.teardown()
        for (cancellable in snapshot.ownerCancellables) {
            cancellable.cancel()
        }
        for (idle in snapshot.idleFlows) {
            closeAuthFlow(idle)
        }
        deletePendingAliases(snapshot.pendingAliases)
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
            store.putReceiverSecret(alias, secret)
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
            if (!flows.put(flowId, flow)) {
                closeAuthFlow(flow)
                throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
            }
            try {
                startAuthKeepalive(flowId)
            } catch (error: Throwable) {
                closeAuthFlow(flows.abandon(flowId))
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
            try {
                AuthFlowAwait.execute(
                    flows = flows,
                    id = id,
                    awaitFfi = { flow -> flow.awaitApproval() },
                    closeFlow = { handle ->
                        // Exact-once owner close after the FFI path settles.
                        closeAuthFlow(handle)
                    },
                    persist = { session, alias -> persistPendingSession(session, alias) },
                    rollbackPending = { alias -> forgetPendingSession(alias) },
                    scheduleResolve = { session, alias ->
                        resolveMap(promise) {
                            putString("sessionAlias", alias)
                            putString("pubky", session.pubky())
                        }
                    },
                    onOwnerStart = { startAuthKeepalive(id) },
                    onOwnerFinish = { releaseAuthKeepalive(id) },
                )
            } catch (error: AuthFlowBridgeReject) {
                throw PaykitLinkBridgeError(error.code, error.message)
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

    /**
     * Retires [flowId]'s native waiter. Paykit FFI has no auth-flow cancel
     * primitive. Discard drops a not-yet-awaited flow so its relay
     * subscription stops; a wait already spawned by [ChatAuthFlow.awaitApproval]
     * runs to completion inside Paykit and cannot be aborted. After that FFI
     * await returns, [awaitAuthApproval] closes the handle so the poll can
     * stop. Cancels an in-flight coroutine, stops keepalive, and marks the id
     * so a later [awaitAuthApproval] rejects with `auth_flow_cancelled`
     * when that caller is the tombstone owner. A duplicate await of a live
     * owner rejects `validation` / "already awaiting" and must not prune
     * the owner's lease. Unknown ids and a second cancel are no-ops. A flow
     * whose approval was already confirmed (flow surfaced; session may
     * still be pending JS adopt) is left untouched. Close is exact-once:
     * idle flows close here; an admitted owner closes after its FFI path
     * settles.
     */
    @ReactMethod
    fun cancelAuthFlow(flowId: String, promise: Promise) {
        launch(promise) {
            val id = requireText(flowId, "flowId")
            val outcome = flows.cancel(id)
            if (outcome.kind == AuthFlowCancelKind.Unavailable) {
                throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
            }
            outcome.droppedCancellable?.cancel()
            // Idle / cancel-before-await only. Admitted owner closes after FFI.
            closeAuthFlow(outcome.droppedFlow)
            if (outcome.kind == AuthFlowCancelKind.Cancelled) {
                releaseAuthKeepalive(id)
            }
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
            persistDetachedPendingSession(
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
            persistDetachedPendingSession(
                chatClient().signupWithSecret(
                    requireText(identitySecretHex, "identitySecretHex"),
                    requireText(homeserverPublicKey, "homeserverPublicKey"),
                    optionalText(signupToken),
                ),
                promise,
            )
        }
    }

    /**
     * JS already wrote `KeyStore.setLinkSession`. Native only drops the
     * durable pending marker. Unknown or already-adopted aliases reject
     * `unavailable` (`session()` then refuses pending and unknown).
     */
    @ReactMethod
    fun adoptAuthSession(sessionAlias: String, promise: Promise) {
        launch(promise) {
            val alias = requireText(sessionAlias, "sessionAlias")
            synchronized(pendingIo) {
                adoptingAliases.add(alias)
            }
            try {
                if (!flows.adoptPending(alias)) {
                    throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
                }
                synchronized(pendingIo) {
                    store.clearPendingMarker(alias)
                }
                promise.resolve(null)
            } finally {
                synchronized(pendingIo) {
                    adoptingAliases.remove(alias)
                }
            }
        }
    }

    /**
     * Boot reconcile (keystore-ready only, once per JS process): two-sighting
     * quarantine of adopted bearers KeyStore does not name. Report-only:
     * subsequent sightings log an opaque alias id and keep the bearer.
     * In-flight pending/adopting aliases are excluded. Reserved/awaiting
     * flows have no session alias until persist.
     */
    @ReactMethod
    fun reconcileAdoptedSessions(knownSessionAlias: String?, promise: Promise) {
        launch(promise) {
            val named = knownSessionAlias?.trim().orEmpty()
            val known = if (named.isEmpty()) emptySet() else setOf(named)
            synchronized(pendingIo) {
                val inFlight = HashSet(flows.inFlightSessionAliases())
                inFlight.addAll(adoptingAliases)
                val result = PaykitLinkDurableReconcile.reconcileUnreferencedAdopted(
                    store,
                    known,
                    inFlight,
                    System.currentTimeMillis(),
                    PaykitLinkProcessIdentity.TOKEN,
                )
                for (alias in result.reported) {
                    Log.i(
                        PAYKIT_LINK_LOG_TAG,
                        PaykitLinkDurableReconcile.subsequentSightingLogLine(
                            alias,
                            result.bootCounter,
                        ),
                    )
                }
            }
            promise.resolve(null)
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
            flows.dropPending(alias)
            synchronized(pendingIo) {
                sessions.remove(alias)
                store.deleteSession(alias)
            }
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun clearAllNativeSecrets(promise: Promise) {
        launch(promise) {
            // Sign-out: same idle/owner split as invalidate(). Close idle
            // now; cancel admitted owners and let only AuthFlowAwait.finally
            // close. Owners reject auth_flow_cancelled and must not persist.
            // drainLive also clears in-memory pending.
            val snapshot = flows.drainLive()
            for (cancellable in snapshot.ownerCancellables) {
                cancellable.cancel()
            }
            for (idle in snapshot.idleFlows) {
                closeAuthFlow(idle)
            }
            handles.clear()
            keepalive.releaseAll()
            clientMutex.withLock { client = null }
            // Full-clear under the same monitor as the session() rotated
            // bearer write-back: the write-back either completes before
            // this section (and is wiped here) or runs after it and sees
            // the cleared store. Sessions are evicted in the same section
            // so an in-memory session cannot outlive its bearer.
            synchronized(pendingIo) {
                sessions.clear()
                store.clearAll()
            }
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
    fun sessionCapabilities(sessionAlias: String, promise: Promise) {
        launch(promise) {
            val session = sessionForCapabilityInspect(requireText(sessionAlias, "sessionAlias"))
            val inspected = inspectSessionCapabilities(session)
            resolveMap(promise) {
                putString("capabilities", inspected.first)
                putString("origin", inspected.second)
            }
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
            // Do not use ChatSession.probeInboundEncryptedLink. That FFI
            // helper (paykit-ffi chat_links.rs) (1) parks NoInbound forever
            // for the same ProbeKey and (2) pre-GETs a slot derived in FFI
            // (`inbound_handshake_slot_addr`) which can miss msg1 that
            // `accept_encrypted_link` / wasm `initiateEncryptedLink` wrote
            // via paykit_lib::compute_private_payment_paths. Match wasm:
            // accept + one advance; unchanged snapshot means nothing inbound.
            val probeStartedAt = System.nanoTime()
            val handshake = args.session.acceptEncryptedLink(
                args.receiverSecret,
                args.peerPubky,
                args.peerNoisePublicKey,
                args.localReceiverPath,
                args.remoteReceiverPath,
            )
            try {
                val before = handshake.snapshot()
                val step = try {
                    handshake.advance()
                } catch (err: PaykitException) {
                    handshake.close()
                    val probeMs = (System.nanoTime() - probeStartedAt) / 1_000_000L
                    Log.i(
                        "PaykitLink",
                        "inbound-probe result=none durationMs=$probeMs peer=${opaquePeer(args.peerPubky)} reason=advance-error",
                    )
                    resolveMap(promise) { putString("result", "none") }
                    return@launch
                }
                val established = step.link
                if (step.complete && established != null) {
                    val probeMs = (System.nanoTime() - probeStartedAt) / 1_000_000L
                    Log.i(
                        "PaykitLink",
                        "inbound-probe result=established durationMs=$probeMs peer=${opaquePeer(args.peerPubky)}",
                    )
                    val context = SnapshotContext(
                        ownerPubky = args.session.pubky(),
                        peerPubky = args.peerPubky,
                        localReceiverPath = args.localReceiverPath,
                        remoteReceiverPath = args.remoteReceiverPath,
                        role = SnapshotRole.LINK,
                    )
                    val snapshot = store.encryptSnapshot(established.snapshot(), context)
                    handshake.close()
                    val linkId = UUID.randomUUID().toString()
                    handles[linkId] = LinkHandle(LinkKind.Established(established), context)
                    resolveMap(promise) {
                        putString("result", "established")
                        putString("linkId", linkId)
                        putString("snapshot", snapshot)
                    }
                    return@launch
                }
                val after = handshake.snapshot()
                val probeMs = (System.nanoTime() - probeStartedAt) / 1_000_000L
                if (before == after) {
                    handshake.close()
                    Log.i(
                        "PaykitLink",
                        "inbound-probe result=none durationMs=$probeMs peer=${opaquePeer(args.peerPubky)} reason=unchanged-snapshot",
                    )
                    resolveMap(promise) { putString("result", "none") }
                    return@launch
                }
                Log.i(
                    "PaykitLink",
                    "inbound-probe result=pending durationMs=$probeMs peer=${opaquePeer(args.peerPubky)}",
                )
                val context = SnapshotContext(
                    ownerPubky = args.session.pubky(),
                    peerPubky = args.peerPubky,
                    localReceiverPath = args.localReceiverPath,
                    remoteReceiverPath = args.remoteReceiverPath,
                    role = SnapshotRole.RESPONDER,
                )
                val snapshot = store.encryptSnapshot(after, context)
                val linkId = UUID.randomUUID().toString()
                handles[linkId] = LinkHandle(LinkKind.Handshake(handshake), context)
                resolveMap(promise) {
                    putString("result", "pending")
                    putString("linkId", linkId)
                    putString("snapshot", snapshot)
                }
            } catch (err: Throwable) {
                handshake.close()
                throw err
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
            val id = requireText(linkId, "linkId")
            linkOpMutex(id).withLock {
                val handle = handle(id)
                val link = (handle.kind as? LinkKind.Established)?.link
                    ?: throw PaykitLinkBridgeError("validation", "linkId is not an established link")
                link.sendPrivateApplicationMessageJson(requireText(rawJson, "rawJson"))
                resolveMap(promise) {
                    putString("snapshot", store.encryptSnapshot(link.snapshot(), handle.context.asLink()))
                }
            }
        }
    }

    @ReactMethod
    fun receivePrivateMessages(linkId: String, promise: Promise) {
        launch(promise) {
            val id = requireText(linkId, "linkId")
            linkOpMutex(id).withLock {
                val handle = handle(id)
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
            val id = requireText(linkId, "linkId")
            linkOpMutex(id).withLock {
                val handle = handles.remove(id)
                val link = (handle?.kind as? LinkKind.Established)?.link
                link?.closeLink()
            }
            linkOpMutexes.remove(id)
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
                if (isCoroutineCancellation(error)) {
                    promise.reject("unavailable", staticMessage("unavailable"))
                    throw error
                }
                if (error is PaykitLinkBridgeError && error.code == "auth_flow_cancelled") {
                    promise.reject("auth_flow_cancelled", staticMessage("auth_flow_cancelled"))
                    return@launch
                }
                val mapped = mapError(error)
                promise.reject(mapped.code, mapped.message)
            }
        }
    }

    private fun closeAuthFlow(flow: ChatAuthFlow?) {
        if (flow == null) return
        try {
            flow.close()
        } catch (_: Throwable) {
            // UniFFI close is best-effort; the Cleaner still runs.
        }
    }

    private fun isCoroutineCancellation(error: Throwable): Boolean {
        return error is CoroutineCancellationException || error is JavaCancellationException
    }

    private suspend fun chatClient(): ChatClient {
        clientMutex.withLock {
            client?.let { return it }
            val created = ChatClient()
            client = created
            return created
        }
    }

    /**
     * Process-death leftovers: a durable pending marker with no live
     * runtime means JS never wrote KeyStore. Delete bearer + marker so an
     * orphan enabled session cannot exist. Failures must not abort module
     * `initialize()`.
     */
    private fun sweepDurablePendingFromPreviousProcess() {
        try {
            synchronized(pendingIo) {
                PaykitLinkDurableReconcile.sweepPendingLeftovers(store) { sessions.remove(it) }
            }
        } catch (error: Throwable) {
            Log.e(PAYKIT_LINK_LOG_TAG, "pending sweep failed type=${error.javaClass.name}")
        }
    }

    private fun deletePendingAliases(aliases: List<String>) {
        if (aliases.isEmpty()) return
        synchronized(pendingIo) {
            PaykitLinkDurableReconcile.deleteAliases(store, aliases) { sessions.remove(it) }
        }
    }

    private fun persistPendingSession(session: ChatSession, alias: String) {
        if (!flows.isPending(alias)) {
            if (flows.isTornDown()) {
                throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
            }
            throw PaykitLinkBridgeError("auth_flow_cancelled", staticMessage("auth_flow_cancelled"))
        }
        synchronized(pendingIo) {
            store.putPendingSession(alias, session.exportSession())
            sessions[alias] = session
        }
        if (!flows.isPending(alias)) {
            synchronized(pendingIo) {
                sessions.remove(alias)
                store.deleteSession(alias)
            }
            if (flows.isTornDown()) {
                throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
            }
            throw PaykitLinkBridgeError("auth_flow_cancelled", staticMessage("auth_flow_cancelled"))
        }
    }

    private fun forgetPendingSession(alias: String) {
        flows.dropPending(alias)
        synchronized(pendingIo) {
            sessions.remove(alias)
            store.deleteSession(alias)
        }
    }

    private fun persistDetachedPendingSession(session: ChatSession, promise: Promise) {
        val alias = UUID.randomUUID().toString()
        if (!flows.registerPending(alias)) {
            throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
        }
        try {
            persistPendingSession(session, alias)
        } catch (error: Throwable) {
            forgetPendingSession(alias)
            throw error
        }
        resolveMap(promise) {
            putString("sessionAlias", alias)
            putString("pubky", session.pubky())
        }
    }

    /**
     * F7 inspect-only: pending aliases may be restored so `/session` GET
     * can run before persistThenAdopt. Does not write back a rotated
     * bearer and does not cache. putPublic/deletePublic stay on [session],
     * which still refuses pending.
     */
    private suspend fun sessionForCapabilityInspect(alias: String): ChatSession {
        sessions[alias]?.let { return it }
        val bearer = store.getString(PaykitLinkStore.sessionKey(alias))
            ?: throw PaykitLinkBridgeError("auth", "session alias not found")
        return chatClient().restoreSession(bearer)
    }

    private suspend fun session(alias: String): ChatSession {
        if (PaykitLinkSessionGuard.isPending(flows.isPending(alias), store.hasPendingMarker(alias))) {
            throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
        }
        sessions[alias]?.let { return it }
        val bearer = store.getString(PaykitLinkStore.sessionKey(alias))
            ?: throw PaykitLinkBridgeError("auth", "session alias not found")
        val restored = chatClient().restoreSession(bearer)
        // Re-check liveness under pendingIo before bearer write-back so a
        // concurrent signOutSession / clearAllNativeSecrets cannot resurrect
        // a deleted alias via the rotated export.
        synchronized(pendingIo) {
            if (PaykitLinkSessionGuard.isPending(flows.isPending(alias), store.hasPendingMarker(alias))) {
                throw PaykitLinkBridgeError("unavailable", staticMessage("unavailable"))
            }
            if (store.getString(PaykitLinkStore.sessionKey(alias)) == null) {
                throw PaykitLinkBridgeError("auth", "session alias not found")
            }
            store.putString(PaykitLinkStore.sessionKey(alias), restored.exportSession())
            sessions[alias] = restored
        }
        return restored
    }

    private fun receiverSecret(alias: String): String {
        return store.getString(PaykitLinkStore.receiverKey(requireText(alias, "receiverAlias")))
            ?: throw PaykitLinkBridgeError("validation", "receiver alias not found")
    }

    private fun handle(linkId: String): LinkHandle {
        return handles[linkId] ?: throw PaykitLinkBridgeError("validation", "unknown linkId")
    }

    private fun linkOpMutex(linkId: String): Mutex =
        linkOpMutexes.getOrPut(linkId) { Mutex() }

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
        val originClean = pinnedHomeserverOrigin(owner, origin)
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

    companion object {
        private const val STAGING_HOMESERVER_PUBKY =
            "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy"
        private const val STAGING_HOMESERVER_ORIGIN = "https://homeserver.staging.pubky.app"
    }

    /**
     * pubkycore's list is `[tag, value]`. Live success is `"false"` (not an
     * error). The JS client accepts every tag other than `"error"`.
     */
    private fun unwrapPubkyCore(result: List<String>): String? {
        if (result.size >= 2 && result[0] != "error" && result[1].isNotEmpty()) {
            return result[1]
        }
        return null
    }

    private fun normalizeHttpsOrigin(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        val parsed = try {
            URL(if (trimmed.contains("://")) trimmed else "https://$trimmed")
        } catch (_: Exception) {
            throw PaykitLinkBridgeError("validation", staticMessage("validation"))
        }
        if (parsed.protocol != "https") {
            throw PaykitLinkBridgeError("validation", staticMessage("validation"))
        }
        val host = parsed.host ?: throw PaykitLinkBridgeError("validation", staticMessage("validation"))
        val port = if (parsed.port > 0 && parsed.port != 443) ":${parsed.port}" else ""
        return "https://$host$port"
    }

    private fun originFromHomeserverHint(hint: String): String? {
        val trimmed = hint.trim()
        if (trimmed.isEmpty()) return null
        if (trimmed.startsWith("https://", ignoreCase = true) ||
            trimmed.startsWith("http://", ignoreCase = true)
        ) {
            return normalizeHttpsOrigin(trimmed)
        }
        val resolvedJson = try {
            unwrapPubkyCore(pubkyResolveHttps(trimmed))
        } catch (_: Exception) {
            null
        }
        if (resolvedJson != null) {
            try {
                val json = JSONObject(resolvedJson)
                val records = json.optJSONArray("https_records")
                if (records != null && records.length() > 0) {
                    val rec = records.getJSONObject(0)
                    val target = rec.optString("target").trimEnd('.')
                    if (target.isNotEmpty() && target != ".") {
                        val port = rec.optInt("port", 443)
                        val portPart = if (port != 0 && port != 443) ":$port" else ""
                        return "https://$target$portPart"
                    }
                }
            } catch (_: Exception) {
                // Fall through to the staging pubkey constant.
            }
        }
        if (trimmed == STAGING_HOMESERVER_PUBKY) {
            return STAGING_HOMESERVER_ORIGIN
        }
        return null
    }

    /**
     * F1: derive the HTTPS origin from the session owner's pkarr homeserver
     * before any Cookie header is set. JS `homeserverOrigin` is a hint only;
     * mismatch is validation and the cookie is never sent.
     */
    private fun pinnedHomeserverOrigin(owner: String, jsHint: String?): String {
        val hs = try {
            unwrapPubkyCore(pubkyGetHomeserver(owner))
        } catch (_: Exception) {
            null
        }
        val derived = if (hs != null) originFromHomeserverHint(hs) else null
        val pinned = derived ?: throw PaykitLinkBridgeError("validation", staticMessage("validation"))
        if (!jsHint.isNullOrBlank()) {
            val hintClean = normalizeHttpsOrigin(jsHint)
            if (hintClean != pinned) {
                throw PaykitLinkBridgeError("validation", staticMessage("validation"))
            }
        }
        return pinned
    }

    private fun inspectSessionCapabilities(session: ChatSession): Pair<String, String> {
        val owner = session.pubky()
        val originClean = pinnedHomeserverOrigin(owner, null)
        val exported = session.exportSession()
        val cookie = homeserverSessionCookie(exported, owner)
        val target = URL("$originClean/session?pubky-host=$owner")
        val conn = (target.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Cookie", "$owner=$cookie")
            setRequestProperty("pubky-host", owner)
            connectTimeout = 30_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            doInput = true
        }
        try {
            val code = conn.responseCode
            if (code == 401 || code == 403) {
                throw PaykitLinkBridgeError("auth", staticMessage("auth"))
            }
            if (code !in 200..299) {
                throw PaykitLinkBridgeError("protocol", staticMessage("protocol"))
            }
            val body = conn.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            return Pair(capabilitiesFromSessionJson(body), originClean)
        } catch (error: PaykitLinkBridgeError) {
            throw error
        } catch (_: IOException) {
            throw PaykitLinkBridgeError("network", staticMessage("network"))
        } finally {
            conn.disconnect()
        }
    }

    private fun capabilitiesFromSessionJson(body: String): String {
        val json = try {
            JSONObject(body)
        } catch (_: Exception) {
            throw PaykitLinkBridgeError("protocol", staticMessage("protocol"))
        }
        val raw = json.opt("capabilities")
        if (raw is JSONArray) {
            val parts = ArrayList<String>()
            for (i in 0 until raw.length()) {
                val entry = raw.optString(i).trim()
                if (entry.isNotEmpty()) parts.add(entry)
            }
            return parts.joinToString(",")
        }
        if (raw is String) return raw.trim()
        return ""
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

    private fun mapFfiCode(code: String): String = mapPaykitFfiCode(code)

    private fun staticMessage(code: String): String = when (code) {
        "network" -> "network error"
        "auth" -> "authentication failed"
        "validation" -> "validation failed"
        "consumed" -> "resource consumed"
        "unavailable" -> "unavailable"
        "auth_flow_cancelled" -> "auth flow cancelled"
        else -> "protocol error"
    }
}

internal fun mapPaykitFfiCode(code: String): String = when (code) {
    "transport_error", "send_failed", "receive_failed", "auth_flow_failed" -> "network"
    "signin_failed", "signup_failed", "session_restore_failed", "capabilities_missing" -> "auth"
    "validation" -> "validation"
    "consumed" -> "consumed"
    "auth_flow_cancelled" -> "auth_flow_cancelled"
    // EncryptedLink concurrency: another send/receive is in flight, or a
    // parked send of a different payload has not settled. These are
    // transient — retry the same JSON; do not coarsen to protocol (which
    // drops the live handle and forces restore while the FFI send is live).
    "in_flight", "parked_result_conflict" -> "unavailable"
    else -> "protocol"
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

internal enum class SnapshotRole(val wire: String) {
    INITIATOR("initiator"),
    RESPONDER("responder"),
    LINK("link"),
}

internal data class SnapshotContext(
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

internal class PaykitLinkStore(context: Context) : PaykitLinkSessionCatalog {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun putString(key: String, value: String) {
        prefs.edit().putString(key, wrap(value.toByteArray(StandardCharsets.UTF_8), key.toByteArray(StandardCharsets.UTF_8))).apply()
    }

    /** Receiver Noise secrets must flush synchronously (commit), matching session material. */
    fun putReceiverSecret(alias: String, secret: String) {
        val key = receiverKey(alias)
        commitEdits { editor ->
            editor.putString(
                key,
                wrap(secret.toByteArray(StandardCharsets.UTF_8), key.toByteArray(StandardCharsets.UTF_8)),
            )
        }
    }

    override fun putPendingSession(alias: String, bearer: String) {
        val sessionPref = sessionKey(alias)
        val pendingPref = sessionPendingKey(alias)
        commitEdits { editor ->
            editor.putString(
                sessionPref,
                wrap(bearer.toByteArray(StandardCharsets.UTF_8), sessionPref.toByteArray(StandardCharsets.UTF_8)),
            )
            editor.putString(
                pendingPref,
                wrap("1".toByteArray(StandardCharsets.UTF_8), pendingPref.toByteArray(StandardCharsets.UTF_8)),
            )
        }
    }

    override fun clearPendingMarker(alias: String) {
        commitEdits { editor ->
            editor.remove(sessionPendingKey(alias))
        }
    }

    override fun deleteSession(alias: String) {
        commitEdits { editor ->
            editor.remove(sessionKey(alias))
            editor.remove(sessionPendingKey(alias))
            editor.remove(PaykitLinkSessionKeys.quarantineKey(alias))
        }
    }

    override fun hasPendingMarker(alias: String): Boolean {
        return prefs.contains(sessionPendingKey(alias))
    }

    override fun hasSessionBearer(alias: String): Boolean {
        return prefs.contains(sessionKey(alias))
    }

    override fun listPendingSessionAliases(): List<String> {
        return prefs.all.keys.mapNotNull { PaykitLinkSessionKeys.pendingAliasFromKey(it) }
    }

    override fun listSessionAliases(): List<String> {
        return prefs.all.keys.mapNotNull { PaykitLinkSessionKeys.sessionAliasFromKey(it) }
    }

    override fun getBootCounter(): Long {
        val raw = getString(PaykitLinkSessionKeys.BOOT_COUNTER_KEY) ?: return 0L
        return raw.toLongOrNull() ?: 0L
    }

    override fun setBootCounter(value: Long) {
        putCommitted(PaykitLinkSessionKeys.BOOT_COUNTER_KEY, value.toString())
    }

    override fun getQuarantine(alias: String): PaykitLinkQuarantineRecord? {
        val raw = getString(PaykitLinkSessionKeys.quarantineKey(alias)) ?: return null
        return PaykitLinkSessionKeys.parseQuarantine(raw)
    }

    override fun putQuarantine(alias: String, record: PaykitLinkQuarantineRecord) {
        putCommitted(PaykitLinkSessionKeys.quarantineKey(alias), PaykitLinkSessionKeys.formatQuarantine(record))
    }

    override fun clearQuarantine(alias: String) {
        commitEdits { editor ->
            editor.remove(PaykitLinkSessionKeys.quarantineKey(alias))
        }
    }

    private fun putCommitted(key: String, value: String) {
        commitEdits { editor ->
            editor.putString(
                key,
                wrap(value.toByteArray(StandardCharsets.UTF_8), key.toByteArray(StandardCharsets.UTF_8)),
            )
        }
    }

    fun getString(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        return String(unwrap(stored, key.toByteArray(StandardCharsets.UTF_8)), StandardCharsets.UTF_8)
    }

    fun clearAll() {
        val keys = prefs.all.keys.toList()
        if (keys.isNotEmpty()) {
            commitEdits { editor ->
                for (key in keys) {
                    editor.remove(key)
                }
            }
        }
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (keyStore.containsAlias(MASTER_ALIAS)) {
                keyStore.deleteEntry(MASTER_ALIAS)
            }
        } catch (_: Exception) {
            // Prefs entries are already gone; snapshot key deletion is best-effort.
        }
        unlinkLegacyMmkvBestEffort()
    }

    /** Best-effort unlink of known legacy MMKV files under the app files dir. */
    private fun unlinkLegacyMmkvBestEffort() {
        try {
            val mmkvDir = java.io.File(appContext.filesDir, "mmkv")
            if (!mmkvDir.isDirectory) return
            val allowed = setOf(
                "hypercolor-keystore",
                "hypercolor-keystore.crc",
                "hypercolor-keystore.default",
                "hypercolor-keystore.default.crc",
                "paykit-link-legacy",
                "paykit-link-legacy.crc",
            )
            mmkvDir.listFiles()?.forEach { file ->
                if (file.name in allowed) {
                    runCatching { file.delete() }
                }
            }
        } catch (_: Throwable) {
            // Remanence reduction only.
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

    private fun commitEdits(block: (android.content.SharedPreferences.Editor) -> Unit) {
        val editor = prefs.edit()
        block(editor)
        if (!editor.commit()) {
            throw PaykitLinkBridgeError("protocol", "protocol error")
        }
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
        fun sessionKey(alias: String): String = PaykitLinkSessionKeys.sessionKey(alias)
        fun sessionPendingKey(alias: String): String = PaykitLinkSessionKeys.sessionPendingKey(alias)
    }
}
