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
