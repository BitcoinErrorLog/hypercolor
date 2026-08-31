# Product decisions (M6)

## QR / camera contact add

Contact add is **paste-only**. There is no in-app camera / QR scanner for
pubkys. Expo Camera and a QR permission surface were not added in this wave:
the contact-search screen already accepts a pasted pubky, and camera
permissions would expand the native surface without changing the official
messaging path. QR scan can return later as a UI convenience on top of the
same `ContactsService.add` path.

## exFAT relocation

The working tree lives on an exFAT volume. macOS writes AppleDouble `._*`
sidecar files next to real sources. ESLint ignores `**/._*` and Jest ignores
`/\\._` so those files are never treated as code. Do not “fix” a mysterious
parse error by editing a `._*` file.

## Key custody

Secrets do not live in JavaScript.

- App identity: delegated AppKey from Pubky Ring (`KeyStore`). The root
  Ed25519 secret is never held here.
- Encrypted Links: receiver Noise alias and session alias stay in the native
  Paykit module. Snapshots persist only as device-bound AEAD ciphertext.
- Attachments: content keys live in the OS KeyStore (`keyRef` is a handle).
- Backup recovery codes are shown once in Settings; they are not stored in
  SQLite or uploaded in the clear.

## Group fan-out

Private groups fan out one Encrypted Link PAM per member. There is no shared
group key. Membership changes do not re-key history. Public channels stay on
homeserver documents (`GroupService` public path). That choice is unchanged
from M3; M6 only adds `reply_to_author` on group messages so replies, like
reactions and edits, name the target author.

## Backup recovery code (not a passphrase)

`BackupService.exportBackup()` generates a random 32-byte key with
`PaykitLinkNative.generateAttachmentKey`, encrypts the snapshot with
`attachmentEncrypt`, and binds AAD to
`pubky://{owner}/pub/hypercolor.app/v1/backup/latest`.

A user-chosen passphrase was rejected: this stack has no vetted PBKDF2 /
scrypt without a new dependency, and iterating `expo-crypto` digests would be
hand-rolled stretching. The recovery code is the backup key. Write it down or
store it in Ring.

**Restores:** contacts, message requests, link message history (plaintext
bodies already on this account), read cursors, group channels / members /
messages, payment requests, tip endpoints, attachment **metadata**.

**Does not restore / must re-establish:** receiver Noise alias, session
alias, link snapshots, attachment content keys and cached files. After
restore the device re-enables messaging and re-handshakes. Attachments
without keys render as `unavailable-from-backup` until the sender re-shares.

## Notification strategy

See `docs/NOTIFICATIONS.md`. v1 is foreground SSE/poll drain. Background
fetch is not implemented. Push is an opt-in content-free waker (future).

## Mesh transport (deferred)

`MeshService` and `modules/mesh-transport` stay in the tree but
`FeatureFlags.mesh_transport` defaults **off**. Mesh was the research-era
delivery path. Re-integration over Encrypted Links is future work. Do not
delete the module.

## Research-era stack (retired)

`MessageRouter`, `EnvelopeService`, `SSESubscriptionManager`, and
`messageStore` are removed. `PubkyService` no longer publishes outbox
envelopes or KeyBindings. DMs use `LinkService` + `link_messages`. Schema
v13 drops `threads`, `messages`, `channels`, `channel_members`, and
`cursor_state`. `delivery_queue` stays — it is the live nonce-safe retry
queue for Encrypted Links and group fan-out.

## TODO / FIXME sweep

A sweep of `src/` (excluding tests) found no leftover `TODO`, `FIXME`, or
stub markers. Open product deferrals are listed above (camera QR, background
fetch, push waker, mesh re-integration).

## Group accept gate — planted-channel residue (F-001 waiver)

`5110e24` closed a live bug: a peer whose message request was still
`pending` could unilaterally create and name group channels and add the
recipient to a roster. An external audit asked for a schema-v14 cleanup
migration to purge `group_channels` / `group_members` / `group_messages`
planted on installs that ran the vulnerable build.

That migration is **not** shipping. Residual risk holder: any device that
ran a build of this app from before `5110e24` (the gate) and still has
that SQLite file.

Why that is acceptable today: the app is pre-release. No real user has
run the vulnerable build. The only devices that did are our own test
devices, which get wiped.

The waiver ends the moment any build that lacks the gate reaches a real
user. At that point planted-channel residue is a live user-data problem
and a cleanup migration (or an equivalent one-shot purge of channels the
local owner did not create and did not accept via an accepted peer) is
required before calling the install clean.

## Decline vs group history

Decline is a 1:1 message-request action. The Message Requests UI labels
the row "Inbound message request" and the button "Decline". It does not
claim to remove the peer from groups or to erase group history.

On decline the app therefore:

- wipes the Encrypted Link, held `link_stream_items`, and 1:1
  `link_messages`;
- deletes that sender's `group_deferred_events` so a later matching
  target cannot promote declined-peer reactions/edits/deletes into
  `group_messages`;
- deletes that sender's `group_seen_events` markers.

Already-persisted `group_messages` in channels the recipient already
knows **stay**. Co-membership is its own trust context (see
`requiresAcceptedPeer`): content that was authorized against the
recipient's own roster rows is group history, not a held DM. Deleting it
on decline would contradict the button the user tapped.

`5110e24`'s commit message claimed no `group_channels`, `group_members`,
`group_messages` or `group_seen_events` rows survive a decline. That is
true for the stranger-exploit shape (gated create never applied). It is
false for a pending co-member who already posted in a shared channel:
those `group_messages` remain, by the decision above.

## Held-peer unprocessed stream cap

A never-accepted, never-declined peer can flood group envelopes for
random `channel_id`s. Those rows stay unprocessed (the accept-replay
mechanism) and were previously unbounded.

`LINK_HELD_UNPROCESSED_CAP_PER_PEER` keeps the oldest N unprocessed rows
per peer and marks the rest processed. Oldest-first preserves a
create-then-content invite under a later flood. Newest-first would evict
the create and break accept replay of a legitimate batch.

## Kimi B1 re-audit close-out (6761c11, verdict SHIP)

The durable `link_handshake_budgets` fix closed blocking finding B1
(budget reset via link-row deletion). Three non-blocking observations
are waived here in writing:

**Established-cycle semantics (observation).** A peer who honestly
completes a full Noise XX handshake each cycle can alternate
complete -> malformed message -> wipe -> re-adopt with zero budget
accumulation. Waived: identical to v14 semantics, each cycle costs the
attacker a real completed handshake, and defender work is paced by the
defender's own timers. B1's attack (farming free wipes without ever
completing) is closed.

**v14 -> v15 amnesty (observation).** Peers with accumulated v14
charges get one fresh 10-step allowance because the old columns are
dropped without carrying values over. Waived: bounded, happens exactly
once, cannot be repeated (the columns no longer exist and the table is
never auto-seeded), and pre-release there are no hostile peers with
accumulated budgets.

**Policy comment overstatement (nit).** The comment near the `user`
intent gate says the clear happens "before anything else"; the
live-handle dispatch actually precedes it. Unreachable as a bug today
(an exhausting charge always wipes the live handle in the same queued
call). Left as-is to avoid churn on an audited SHA; correct the comment
on the next substantive edit of that region.

**Accept-does-not-clear (nuance, kept by design).** Tapping Accept on
an exhausted peer's request routes through the background sync path and
does not clear exhaustion; the user must also send something. Kept:
accepting reveals intent to read, sending reveals intent to engage, and
only the latter should refund an abuse budget.
