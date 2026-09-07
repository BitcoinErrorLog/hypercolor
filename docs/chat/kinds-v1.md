# Hypercolor chat kinds v1.1

Wire contract for Encrypted-Link PAMs, identical on mobile (`hypercolor-ux-int`) and web (`hypercolor-web-ux-w4a`). Transport cap: `LINK_MESSAGE_MAX_BYTES = 1000` UTF-8 of `JSON.stringify` (mobile `src/types/link.ts:175`; web `link.ts:129`). Authorship is the Noise-authenticated link peer — never a field the sender can spoof (`group.ts:26–28`). Unknown kinds: store on `link_stream_items`, leave unprocessed, never skip the native checkpoint (mobile `link.ts:21–24`, `143–145`; web `97–99`; persist-before-snapshot `LinkService.ts:882–886`). Oversized **known** kinds: consume/seen, do not persist (mobile `inboundEnvelope.ts:21–32`; web `23–34`). Malformed **known group** kinds: reject, mark processed (`group.ts:67–69`). Known-inbound gate today (mobile `inboundEnvelope.ts:10–18`; web `12–20`): `chat.message.v0`, `pubky_app.dm.v0`, `chat.attachment.v0`, Paykit payment kinds (`payment.ts:14–28`), `GROUP_WIRE_KINDS`. Reserved unused: `chat.receipt.v0`, `chat.reaction.v0` (mobile `link.ts:129–133`; web `83–87`). Group: `chat.group.message.v0` with additive `reply_to` / `reply_to_author` (`group.ts:236–246`); `chat.group.reaction.v0` emoji trim length 1–32 UTF-16 code units, send-side only (`group.ts:668–669`; web `523–524`); edit/delete/membership/public message as today. Attachments: `chat.attachment.v0`, 8 MiB + 256 KiB thumb (mobile `flags/config.ts:90–93`; web `62/65`). GIFs: same attachment kind (`image/gif`); no URL kind; provider proxy out of scope. `contentType` is sender-asserted — renderers sniff bytes, do not trust the string. No presence. Pubky App `/pub/pubky.app/tags/` and EmojiPicker are UX-only; they are **not** this contract.

**Envelope versioning.** `kind` carries the schema (`*.v0`). Envelope field `version` is always `1` for v0 kinds. A future `chat.tag.v1` is an **unknown kind** to v0 clients (stream + unprocessed). Extra JSON keys on a known kind: ignore. Missing required keys / wrong types: malformed.

**Shared types.** UUID = `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. Pubky = 52 chars. `sent_at` = positive Unix ms (`isLinkSentAtUnixMs`). `channel_id` = founder-bound `{52}:{uuid}`. Dedup DM: `(owner_pubky, sender_pubky, kind, event_id)` (`link.ts:146–147`). Dedup group: `(owner_pubky, channel_id, sender_pubky, event_id)` (`group.ts:37–38`). Display order: `sent_at`, tie-break `event_id`. Replay of the same dedup key → ignore. Forgery: peer identity is the link; a JSON `author` field is never trusted. UTF-16 mention offsets are the v1 JS/RN/web contract; a future Kotlin/Swift client must use UTF-16 code units, not UTF-8/grapheme indices.

**Device prefs** (not on the wire): `receipts_enabled` default **on**, `typing_enabled` default **on**, per device. Off → do not emit; still accept inbound (except typing UI is suppressed if typing pref off).

**Emit gating (pre-v1 peers).** Send `chat.typing.v0` / `chat.receipt.v0` only to peers whose client is known to be v1 (advertise via an additive field on an existing PAM or the receiver marker). `chat.tag.v0` / `chat.pin.v0` may be emitted ungated (dual-write covers tags). Invites/edits/deletes follow their own routing.

**Advertisement (R7).** Both apps PUT an additive top-level integer `chat_kinds_v` on `receiver.json` (`/pub/paykit.app/v0/receiver.json`). Value `1` means this client implements kinds v1. Absent or `0` is pre-v1. The field is additive: parsers ignore unknown keys on the marker document. Store the peer's `chat_kinds_v` on the local link row when the marker is fetched (including re-key refresh). Emit typing/receipts only when the stored value is `>= 1`. When it flips `0→1`, replay `chat.receipt.v0` for currently-read threads once (idempotent).

**Upgrade replay.** Pre-v1 clients treat new kinds as unknown → persist on `link_stream_items`, never mark processed (`LinkService.ts` `if (!envelope) continue`). On first v1 launch, record local `upgrade_at` (Unix ms) and re-scan unprocessed stream. Per-kind apply:

| Kind | Replay |
|---|---|
| `chat.typing.v0` | Discard; never apply. Inert if `now − sent_at > 5 s`; still discard even if fresh (upgrade is not a live viewport). Mark processed. |
| `chat.receipt.v0` | Apply idempotently / monotonically (`sent`→`delivered`→`read`); unknown `event_ids` ignored. Mark processed. |
| `chat.tag.v0` | Apply idempotently by semantic PK (NFC `label`). Invalid labels → processed, no row. Mark processed. |
| `chat.pin.v0` | Ignore if `sent_at < upgrade_at` (stale pin from old-client era). Else LWW vs stored row. Mark processed. |
| `chat.edit.v0` / `chat.delete.v0` / `chat.group.invite.v0` | Apply with the same parsers as live inbound (stored-compare / redaction / pending invite). Mark processed. |

Implementations MAY purge processed-or-stale stream items older than 30 days.

**Gated peers.** Same as DM content: PAMs from `gated` (pending message-request) peers are persisted but not routed (`persistInboundWithoutRouting`). Applies to invite, tag, receipt, typing, pin, edit, delete. Outcome `gated-peer`. Receipts to a gated author are lost, not leaked.

---

## Kind contracts

Common required: `version: 1`, `kind`, `event_id` UUID, `sent_at`. Omit `channel_id` for 1:1; include founder-bound `channel_id` for private groups (fan-out as today). Group-scoped receipts/tags/typing/pins require an **active member** (`senderMember?.status === 'active'`), same gate as group content.

### `chat.tag.v0` (new; private chat, not homeserver tags)

```
{ version:1, kind:"chat.tag.v0", event_id, sent_at, target_event_id, target_author_pubky,
  label, op:"add"|"remove", channel_id? }
```

- `label`: NFC trim; one emoji grapheme cluster **or** `/^[a-z0-9_]{1,32}$/`; UTF-8 ≤ 32 bytes. (The legacy group-reaction cap is 32 UTF-16 code units, send-side only — a different, looser bound.) Empty / whitespace / mixed “word+emoji” / uppercase words → `invalid-label`. Persist the NFC-normalized label in the PK.
- `op`: add is idempotent per `(owner, scope_key, target_author, target_event_id, tagger=sender, label)`. Remove deletes that row only.
- Authority: any **active member** of the group / any peer on the DM link. Tagger **is** `senderPubky`. Target must be a stored non-tombstoned message (or deferred like group reactions, quota+TTL).
- Storage: `chat_tags` rows. Not message history. Group tags are visible to the whole roster (fan-out).
- UI: aggregate counts by `label` under the bubble. Word tags = text chips; emoji = native glyph.
- **Alias:** inbound `chat.group.reaction.v0` ≡ `op:add` with `label=emoji`. Inbound `chat.reaction.v0` (reserved DM) same without `channel_id`. A legacy reaction whose `emoji` fails label validation is kept as a legacy reaction row and produces no `chat_tags` row. Emit dual-write for one release: group senders emit **both** `chat.group.reaction.v0` and `chat.tag.v0` (**different** `event_id`s; dedup tags by semantic key not event_id). After both apps ship, stop emitting `chat.group.reaction.v0`. During the dual-write window, tag removals are invisible to pre-v1 clients (reactions have no remove); this is accepted and ends when dual-emit stops. Do not PUT `/pub/pubky.app/tags/`.
- Byte proof: typical add **268 B** (👍). Worst label 32× `w` + `channel_id` = **401 B** ≪ 1000.

### `chat.receipt.v0` (activate reserved kind)

```
{ version:1, kind:"chat.receipt.v0", event_id, sent_at, status:"delivered"|"read",
  event_ids: UUID[], channel_id? }
```

- `event_ids`: 1–16 unique UUIDs, sorted ascending for canonical JSON. Cap **16** so 16 + `channel_id` stays under 1000 (20 ids, no channel = **927 B**; 16 + channel = **876 B**). Unknown / missing target ids: ignore silently; apply the rest.
- Semantics: `delivered` = PAM decrypted+persisted; `read` = message drawn in an active transcript viewport on a device with receipts **on**. Batch by conversation. `read` implies `delivered`.
- Authority: any link peer (groups: active member); **cannot** receipt your own `event_id`s (`wrong-author` if all ids are self; drop self ids otherwise).
- Storage: update `link_messages.delivery_state` / `group_messages.delivery_state` (`sent`→`delivered`→`read`). Do not insert a transcript row. Monotonic: never downgrade `read`→`delivered`.
- UI: double-check only if prefs on; never show other members’ receipts in groups — **group receipts are 1:1 to the author only** (send receipt PAM only on the author’s link, not fan-out). DMs: send on the one link.
- Byte proof: 12 ids **615 B**; 16 ids no channel **771 B**.

### `chat.typing.v0`

```
{ version:1, kind:"chat.typing.v0", event_id, sent_at, state:"start"|"stop", channel_id? }
```

- Ephemeral: **never** insert SQLite. In-memory map keyed by `(peer, channel?)`, expire **5 s** after `sent_at` or on `stop`/own send. Coalesce emit ≥2 s.
- Authority: link peer; groups: active member, fan-out to members except self. Pref off: do not emit; ignore for UI.
- Byte proof: DM **127 B**; group **232 B**.
- Unknown `state` → malformed (`invalid-state`).

### `chat.edit.v0` / `chat.delete.v0` (DM; groups keep `chat.group.edit.v0` / `chat.group.delete.v0`)

Edit: `{ version:1, kind:"chat.edit.v0", event_id, sent_at, target_event_id, body }`  
Delete: `{ version:1, kind:"chat.delete.v0", event_id, sent_at, target_event_id }`

- Authority: **author only** = `senderPubky === target message sender` (`group.ts:53–55` pattern). Wrong sender: reject + mark processed.
- Edit: `body` trim non-empty; serialized envelope ≤1000. Cannot edit tombstones or attachments/payment PAMs (`not-editable`). Mentions on edit replace the message’s mention list (optional `mentions`, same schema as message).
- LWW compare is against the stored value: apply an edit only if `edit.sent_at > COALESCE(target.edited_at, target.sent_at)`; apply a pin only if `pin.sent_at > stored_pin.sent_at` (or no row). For all LWW kinds (`chat.edit.v0`, `chat.pin.v0`), reject as `bad-sent-at` any `sent_at` more than **5 minutes** ahead of the receiver's local clock. Group `chat.group.edit.v0` keeps today's arrival-order application (single ordered author→owner link makes it safe) and is out of scope for this clamp.
- Delete = **unsend tombstone**: set `deleted=1`, replace `body` with `""`, `raw_json` redacted to `{kind,event_id,sent_at,deleted:true}` locally. The same redaction MUST be applied to every `link_stream_items` row matching `(owner, peer, raw_json)` for the target event, and any `delivery_queue` item for the target `(owner, sender, kind, event_id)` MUST be deleted (a queued unsent message is unsent by cancelling the queue item, not by tombstoning after send). Peers do the same on inbound delete. UI: “Message unsent”.
- **Attachments:** keep ciphertext on homeserver (no delete API required; authenticated DELETE of own `/pub/…/attachments/{uuid}` is best-effort optional). Wipe KeyStore key/nonce for that `event_id` (`attachment.ts:17–21`, `100–102`; `KeyStore.deleteAttachmentSecretByService`). Set `AttachmentResolveState` to **`unavailable-from-backup`** (existing enum: `'pending'|'uploading'|'resolving'|'ready'|'failed'|'unavailable-from-backup'` — `attachment.ts:34–40` both repos). Decision: reuse the existing value rather than add `'unavailable'`; unsend wipe and backup-without-keys are the same decrypt-impossible state. Peers must KeyStore-wipe on inbound delete.
- Payment proofs: **not deletable** (`not-deletable`); edit of a payment-only PAM: reject.
- Storage: update target row; store the edit/delete event in stream (processed). Group: existing kinds; do not also emit DM kinds inside groups.
- Byte proof: delete **168 B**; edit 700-char body **876 B**.

### `chat.message.v0` additive fields (and `chat.group.message.v0` already has reply)

```
body, reply_to?, reply_to_author?, mentions?, forwarded_from_event_id?, forwarded_from_author?,
forwarded_from_channel_id?
```

**Reply.** `reply_to` = parent `event_id`; `reply_to_author` = 52-char pubky (group already; DB `reply_to_author_pubky` v13 — mobile `schema.ts:215`; web `schema.ts:21`). Both required together. **Quoted excerpt: never on the wire.** Parent plaintext is loaded locally by `(author, event_id)`. If missing/tombstoned, UI shows “Original message unavailable”. Reasons: (1) 1000 B budget; (2) edit/delete would desync a frozen quote; (3) quote would copy attachment captions / payment text into a second PAM; (4) forwards must not amplify body. Older group peers may omit `reply_to_author` (`group.ts:244–245`); v1 senders **always** set both.

**Mentions: structured, not text-only.** `mentions: [{ pubky, start, end }]` — `start`/`end` are **UTF-16 code-unit** offsets into `body` (JS/RN `String.length`), `0 ≤ start < end ≤ body.length`, max **8**, no overlap, `pubky` 52 chars; `start`/`end` are post-trim offsets (builders trim, mobile `link.ts:211`; web `153`) and must not split a UTF-16 surrogate pair. NFC caution: iOS/Android IMEs can emit NFD; measure offsets on the same string that is serialized. Invalid span → `invalid-mentions` (whole envelope malformed). Budget: base envelope + reply pair + 8 mentions ≈ 922 B, leaving ≤ ~78 UTF-8 bytes of body; senders MUST enforce the serialized total ≤ 1000 B (builders already throw, `link.ts:224–228`). Text-only `@name` is forgeable; highlight uses `mentions[]` only.

**Forward (citation, not a new kind).** Optional `forwarded_from_*`. No nested body. UI: “Forwarded”. Strip mentions/reply from the source; new `event_id`. Group→DM allowed; public-channel → private **forbidden** (`cross-context`). `forwarded_from_channel_id` omitted for DM sources.

### `chat.pin.v0`

```
{ version:1, kind:"chat.pin.v0", event_id, sent_at, target_event_id, target_author_pubky,
  op:"set"|"clear", channel_id? }
```

- DM: either peer. Group: **active admin** only (`GroupMemberRole`, `group.ts:101`). Target must exist and not be deleted **on `set`**. On `clear`, `target_event_id` / `target_author_pubky` are **required on the wire but ignored on apply** (clear is conversation-scoped).
- LWW: one pin per conversation; stored-compare + 5-minute `sent_at` clamp (see edit section).
- Storage: `chat_pins` one row per `(owner, scope_key)`.
- Byte proof: **253 B** + channel ≈ **358 B**.

### `chat.group.invite.v0` (not a bearer URL)

**Decision: PAM only.** Do **not** put a capability token in `hypercolor://` query strings.

```
{ version:1, kind:"chat.group.invite.v0", event_id, sent_at, channel_id, invite_id,
  name, expires_at }
```

- `invite_id`: UUID (same pattern as `event_id`). Validation failures map to: `bad-event-id` (`invite_id`), `invalid-label` (`name` >64 NFC or empty), `bad-sent-at` (`expires_at` window violated vs `sent_at`), `expired` (`expires_at ≤` receiver now).
- `name` ≤64 NFC; `expires_at` Unix ms, 1h–7d ahead of `sent_at`.
- Authority: sender is active **admin**; send **only** on the invitee’s 1:1 link (not group fan-out). The receiver cannot verify “sender is active admin” for a channel it has never seen — already handled by making the invite non-authoritative (membership `add` remains the capability). Admin check applies only when the receiver already knows the channel. Receiver stores pending invite; **join still requires** existing `chat.group.membership.v0` `add`.
- Deep link `hypercolor://join-private?channel={channel_id}` is an **id locator** (same idea as `hypercolor://join-public`, `group.ts:73–74, 203–204`). Without a matching live invite PAM + membership add, it is inert.
- Threat: URL bearer would leak via screenshots, logs, and OS share sheets; PAM is bound to Noise peer. No shared group key (`group.ts:16–20`) so a token cannot confer cryptographic membership anyway.
- Byte proof: 64-char name **374 B**.

**Routing (do not use `GROUP_WIRE_KINDS`).** `src/types/group.ts`: add `GROUP_INVITE_KIND='chat.group.invite.v0'`. Do **not** add it to `GROUP_WIRE_KINDS` / `isGroupWireKind` (that routes through `decodeGroupEnvelope`, which has no invite case and would drop it — `default: return null` → `'settled'`). Handle invite like attachment/payment: peek-first branch in `routeUnprocessedStreamItems` before the group branch. `inboundEnvelope.ts isKnownInboundChatKind`: add the six link kinds + `GROUP_INVITE_KIND` explicitly. Invites from `gated` peers are held with the message request (same rule as DM content); invites only apply from `accepted` peers.

---

## Shared validation layer

One function per kind: `parseChatTagV0(raw, ctx) → { ok: envelope } | { error: Reason }`. `ctx = { senderPubky, ownerPubky, peerTrust }`. Exhaustive `Reason`:

`not-json` · `oversized` · `unknown-kind` · `wrong-kind` · `bad-version` · `bad-event-id` · `bad-sent-at` · `bad-channel-id` · `bad-target-id` · `bad-pubky` · `invalid-label` · `invalid-op` · `invalid-status` · `invalid-event-ids` · `event-ids-cap` · `invalid-state` · `empty-body` · `invalid-mentions` · `reply-fields-mismatch` · `cross-context` · `wrong-author` · `not-member` · `not-admin` · `not-editable` · `not-deletable` · `gated-peer` · `expired`

Apply **after** `shouldDropOversizedKnownInbound`. New kinds listed in `isKnownInboundChatKind`. Malformed known → processed, no history. `unknown-kind` → unprocessed stream. Group content still uses `requiresAcceptedPeer` (`group.ts:336–347`).

**Registry diff (both repos)**

`src/types/link.ts`: keep `CHAT_RECEIPT_KIND`; add `CHAT_TAG_KIND='chat.tag.v0'`, `CHAT_TYPING_KIND='chat.typing.v0'`, `CHAT_EDIT_KIND='chat.edit.v0'`, `CHAT_DELETE_KIND='chat.delete.v0'`, `CHAT_PIN_KIND='chat.pin.v0'`. Keep `CHAT_REACTION_KIND` as decode alias only. Extend `LinkWireKind` to include tag/receipt/typing/edit/delete/pin (typing still “known” for size-drop).

`src/types/group.ts`: add `GROUP_INVITE_KIND='chat.group.invite.v0'`. Reaction builders unchanged (compat emit). **Do not** put invite in `GROUP_WIRE_KINDS`.

`src/services/link/inboundEnvelope.ts` `isKnownInboundChatKind`: add the six link kinds + `GROUP_INVITE_KIND` **explicitly** (not via `isGroupWireKind`). Peek-route invite before `routeGroupStreamItem`.

---

## DB (do not rewrite frozen migrations)

Web `CURRENT_VERSION = 13` (`migrations.ts:36`). Mobile already **v17** (`migrations.ts:48–49`). Mobile v14–v17 are handshake / group fan-out + `blocked_peers` / invoice (v16 = fan-out outcomes + blocked peers, v17 = own-invoice hashes — `schema.ts:16–20`). Chat tables:

| Platform | Next versions |
|---|---|
| web | v14 prefs+tags+pins+invites; v15 DM `link_messages` reply/forward/mentions columns |
| mobile | **v18** same SQL as web v14; **v19** same as web v15 |

Idempotent: `CREATE TABLE IF NOT EXISTS`; `ADD COLUMN` guarded by `pragma table_info` (web `migrations.ts:67–71`) or duplicate-column catch (mobile `migrations.ts:298–311`). Mobile post-loop CREATE replay stays **V16/V17 only** (`migrations.ts:106–115`). v18/v19 rely solely on `IF NOT EXISTS` in the version loop — they do not join the every-launch block (those tables are new; replaying ADD COLUMN every launch is unnecessary).

```
CREATE TABLE IF NOT EXISTS chat_device_prefs (
  owner_pubky TEXT NOT NULL PRIMARY KEY,
  receipts_enabled INTEGER NOT NULL DEFAULT 1,
  typing_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_tags (
  owner_pubky TEXT NOT NULL,
  conversation_id TEXT,
  channel_id TEXT,
  scope_key TEXT NOT NULL,   -- channel_id when present else conversation_id ('dm:{peer}')
  target_event_id TEXT NOT NULL,
  target_author_pubky TEXT NOT NULL,
  tagger_pubky TEXT NOT NULL,
  label TEXT NOT NULL,       -- NFC-normalized
  created_at INTEGER NOT NULL,
  CHECK ((channel_id IS NULL) != (conversation_id IS NULL)),
  PRIMARY KEY (owner_pubky, scope_key, target_author_pubky, target_event_id, tagger_pubky, label)
);
CREATE TABLE IF NOT EXISTS chat_pins (
  owner_pubky TEXT NOT NULL,
  conversation_id TEXT,
  channel_id TEXT,
  scope_key TEXT NOT NULL,
  target_event_id TEXT NOT NULL,
  target_author_pubky TEXT NOT NULL,
  pinned_by TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  CHECK ((channel_id IS NULL) != (conversation_id IS NULL)),
  PRIMARY KEY (owner_pubky, scope_key)
);
CREATE TABLE IF NOT EXISTS chat_group_invites (
  owner_pubky TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  sender_pubky TEXT NOT NULL,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (owner_pubky, invite_id)
);
```

Writers: `scope_key = COALESCE(channel_id, conversation_id)`. SQLite PKs are column lists only — no `IFNULL(...)` expressions.

`link_messages` / `group_messages`: add `reply_to_event_id`, `reply_to_author_pubky` (group already v13), `forwarded_from_event_id`, `forwarded_from_author`, `forwarded_from_channel_id`, `mentions_json`, `deleted` (DM; group has `deleted` v8), `edited_at` (DM).

---

## Threat table

| Threat | Why it matters | Mitigation |
|---|---|---|
| Tag spam | Anyone on the link can add 32 B labels | Per-tagger cap 20 live tags/target; 100 tags/min; duplicate PK; word charset |
| Receipts as read-beacon | `read` proves viewport attention; group fan-out would tell every member | Opt-in default on but **device**; group receipts only to **author’s** 1:1 link; pref off = no emit |
| Typing as presence oracle | `start` ≈ online | No presence kind; 5 s TTL; not stored; pref off; 2 s coalesce; emit only to known-v1 peers |
| Future-`sent_at` LWW wedge | `isLinkSentAtUnixMs` allows `8.64e15` | Reject LWW `sent_at` > now+5 min; compare vs stored `edited_at` / pin `sent_at` |
| Edit after payment proof | Rewrite chat next to `paykit.payment_proof` | Proof PAM `not-editable`/`not-deletable` |
| Delete of attachment key | Unsend must stop decrypt | Tombstone + KeyStore wipe + stream/queue redaction; ciphertext may remain at `/pub/…/attachments/` |
| Mention injection | Fake `@alice` in body | Structured spans only; no surrogate-split; highlight uses `mentions[]` |
| Invite token leak | Bearer URL = world capability | No token; PAM to Noise peer; membership `add` remains source of roster |
| Upgrade replay of held PAMs | Pre-v1 stores unknown kinds forever | Per-kind replay table; typing discarded; pins skipped if `sent_at < upgrade_at` |

---

## Byte proofs (Node, `TextEncoder` UTF-8 of `JSON.stringify`)

```
node -e '
const enc = s => new TextEncoder().encode(s).byteLength;
const J = o => enc(JSON.stringify(o));
const uuid = "01234567-89ab-cdef-0123-456789abcdef";
const pk = "a".repeat(52);
const ch = pk + ":" + uuid;
const ts = 1757000000000;
const tagDm = {version:1,kind:"chat.tag.v0",event_id:uuid,sent_at:ts,target_event_id:uuid,target_author_pubky:pk,label:"👍",op:"add"};
const rcpt = n => ({version:1,kind:"chat.receipt.v0",event_id:uuid,sent_at:ts,status:"delivered",event_ids:Array.from({length:n},()=>uuid)});
const typing = {version:1,kind:"chat.typing.v0",event_id:uuid,sent_at:ts,state:"start"};
const del = {version:1,kind:"chat.delete.v0",event_id:uuid,sent_at:ts,target_event_id:uuid};
const edit = {version:1,kind:"chat.edit.v0",event_id:uuid,sent_at:ts,target_event_id:uuid,body:"x".repeat(700)};
const pin = {version:1,kind:"chat.pin.v0",event_id:uuid,sent_at:ts,target_event_id:uuid,target_author_pubky:pk,op:"set"};
const invite = {version:1,kind:"chat.group.invite.v0",event_id:uuid,sent_at:ts,channel_id:ch,invite_id:uuid,name:"n".repeat(64),expires_at:ts+604800000};
const mention = {pubky:pk,start:0,end:5};
'
```

Literal output (re-run 2026-09-05):

```
tag add 👍 DM: 268
tag worst 32xw + channel: 401
receipt 12 ids DM: 615
receipt 16 ids + channel: 876
receipt 20 ids no channel: 927
receipt 16 ids no channel: 771
receipt 17 ids + channel: 915
typing DM: 127
typing group: 232
delete: 168
edit 700-char body: 876
pin DM: 253
pin + channel: 358
invite 64-char name: 374
one mention object: 82
message + reply pair + 8 mentions (body 5): 927
```

Every kind is under 1000 B. Cap-16 for receipts kept for headroom (17 ids + channel = 915 B).

---

## Test vectors (all kinds)

**Valid.** Minimal UUID/sent_at fixtures; tag `label:"ok"` / `👍`; receipt 1 and 16 ids; typing start/stop; edit body `"hi"`; delete; message with reply pair + 1 mention; pin set/clear; invite with future `expires_at`.

**Oversized.** Known kind JSON 1001 B → drop (mobile `inboundEnvelope.ts:26–32`; web `28–35`). Receipt 17 ids → `event-ids-cap` (malformed, processed).

**Malformed.** Bad UUID; `reply_to` without author; overlapping mentions; surrogate-splitting `start`; `label:"OK"`; `status:"seen"`; typing `state:"idle"`; invite `invite_id` not UUID; extra-only unknown kind `chat.foo.v0` → unprocessed.

**Wrong-author.** Peer B edits A’s `target_event_id`; B deletes A; B pins as non-admin; B receipts only B’s own ids; invite from non-admin (when channel known).

**LWW / freshness.** Older `sent_at` edit after newer stored `edited_at` → ignore. Pin `sent_at` > now+5 min → `bad-sent-at`. Duplicate `(owner,sender,kind,event_id)` → one apply. Tag add twice → one row.

Implement parse+apply tests in both apps against this file; do not diverge field names.

---

## Changelog — v1.1 vs v1

| # | Change | Spec sections |
|---|---|---|
| R1 | Invite **not** in `GROUP_WIRE_KINDS`; peek-route + explicit `isKnownInboundChatKind`; gated-peer hold | Invite routing; registry diff; Device prefs / gated peers |
| R2 | Ship `scope_key TEXT NOT NULL` PKs; drop `IFNULL` PK; CHECK exactly one of channel/conversation; NFC label in PK | DB |
| R3 | Unsend also redacts `link_stream_items` and deletes `delivery_queue` for the target | `chat.delete.v0` |
| R4 | Stored-compare LWW; `sent_at` clamp = receiver now + **5 minutes** for edit/pin; group edit out of scope | `chat.edit.v0` / `chat.pin.v0` |
| R5 | Label cap is UTF-8 32 B (legacy reaction is UTF-16 32, send-side); invalid alias emoji stays reaction-only; remove not back-compat during dual-write | `chat.tag.v0` |
| R6 | Post-trim offsets; no surrogate-pair split; headroom ≤ ~78 B body with full mentions+reply (927 B measured) | Mentions |
| R7 | Emit-gate typing/receipts to known-v1 via `receiver.json` `chat_kinds_v`; upgrade-replay table (typing discarded by age; receipts/tags idempotent; pins skipped if `sent_at < upgrade_at`); 30-day stream purge MAY | Device prefs / Advertisement / Upgrade replay |
| R8 | `invite_id` = UUID; reasons `bad-event-id` / `invalid-label` / `bad-sent-at` / `expired`; admin check only if channel known | `chat.group.invite.v0` |
| R9 | Byte proofs: tag worst **401**, receipt 16+ch **876**, pin+ch **358**; Node one-liners + literal output | Byte proofs; each kind’s proof line |
| R10 | Unsend uses existing `AttachmentResolveState` **`unavailable-from-backup`** (do not invent `'unavailable'`) | `chat.delete.v0` attachments |
| R11 | Citations re-verified: web flags `62/65`; web schema v13 `schema.ts:21`; web inboundEnvelope `12–20` / `23–34`; mobile v16 = fan-out + `blocked_peers`. All other v1 cites still exact on mobile. | Intro; DB; reply; oversized tests |
