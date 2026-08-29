**Master Coding Plan (Cursor Plan Mode Style)**

This plan is designed so an AI coding agent can execute end-to-end with minimal ambiguity, preserve full ecosystem compatibility, and avoid architectural dead ends.

## 1. Product Contract (Must Not Break)
1. Legacy bitchat interoperability is non-negotiable.
2. Core wire format and mesh transport behavior stay unchanged.
3. Pubky features are additive overlays and must silently degrade.
4. Offline persistence is enabled by default, with clear user toggles.
5. Growth loop must prioritize easy friend invite/install/join flow.

## 2. Definition Of “Optimal” For This Project
1. Compatibility first, then feature depth.
2. Reuse official Pubky SDK primitives, avoid custom crypto/protocol inventions.
3. Add only dependencies with strong maintenance and clear value.
4. Keep architecture modular so Pubky can be disabled without regressions.
5. Ship in flags, with measurable outcomes and rollback paths.

## 3. Target Architecture (Final Form)
1. `Mesh Core` remains authoritative for realtime messaging.
2. `Pubky Identity Adapter` handles auth/session/public key identity.
3. `Pubky Discovery Adapter` adds homeserver/indexer metadata to peer discovery.
4. `Inbox Overlay` provides encrypted catch-up for offline misses.
5. `Trust Engine` computes soft scores from local + Pubky signals.
6. `Share Funnel` generates install/open/join links with resume context.
7. `Feature Flag Layer` gates all Pubky-dependent paths.
8. `Compatibility Layer` ensures legacy nodes ignore extension fields.

## 4. Dependency Strategy (Avoid Suboptimal Choices)
1. Use official Pubky SDK only.
2. JavaScript/TypeScript stack: prefer `@synonymdev/pubky`; avoid parallel unofficial wrappers.
3. Rust stack: prefer `pubky` crate from `pubky-core`.
4. Use existing project crypto library first; if absent, use a single mature library (no mixed crypto stacks).
5. No custom encryption primitives, no custom key formats.
6. Use strict schema validation at all boundaries.
7. Pin versions and lockfile; no floating major upgrades during rollout.
8. Add dependency ADR before merge for each new package.

## 5. Data + Protocol Contracts (Freeze Early)
1. Capability handshake extension.
2. Pubky storage schema v1.
3. Encrypted inbox envelope v1.
4. Trust signal schema v1.
5. Share link payload schema v1.
6. Telemetry event schema v1.

Minimal handshake shape (example):
```json
{
  "ext": {
    "pubky": {
      "v": 1,
      "caps": ["identity", "discovery", "inbox", "trust"]
    }
  }
}
```
Rule: legacy clients must ignore unknown fields and continue normal chat.

Pubky path schema v1 (app-scoped only):
1. `/pub/bitchat.app/v1/profile.json`
2. `/pub/bitchat.app/v1/discovery/<device-id>.json`
3. `/pub/bitchat.app/v1/inbox/<device-or-thread>/<cursor>.bin`
4. `/pub/bitchat.app/v1/state/<topic>.json`
5. `/pub/bitchat.app/v1/trust/<subject>.json`

## 6. Work Plan With Exit Criteria

### Phase 0: Discovery + Freeze
1. Audit current message pipeline, peer discovery, and identity/session handling.
2. Identify exact extension points and existing test coverage gaps.
3. Publish architecture decision records for adapters, inbox model, trust model, share model.
4. Exit criteria: approved ADR set, risk register, dependency list, test matrix baselined.

### Phase 1: Compatibility Harness First
1. Build golden tests for existing wire protocol and mesh behavior.
2. Add cross-version compatibility integration tests.
3. Add “legacy peer” simulator fixtures.
4. Exit criteria: baseline tests prove no behavior drift before Pubky code lands.

### Phase 2: Identity Adapter
1. Implement Pubky Ring auth flow.
2. Implement session lifecycle: signin, signup, signout, export, restore.
3. Bind app identity to stable Pubky identity without changing mesh IDs for legacy mode.
4. Add capability negotiation and local persistence rules.
5. Exit criteria: identity works with Pubky enabled/disabled and legacy chats remain unchanged.

### Phase 3: Discovery Adapter
1. Implement merged discovery aggregator: mesh local + Pubky data + optional indexer hints.
2. Add scoring strategy for discovered endpoints.
3. Ensure discovery failures never block mesh fallback.
4. Exit criteria: discovery quality improves when Pubky is available; zero regression when unavailable.

### Phase 4: Encrypted Catch-Up Inbox (Default On)
1. Implement envelope creation, upload, retrieval, ack cursor, dedupe.
2. Add per-room and global settings toggles.
3. Add retention policy and deletion/expiry behavior.
4. Add strict fallback: if inbox fails, realtime mesh still works.
5. Exit criteria: offline recipient receives missed messages after reconnect with no duplicate spam.

### Phase 5: Practical Trust Engine
1. Build soft trust score from local interactions, shared context, Pubky tags.
2. Apply only to sorting, request queues, and rate controls.
3. Do not hard-block base message delivery in v1.
4. Add explainability UI/debug reason codes.
5. Exit criteria: measurable spam-pressure reduction without user lockout complaints.

### Phase 6: Viral Share Funnel
1. Add invite link format with room context + optional ephemeral token.
2. Add platform deep links with install fallback and post-install resume.
3. Track conversion funnel events.
4. Exit criteria: friend can go from link to joined room with minimal friction and measurable conversion.

### Phase 7: Hardening + Rollout
1. Feature flags for each overlay capability.
2. Progressive rollout cohorts.
3. Kill switches for each major surface.
4. Incident runbook and rollback procedure.
5. Exit criteria: production rollout with controlled blast radius and stable metrics.

## 7. Test Plan (No Loose Ends)

### Unit Tests
1. Capability parsing and normalization.
2. Schema validation and migration.
3. Envelope encryption/decryption and integrity checks.
4. Cursor progression and dedupe logic.
5. Trust score determinism and bounds.
6. Link encode/decode and tamper handling.

### Integration Tests
1. Pubky auth flow success/failure paths.
2. Session export/restore across app restart.
3. PKDNS discovery resolution and stale update behavior.
4. Storage read/write/list/delete with expected permission boundaries.
5. SSE or event stream sync with cursors and reconnect behavior.

### Compatibility Tests
1. Upgraded client ↔ legacy client DM/chat interoperability.
2. Upgraded client with Pubky off ↔ upgraded client with Pubky on.
3. Unknown extension field handling by all peers.
4. Message ordering/ack behavior unchanged for legacy paths.

### E2E + Chaos Tests
1. Relay unavailable.
2. Homeserver unavailable.
3. Partial network partitions.
4. Duplicate deliveries.
5. Device clock skew.
6. Conflicting session refreshes.
7. Multi-device concurrent send/receive.

### Security Tests
1. Replay protection for inbox envelopes.
2. Malformed capability strings.
3. Unauthorized path writes.
4. Token leakage checks in logs.
5. Rate-limit and abuse scenarios.
6. Recovery and key-rotation flows.

## 8. CI Quality Gates (Blocking)
1. Lint/typecheck pass.
2. Unit/integration/compatibility suites pass.
3. Security checks pass.
4. Performance budget not exceeded on key paths.
5. Coverage thresholds on new modules.
6. No change to legacy wire snapshots unless explicitly approved.
7. Release notes and migration notes present.

## 9. Telemetry + Success Metrics
1. Compatibility fallback rate.
2. Inbox delivery success rate and median catch-up time.
3. Pubky auth success rate.
4. Discovery resolution latency and failure rate.
5. Share conversion funnel: sent → opened → installed → joined.
6. Trust false-positive indicators: hidden-but-wanted interactions.
7. Kill-switch activation frequency.

## 10. Rollout Strategy
1. Internal dogfood with full flags.
2. Beta cohort with identity + discovery.
3. Add inbox default-on for beta only.
4. Enable trust sorting next.
5. Enable share funnel broadly.
6. Maintain immediate rollback per feature flag.

## 11. AI Execution Protocol (For Any Coding Agent)
1. Never modify legacy wire behavior without explicit test updates and approval.
2. Implement one module at a time with tests in same change.
3. Add schema version + migration path for every persisted structure.
4. Treat all network dependencies as optional with fallback.
5. Fail closed for auth/capability parsing; fail open for compatibility fallback.
6. Document every public interface and edge case.
7. Do not merge if any checklist item is unresolved.

## 12. Sprint-Ready Backlog Template
1. Ticket must include objective, interfaces, data schema, failure modes, tests, and rollout flag.
2. Ticket must declare compatibility impact: none/low/high.
3. Ticket must declare dependency impact and ADR link.
4. Ticket must define explicit done criteria and telemetry events.