# Pubky Chat — Binding Proof Requirements

Date: 2026-08-30
Status: **required for M7**. M0–M6 implementation may stay shipped; a feature is not *proven* until the matching row below is green.
Repo: `/Users/johncarvalho/work/hypercolor` (`BitcoinErrorLog/hypercolor`)
Plan: `.cursor/plans/pubky_chat_app_plan_7137e0a5.plan.md` (M7)

## Org safety (including OpenCode/Kimi)

All agents — parent, Cursor Task, and OpenCode/Kimi — may write only to `BitcoinErrorLog/*` (or `atomicity-credit/*` if in scope). No pushes, PRs, or remote changes on `synonymdev`, `pubky`, or any other org.

- Prefer existing BEL forks: `hypercolor`, `paykit-rs-official` (marketplace chat FFI), `pubky-marketplace`, `pubky-ring`, `paykit-rs`, `bitkit-ios`, `bitkit-android`, `bitkit-core`, `bitkit`.
- Local `vibes-dev/bitkit-*` checkouts currently have `origin` → `synonymdev`. Treat them as read-only. If Bitkit code must change, parent forks/uses `BitcoinErrorLog/bitkit-*` and adds a `fork` remote; Kimi never does that.
- Kimi/OpenCode never runs `git push`, `gh pr create`, or any remote write. Parent verifies the remote URL contains `BitcoinErrorLog` before every push.
- Ring/Bitkit as installed apps are black-box proof targets; that is not a license to edit their upstream repos.

These requirements exist because M1–M6 left a proof gap: Jest covers service invariants, and one iOS simulator harness proved native Encrypted-Link DMs plus payment *PAMs* on staging. That is not a product-feature proof.

## Already satisfied (do not regress)

| Gate | What ran | Bar |
|---|---|---|
| CI | `npm run typecheck && npm run lint && npm test` on every push | Typecheck + lint + Jest green. Last counted: 34 suites / 309 tests. |
| Staging DM (native path) | `runLinkLiveProof` on iOS simulator, two fresh staging signups | Handshake + bidirectional chat PAMs over real homeserver. |
| Staging payment PAMs | Same harness | Request → accept → proof, plus a second request → reject. Proof payload is dummy hex — **does not** satisfy the payment-execution row below. |

CI must **not** run live staging (signup tokens are secrets; the run needs a simulator). Parent runs live proofs locally and records the report.

## Required and not yet satisfied

A row is green only when **all** of its acceptance bullets are true. Unit tests alone do not close a live row.

### P0 — Product-path DMs (LinkService)

The existing live harness talks to `PaykitLinkNative` directly and **bypasses** `LinkService` (retry queue, persist-before-send, inbox sync, `link_messages`, ThreadScreen path).

- Extend the live harness so A→B and B→A chat goes through `LinkService.sendDm` / `syncInbox` (or the same public methods the UI uses), not `sendPrivateMessageJson` / `receivePrivateMessages` as the sole path.
- Two fresh staging identities, iOS **and** Android (one platform first is a halfway checkpoint; both required to close the row).
- Assert persisted `link_messages` rows, delivery state transitions, and event-id dedup on a replayed inbox poll.
- Keep the native-only path as an optional diagnostic; it is not the product proof.

### P1 — Contacts, Nexus, WoT requests

- Three staging identities: A follows B; C is a stranger.
- A can add B (paste pubky; camera QR is out of scope per `docs/DECISIONS.md`).
- Inbound from B lands in message requests. Follow, mutual follow, and paste/manual add do **not** auto-accept.
- Inbound from C lands in message requests and does **not** auto-accept. A unilateral Nexus follower bit must not open the gate.
- The only auto-accept path is a prior routed conversation (`hasPriorRoutedConversation`: existing `link_messages` for this owner+peer). That is compatibility, not a trust signal.
- Optional Nexus: if staging Nexus is reachable, friends/followers import matches public graph; if not, record the skip and still prove the local WoT bits.

### P2 — Private groups (three-party)

- Three staging identities, pairwise Encrypted Links established.
- B and C explicitly accept A's pending request (A initiates AB/AC); C accepts B's (B initiates BC) before membership fan-out.
- A creates a private channel; B and C receive membership via fan-out PAMs.
- A sends a group message; B and C persist the same body, authorized as active members.
- B sends a group message; A persists the same body.
- Removal cutoff: A removes C; C’s later group message is rejected and not persisted on A/B.
- Founder-bound channel id (`{founderPubky}:{uuid}`) and sender-scoped event ids hold under a forged `channel_id` / reused `event_id` from the wrong peer.
- Public channels are a separate unit-tested path; they do not close this row.

### P3 — Encrypted attachments

- Two staging identities on an established LinkService link.
- A sends an image (or file under the 8 MiB v1 cap) through `AttachmentService.sendAttachment`.
- B downloads, decrypts, and opens a cache file whose plaintext matches.
- Invariants checked on the live objects: content key not in SQLite `raw_json`; location bound to A; ciphertext AAD bound to the homeserver path; receive-side size cap rejects an oversized blob before decrypt.
- Thumbnail path if the fixture is an image.

### P4 — Payment execution + wallet handoff

Payment *PAM* lifecycle on staging is already green. This row is execution:

- Request amount is bound to the displayed amount and to the constructed `lightning:` / `bitcoin:` URI (`walletHandoff` + bolt11 / on-chain validation) **before** `Linking.openURL`.
- A registered handler receives that exact URI (Bitkit on device/simulator, or a test scheme recorder). Injection (wrong scheme, swapped amount, swapped destination) must fail closed.
- **Preferred close:** one real payment on regtest/signet via Bitkit (marketplace-wallet-leg bar from M5). If Bitkit cannot run in the proof environment, do not mark this row green — record the blocker and stop. Dummy `proofData` hex does not close this row.

### P5 — Backup / second-device restore

- Device 1 (identity A): export encrypted backup to the staging homeserver path; recovery code shown once.
- Wipe A’s local SQLite + native secrets (or a second install / fresh simulator container).
- Restore from the homeserver blob + recovery code.
- Restored: contacts, message-request rows, link message history, read cursors, group metadata/messages, payment request rows, attachment **metadata**.
- Not restored (must re-establish): receiver Noise alias, session alias, link snapshots, attachment content keys. After restore, re-enable messaging and complete a new handshake; a prior attachment without a key renders `unavailable-from-backup`.
- Snapshot must not contain device secrets, Noise aliases, session aliases, or raw attachment keys.

### P6 — Ring / production auth

- At least one live sign-in uses `startAuthFlow` / `awaitAuthApproval` (`pubkyauth://` + HTTP relay), **not** `signupWithSecret` / `signinWithSecret`.
- Those secret-import methods remain debug-gated and fail in release.
- If Ring cannot be driven from the harness: a recorded manual proof on a physical device with a real Ring install is acceptable **once**, with screenshots/logs of the deep-link round-trip and the resulting session alias. An automated skip is not a close.

### P7 — UI end-to-end

- Maestro suite only (no Detox). Flows live in `.maestro/`.
- Flows: launch → debug signup (secret import; not Ring / P6) → enable messaging → send/receive a DM on ThreadScreen / Chats → open a payment-request bubble and confirm the displayed amount matches the request.
- This is the ThreadScreen / navigation proof. Service-only live proofs do not close this row.
- A live `maestro test` on a simulator/device is what closes the row. Jest + `tsc` do not.

## Harness rules (all live rows)

1. Fresh staging signup tokens per run (admin generate; single-use). Never commit tokens or identity secrets.
2. Redact tokens, identity secrets, and recovery codes in logs and the report (`redactLiveProofForLog` or equivalent).
3. Cleanup: close links, remove receiver markers, `clearAllNativeSecrets` / `clearAccountData`.
4. Report shape: `{ ok, steps: [{ step, ok, detail, elapsedMs }] }`. Parent keeps the last green report in the session notes; do not commit secrets.
5. `__DEV__` + `EXPO_PUBLIC_LIVEPROOF` auto-runner may stay for DM/payment PAM; new rows get named steps in the same harness or a sibling `liveProof*.ts` imported from `App.tsx` the same way.
6. No stubs, mocks-as-product, or “prove later” closes.

## Unit / integration tests that must stay (and grow with M7)

Keep and extend Jest for anything a live run cannot cheaply adversarial-test:

- LinkService: nonce-safe persist-before-send, wedged-handshake recovery, inbound keyed to authenticated peer.
- `wotGate`: prior-routed-conversation auto-accept only; follow / mutual / manual add / trust-score / unilateral-follower must all stay `request`.
- `applyGroupInbound`: authorize-before-persist, founder-bound ids, sender-scoped events, bounded deferral.
- Attachments: redaction, sender-bound location, size caps, AAD mismatch.
- Payments: CAS transitions, authorization, URI injection failures.
- Backup: snapshot exclusion list, AAD bind, restore without device secrets.
- `onchainAddress` SHA-256 used only for Base58Check.

New live-proof code needs Jest coverage of its step machine (same pattern as `liveProof.test.ts`) with a mocked native module — that does **not** replace the staging run.

## Harness entrypoints

All runners live under `src/services/link/liveProof*.ts`. `App.tsx` dynamic-imports `runNamedLiveProofs` from `liveProofRun.ts` (`__DEV__` + env). Parent runs on a simulator/device with staging signup tokens. Never commit tokens. The native-only `runLinkLiveProof` stays in `liveProof.ts` so Jest can cover it without loading product services.

`EXPO_PUBLIC_LIVEPROOF` is `<homeserverPubky>,<tokenA>,<tokenB>[,<tokenC>]`.

`EXPO_PUBLIC_LIVEPROOF_ROWS` is a comma list of `p0` / `p1` / `p2` / `p3` / `p4` / `p5` (default `p0`). `EXPO_PUBLIC_LIVEPROOF_NATIVE=1` also runs the native-only diagnostic (`runLinkLiveProof`); that path is **not** the product proof.

| Row | Function | Tokens | What parent should see |
|---|---|---|---|
| P0 | `runLinkServiceLiveProof` | A, B | Paste/follow does **not** skip the request queue. First inbound is a message request unless a prior routed conversation already exists; after explicit accept, `send-dm-a` / `sync-inbox-b` / `persist-inbound-b` / `send-dm-b` / `sync-inbox-a` / `replay-inbox-dedup` through `LinkService.sendDm` + `syncInbox` |
| P1 | `runContactsLiveProof` | A, B, C | `add-contact-b-paste`, `nexus-import` (or `skipped nexus:`), `inbound-b-request`, `inbound-c-request`, `unilateral-follower-closed` |
| P2 | `runGroupLiveProof` | A, B, C | `accept-request-b`, `accept-request-c`, `accept-request-c-from-b`, `create-channel-a`, `membership-fanout`, `group-message-a`, `group-message-b`, `remove-c`, `removed-c-message-rejected`, `forged-channel-and-event-rejected` |
| P3 | `runAttachmentLiveProof` | A, B | `send-attachment-a`, `resolve-attachment-b`, `attachment-invariants`, `aad-path-bind`, `over-limit-rejected` |
| P4 | `runPaymentHandoffLiveProof` | A, B | `build-payment-request`, `handoff-bind-amount`, `handoff-injection-closed`, `wallet-handoff-open`. Attach `openWalletUri` (Bitkit / `Linking.openURL` of the validated URI) to close the row. Dummy `proofData` hex does **not** mark P4 green. |
| P5 | `runBackupLiveProof` | A, B | `export-backup` (recovery code redacted), `wipe-local`, `restore-backup`, `assert-restored`, `assert-not-restored` |
| native | `runLinkLiveProof` | A, B | Optional diagnostic only. Payment proof payload is dummy hex. |

Programmatic dispatch: `runNamedLiveProofs({ homeserverPubky, signupTokenA, signupTokenB, signupTokenC, rows })`.

Cleanup: each product row closes links, removes markers, signs out, `clearAccountData` per owner, then `clearAllNativeSecrets`. That last call wipes **every** native Paykit secret on the device — run only on a throwaway simulator or a dedicated test account, never a device that holds a real identity. Logs go through `redactLiveProofForLog`.

## P7 harness (Maestro)

One suite, Maestro only. Requires a **debug / expo-dev-client** native build (`org.name.hypercolor` on iOS, `com.hypercolor` on Android). Release builds reject secret import, and the debug signup panel is `__DEV__` only. Do not drive Ring (P6).

Debug signup uses `signupWithSecret` / `signinWithSecret` and `provisionHarnessReceiver`, then the flow opens the product Enable Messaging screen and asserts **Already enabled** (it does not tap the enable action; the receiver is already provisioned). Account switch is the Profile debug panel — not `Disconnect pubky-ring` — so the previous party's homeserver receiver marker stays published for send/receive on one device.

Tokens are single-use staging signup tokens. Never commit them. Identity secrets are optional 64-char hex; if omitted the app generates them and the flow copies the values from `debugSignupPubky` / `debugSignupSecretValue`.

```bash
cd /Users/johncarvalho/work/hypercolor
maestro test .maestro/p7-product.yaml \
  -e HOMESERVER_PUBKY='<staging homeserver pubky>' \
  -e SIGNUP_TOKEN_A='<single-use>' \
  -e SIGNUP_TOKEN_B='<single-use>' \
  -e DM_BODY=maestro-p7-dm \
  -e PAYMENT_AMOUNT=0.001
```

Android: add `--app-id com.hypercolor` (or `-e APP_ID=com.hypercolor`). Optional: `-e IDENTITY_SECRET_A='<64 hex>'` and `-e IDENTITY_SECRET_B='<64 hex>'`. Same command: `npm run test:e2e` with those `-e` values forwarded, or invoke `maestro test` directly.

The suite: launch → debug signup A → Enable Messaging → switch to B → Enable Messaging → A adds B → B sends `DM_BODY` on ThreadScreen and a payment request for `PAYMENT_AMOUNT` → assert the bubble shows `{PAYMENT_AMOUNT} BTC` → switch to A → open the thread → assert the same DM body and amount.
