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
| CI | `npm run typecheck && npm run lint && npm test` on every push | Typecheck + lint + Jest green. Last counted: 30 suites / 281 tests. |
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
- Inbound from B auto-accepts (follow / mutual / prior routed conversation).
- Inbound from C lands in message requests and does **not** auto-accept. A unilateral Nexus follower bit must not open the gate.
- Optional Nexus: if staging Nexus is reachable, friends/followers import matches public graph; if not, record the skip and still prove the local WoT bits.

### P2 — Private groups (three-party)

- Three staging identities, pairwise Encrypted Links established.
- A creates a private channel; B and C receive membership via fan-out PAMs.
- A sends a group message; B and C persist the same body, authorized as active members.
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

- Add a Detox or Maestro suite (pick one; do not add both).
- Flows: launch → (debug signup or Ring) → enable messaging → send/receive a DM on the product screens → open a payment-request bubble and confirm the displayed amount matches the request.
- This is the ThreadScreen / navigation proof. Service-only live proofs do not close this row.

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
- `wotGate`: relationship-only auto-accept; no trust-score / unilateral-follower bypass.
- `applyGroupInbound`: authorize-before-persist, founder-bound ids, sender-scoped events, bounded deferral.
- Attachments: redaction, sender-bound location, size caps, AAD mismatch.
- Payments: CAS transitions, authorization, URI injection failures.
- Backup: snapshot exclusion list, AAD bind, restore without device secrets.
- `onchainAddress` SHA-256 used only for Base58Check.

New live-proof code needs Jest coverage of its step machine (same pattern as `liveProof.test.ts`) with a mocked native module — that does **not** replace the staging run.
