# Hypercolor mobile feature exposure

Every shipped service/capability vs how (or whether) the UI exposes it. Entry classes: **Entry** (primary nav), **Empty-state CTA**, **Composer action**, **Settings-only**, **Hidden/none**. Settings-only and Hidden are gaps.

## Exposure matrix

| Capability | Service / owner | UI file(s) | Entry | Empty-state CTA | Composer | Settings-only | Hidden | Notes |
|---|---|---|---|---|---|---|---|---|
| Encrypted Link DMs (send/receive) | `src/services/link/LinkService.ts` (`sendDm`, `syncInbox`, `getLinkMessagesForConversation` via `StorageService`) | `src/screens/main/ChatsScreen.tsx`, `src/screens/main/ThreadScreen.tsx` | Chats tab + thread | Empty copy “Search for a contact…” is **text only** — no button. Header `+` goes to Find Contact | Thread composer Send | No | | Requires messaging session (`hasSession` / `KeyStore.getLinkSession`). Else CTA to Enable Messaging |
| Enable Encrypted Links (Ring `pubkyauth` grant) | `LinkService.enable` / `getEnableStatus`; controller `src/screens/main/enableMessagingController.ts` | `EnableMessagingScreen.tsx`, `EnableMessagingCta.tsx`, Settings Messaging row | Chats/Thread CTA when disabled; Settings | CTA card on empty Chats | — | Also Settings | | Welcome `paykit-connect` does **not** enable messaging (`LinkService.ts` product-wiring comment) |
| Message requests accept | `LinkService.acceptMessageRequest` | `MessageRequestsScreen.tsx`; badges on Chats/Contacts | Chats/Contacts “Requests” | Empty: “No pending requests.” (no CTA) | — | No | | Accept navigates to Thread |
| Message requests decline | `LinkService.declineMessageRequest` | `MessageRequestsScreen.tsx` | same | — | — | No | | Terminal; UI lists `pending` only |
| Groups create (private) | `src/services/group/GroupService.ts` `createChannel` | `ChannelsScreen.tsx` create Modal | Channels `+` | Empty: “Create a private group or join…” is **text only**; `+` is in the header, not in the empty view | — | No | | Member picker from contacts; cap `PRIVATE_GROUP_MEMBER_CAP` (`src/flags/config.ts`) |
| Groups create (public) | `GroupService.createPublicChannel` | same Modal, Public toggle | Channels `+` | same | — | No | | Copy: plaintext homeserver; Nexus does not index chat URIs |
| Groups join public | `GroupService.joinPublicChannel` | Channels Join Modal; `RootNavigator` `hypercolor://join-public` | Channels “Join”; OS deep link | Empty has no Join button (header only) | — | No | | |
| Groups open thread | `GroupService.getChannel` / `listMessages` | `ChannelScreen.tsx` | Channels row | — | Composer when `selfActive` | No | | |
| Groups leave | `GroupService.leaveChannel` | `ChannelScreen.tsx` members pane “Leave channel” | Not primary nav | — | — | No | Buried in Members | |
| Groups members add/remove | `GroupService.addMember` / `removeMember` | members pane (admin, private) | Not primary nav | — | — | No | Paste pubky; no contact picker on the pane | |
| Groups react / edit / delete | `GroupService.reactToMessage` / `editMessage` / `deleteMessage` | `ChannelScreen.tsx` bubble action row | — | — | Per-message actions (private only; public has Reply only) | No | Reactions `👍❤️😂🔥👎` hardcoded | |
| Attachments send | `src/services/attachments/AttachmentService.ts` | `ComposerAttachButton.tsx` | — | — | Thread always; **private** channel only (`ChannelScreen.tsx` `!isPublic`) | No | Photo + File Alerts. Camera permission in `app.json` but picker uses library | |
| Attachments receive / decrypt | `AttachmentService.resolveAttachment` | `AttachmentBubble.tsx` | In-thread | Backup-unavailable copy in bubble | Tap to download | No | No dedicated screen |
| Payment request send | `src/services/payments/PaymentService.ts` `requestPayment` | `PaymentComposeSheet.tsx`, Thread `₿` | Thread header | — | Sheet from `₿` | No | |
| Payment request accept/reject/cancel/proof | `PaymentService.acceptRequest` / `rejectRequest` / `cancelRequest` / `submitProofManual` | `PaymentRequestCard.tsx` + `PaymentRequestBubble.tsx` | In-thread bubble | — | Card actions | No | |
| Tip list send / pay | `PaymentService.sendTipList` / `getMyTipEndpoints`; `walletHandoff.ts` | `ThreadTipBar.tsx` | Thread under header | Expanded empty: “No tip destinations…” | Chips “Tip” / “Send my tip list” | **My endpoints are Settings-only** (`TipEndpointsSettings.tsx`) | Settings-only for configuring destinations | Gap: cannot add endpoints from the thread |
| Bitkit / wallet handoff | `src/services/payments/walletHandoff.ts` `openPayUri` / `openBuiltUri` | ThreadTipBar, PaymentRequestBubble “Open wallet” | Composer-adjacent | — | Open wallet | No | Alert if no `lightning:`/`bitcoin:` app |
| Backup export | `src/services/backup/BackupService.ts` `exportBackup` | `SettingsScreen.tsx` “Backup now” | — | — | — | **Settings-only** | Gap | Recovery code shown once in Settings |
| Restore | `BackupService.restoreBackup` | Settings paste + “Restore from backup” | — | — | — | **Settings-only** | Gap | Copy tells user to Enable Messaging again |
| Contacts manual add | `src/services/ContactsService.ts` `addManualContact` | `ContactSearchScreen.tsx` | Chats `+`, Contacts `+` | Contacts empty: “add someone by pubky” is **text**; `+` is header-only | — | No | QR block is a **non-functional notice** (no `expo-camera` in `app.json`) |
| Follows import (homeserver `/pub/pubky.app/follows/`) | `ContactsService.importFollows` + `PubkyService.list` | `ContactsScreen.tsx` `handleRefresh` | **Pull-to-refresh on a non-empty list only** | Empty copy says “Pull to import follows” but empty state is a centered `View` **without** `RefreshControl` | — | No | **Gap:** import exists and is tested (`src/services/__tests__/ContactsService.test.ts`) but is unreachable from empty Contacts |
| Relationship sync (Nexus following/followers/friends) | `ContactsService.syncRelationships`; `src/services/NexusClient.ts` | same pull-to-refresh | same | same lie on empty | — | No | Errors shown as `nexusNote` amber text |
| Username search | `NexusClient.user` (`GET /v0/user/{id}`) | **none** | — | — | — | — | **Hidden/none** | Method defined `NexusClient.ts` `user(pubky)`; zero product callers (see dead-code) |
| Discover / public tags | — | **none** | — | — | — | — | **Hidden/none** | No `Discover` screen/component. Public channels are invite-only (`src/types/group.ts`, Channels create hint) |
| Notifications (OS / in-app inbox) | Foreground `LinkService.syncInbox` from `App.tsx` / Chats / Thread | **no notification UI** | Unread badge on Chats rows only | — | — | — | **Hidden/none** as a feature | `docs/NOTIFICATIONS.md`: no push, no permission |
| BLE mesh | `src/services/MeshService.ts`; flag `mesh_transport` | Settings Transport switch only | — | — | — | **Settings-only** | Product path never calls `MeshService.start` | Flag default **false** (`src/flags/index.ts`). Toggle does not start BLE |
| Telemetry counters | `src/services/Telemetry.ts` | Settings Privacy switch | — | — | — | **Settings-only** | No dashboard; `Telemetry.snapshot` unused | Only `RetryQueue` records `delivery_failed_permanent` |
| Profile publish / display name edit | `PubkyService.publishProfile`; `authStore.setProfile` | Profile shows `profile?.displayName ?? 'Unnamed'` | Profile tab (read-only) | — | — | — | **Hidden** write path | `setProfile` has no callers; Profile is always “Unnamed” unless a future writer appears |
| Sign-out / disconnect Ring | `PubkyService.signOut` | `ProfileScreen.tsx` | Profile | — | — | No | | |
| Homeserver display | `authStore.homeserver` | Settings Homeserver row | — | — | — | Settings (read-only) | No editor | |
| Feature flags (unused keys) | `src/flags/index.ts` | Settings only exposes mesh + telemetry | — | — | — | Partial | `pubky_identity`, `pubky_inbox`, `channel_messaging`, `invite_links`, `trust_scoring` never `FeatureFlags.get`'d | Channels tab is **not** gated on `channel_messaging` |
| Trust scores | `src/services/TrustEngine.ts` | Contacts sort only (`sortContactsForDisplay` uses `trustScore`) | — | — | — | — | **No trust UI**; comment in TrustEngine mentions a “debug UI” that does not exist | `explain()` called on load for persistence |
| Dev/e2e signup | `debugSignupController.ts` + `PaykitLinkNative.signupWithSecret` | Welcome + Profile panels; `E2eSignupHud` | `__DEV__` only | — | — | — | Hidden in release (`__DEV__`) | |

## Follows import — exists on mobile?

**Yes, as a service and as a pull-to-refresh side effect, not as a first-class control.**

- Implementation: `ContactsService.importFollows` in `src/services/ContactsService.ts` (homeserver list of `/pub/pubky.app/follows/`).
- UI caller: `ContactsScreen.tsx` `handleRefresh` (with `syncRelationships`).
- Empty-state copy promises pull-to-refresh; the empty branch does not attach `RefreshControl`. Populated lists can pull. Header has Add, not Import.

## Discover — exists on mobile?

**No.** Grep of `src/**/*.tsx` found no Discover screen, public-tag timeline, or Nexus tag API usage. `NexusClient` only exposes `followers` / `following` / `friends` / `user`. “Discovery” in `PubkyService.getHomeserver` is PKDNS homeserver lookup for manual add, not a Discover product surface.

## Dead-code candidates

Nothing was deleted. Each row is a symbol or file with **zero product callers** outside its definition (tests may still import it). Greps were run from `/Users/johncarvalho/work/hypercolor` excluding `node_modules`, `.ai/`, and `modules/*/android/build/`.

| Candidate | Kind | Proof grep | Result |
|---|---|---|---|
| `src/services/MeshService.ts` entire module | service file | `rg -n "from ['\"].*MeshService" --glob '!**/node_modules/**' --glob '!**/.ai/**'` | **no matches** (file never imported) |
| `MeshService.start` | method | `rg -n "MeshService\.start" --glob '!**/node_modules/**'` | **no matches** besides none — definition-only; start is uncalled |
| `modules/mesh-transport` JS API | native module | only imported from unused `MeshService.ts` (`from '../../modules/mesh-transport/src'`) | Product path never loads it |
| `PubkyService.publishProfile` | method | `rg -n "publishProfile" --glob '!**/node_modules/**' --glob '!**/.ai/**'` | only `PubkyService.ts:66` |
| `PubkyService.publishContact` | method | `rg -n "publishContact" --glob '!**/node_modules/**' --glob '!**/.ai/**'` | only `PubkyService.ts:124` |
| `NexusClient.user` / `.user(` | API | `rg -n "\.user\(|NexusClient\.user" --glob '!**/node_modules/**' --glob '!**/.ai/**'` | **no callers**; method at `NexusClient.ts:164` |
| `useAuthStore.setProfile` | store action | `rg -n "setProfile" --glob '!**/node_modules/**' --glob '!**/.ai/**'` | only `src/stores/authStore.ts` |
| `contactStore.upsertMeshPeer` / `removeMeshPeer` / `meshPeers` | store | `rg -n "upsertMeshPeer\|removeMeshPeer\|meshPeers" --glob '!**/node_modules/**'` | only `src/stores/contactStore.ts` (plus unrelated `removeContact` in generated `ios/hypercolor/paykit.swift`) |
| `contactStore.removeContact` (JS) | store | same grep | only defined in `contactStore.ts`; UI never removes a contact |
| `contactStore.updateTrustScore` | store | `rg -n "updateTrustScore"` | store definition + `StorageService.updateTrustScore` (different function). Zustand action unused |
| `Telemetry.snapshot` | method | `rg -n "Telemetry\.snapshot" --glob '!**/node_modules/**'` | **no matches** |
| `Telemetry.clear` | method | `rg -n "Telemetry\.clear"` | **no matches** |
| `FeatureFlags.get('pubky_identity')` | flag | `rg -n "FeatureFlags\.get\('pubky_identity'\)"` | **no matches** (key only in `src/flags/index.ts` union/defaults) |
| `FeatureFlags.get('pubky_inbox')` | flag | `rg -n "FeatureFlags\.get\('pubky_inbox'\)"` | **no matches** |
| `FeatureFlags.get('channel_messaging')` | flag | `rg -n "FeatureFlags\.get\('channel_messaging'\)"` | **no matches** (Channels tab always mounted) |
| `FeatureFlags.get('invite_links')` | flag | `rg -n "FeatureFlags\.get\('invite_links'\)"` | **no matches** (join-public still live) |
| `FeatureFlags.get('trust_scoring')` | flag | `rg -n "FeatureFlags\.get\('trust_scoring'\)"` | **no matches** (`TrustEngine` runs anyway) |
| `AppConfig.setNexusBaseUrl` | config | `rg -n "setNexusBaseUrl" --glob '*.{ts,tsx}' --glob '!**/__tests__/**'` | definition in `flags/index.ts` + comment in `flags/config.ts`; **no Settings UI** |
| `__tests__/` at repo root | empty dir | `ls __tests__` | empty placeholder (no specs) |
| ContactSearch “Scan QR” block | UI that cannot run | `ContactSearchScreen.tsx` `qrFallback` | Renders copy only; no camera module |

**Not dead (do not treat as unused):** all files under `src/screens/` (wired in navigators); all files under `src/components/` (each imported by a screen); `ThreadScreenContent` / `ChannelsScreenContent` / etc. (used by their parent screens); `paymentComposeError` (used by sheet + `PaymentComposeSheet.test.tsx`); `TrustEngine.explain` (called from `ContactsScreen.tsx`); `Telemetry.record` (called from `RetryQueue.ts`).

**Count: 19 dead-code candidates** in the table above (18 symbols/files + the non-functional QR block).

## Gap summary for later waves

Highest-impact exposure gaps: follows import unreachable from empty Contacts; no Discover/username search; backup/restore and tip-endpoint **configuration** Settings-only; mesh/telemetry toggles with no runtime effect users can see; Profile cannot be edited; Enable Messaging success has no Done (see `screen-inventory.md`).
