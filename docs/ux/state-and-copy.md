# Hypercolor mobile state and copy

Auth, messaging enablement, per-peer LinkStatus, payments, and every user-visible string on those surfaces. Owners are file + symbol. Copy is quoted from the file that renders it.

## Session / identity (Welcome Ring)

| State | Owner | How it is entered | Copy shown |
|---|---|---|---|
| Unauthenticated | `useAuthStore` (`src/stores/authStore.ts`) `isAuthenticated: false` | Cold start; failed hydrate; sign-out `clearSession` | Welcome: `hypercolor` / `Private. Decentralized. Yours.` / `Your identity is managed by pubky-ring.` / `Hypercolor never holds your private key.` / button `Connect with pubky-ring` (`WelcomeScreen.tsx`) |
| Hydrating identity | `hydratePersistedAuth` (`src/stores/hydrateAuthSession.ts`); `KeyStore.hasPersistedSession` | `App.tsx` after `KeyStore.initKeyStore` | No copy; splash spinner (`App.tsx`) |
| Authenticated (identity only) | `setAuthenticated(pubky, homeserver)` | Ring callback or debug Continue | Main tabs. Messaging may still be off |
| Waiting for Ring (paykit-connect) | `AwaitingRingAuthScreen`; pending handoff `PubkyRingAuthService.requestDelegation` | After Connect | `Waiting for pubky-ring` / `Approve the authorization in pubky-ring to continue.` / `You'll be redirected back here automatically.` / `Paykit-connect link` / `Scan with Bitkit or Pubky Ring on this or another device.` / `Open Pubky Ring` / `Copy URL` / `Copied` / `Cancel` |
| Ring callback failure | `RootNavigator.handleDeepLink` catch | Bad/missing callback | Alert title `Authorization Failed`, body `(err as Error).message` — can include **full callback URL** (`PubkyRingAuthService.handleRingCallback`: `Invalid callback URL — missing required params. Got: ${url}`) |
| Welcome connect failure | `WelcomeScreen.handleConnect` | `requestDelegation` throw | Alert `Error` + raw `Error.message` |
| Sign-out confirm | `ProfileScreen.handleSignOut` | Disconnect tap | Title `Disconnect from pubky-ring`. Body `This removes Hypercolor's delegated access. You will need to re-authorize with pubky-ring to use the app.` Buttons `Cancel` / `Disconnect` |

There is **no** UI state named `waiting` / `denied` / `revoked` on the Welcome path. Handoff TTL is 5 minutes (`ENABLE_AUTH_TTL_MS`). `AwaitingRingAuthScreen` expires the QR in UI; `PubkyRingAuthService.handleRingCallback` also rejects a late approval with `ExpiredDelegationError` (`Authorization expired`). A Keychain read error that hides `expiresAt` fails closed (treated as expired). Legacy raw-hex Keychain entries have no TTL and remain resumable. Cold-start resume still works: the ephemeral secret and `expiresAt` are persisted in Keychain (`KeyStore.setPendingRingHandoff`), so `_pending` can be lost and the callback still completes **if** the TTL has not elapsed. Denied Ring approval never returns to AwaitingRingAuth with a status — the user stays on “Waiting…” until Cancel, expiry, or a successful callback. A late TTL rejection also notifies Awaiting via `ConnectAuthFeedback` `'expired'`.

## Messaging enablement (`LinkEnableStatus` + controller phases)

Device-level, not per-peer. Type: `LinkEnableStatus` in `src/services/link/LinkService.ts` (`'native-missing' | 'needs-enable' | 'session-offline' | 'enabled'`). Screen phases: `EnableMessagingPhase` in `enableMessagingController.ts`.

| Enable / phase | Owner | Copy (`statusLabel` / `message`) |
|---|---|---|
| `checking` | controller `start()` | `Checking messaging status…` |
| `native-missing` | `LinkService.getEnableStatus` if `!PaykitLinkNative.isAvailable()` | Status `Native module missing`. Message `PaykitLinkModule is not linked into this build.` |
| `needs-enable` | no session or no published marker | Not shown as a label; controller auto-`beginAuth` |
| `authorizing` | after `enable()` returns URL | `Waiting for Pubky Ring…` + `Authorization URL` / `Scan with Pubky Ring on this or another device.` / `Open Pubky Ring` / `Copy authorization URL` / `Copied` |
| `success` | `awaitEnabled()` resolved | `Encrypted messaging enabled` + `Ring approved the grant and this device published a receiver marker. You can leave this screen.` |
| `enabled` (already) | `getEnableStatus() === 'enabled'` | `Already enabled` + `Encrypted messaging is already enabled on this device.` + button `Authorize again` |
| `session-offline` | restore `network` (`getEnableStatus`) | `Session offline` + `A messaging session exists but could not be restored. Authorize again when the network is available.` + `Try again` |
| `error` | catch in `beginAuth` / `start` | `Enable failed` + **`errorMessage(err)` = `err.message` or `String(err)`** (controller). Tests use `'ring denied'` as a raw native/JS message (`enableMessagingController.test.ts`) |
| CTA when disabled | `EnableMessagingCta` | `Enable encrypted messaging` / `Approve Paykit + Hypercolor write access in Pubky Ring` |
| Settings row | `SettingsScreen` | `Enable encrypted messaging` / `Authorize Pubky Ring for Paykit links` |
| Screen chrome | `EnableMessagingScreen` | Title `Messaging`; heading `Enable encrypted messaging`; explanation includes **raw capability string** `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw` |

**Revoked / expired session:** `LinkService.restorePersistedSession` comment: native `auth` rejection (revoked/expired) **deletes the stored alias**; `network` keeps it (`session-offline`). There is no “revoked” banner. Next Enable Messaging visit is `needs-enable` or `session-offline`. Coarse native messages (`PaykitLinkNative.ts` `COARSE_NATIVE_MESSAGES`): `authentication failed`, `network error`, `protocol error`, `resource consumed`, `validation failed`, `unavailable`, `auth flow cancelled`. Native Ring-auth flow: `startAuthFlow` → `awaitAuthApproval(flowId)` → `stopAuthKeepalive(flowId)`. Native admits one owner lease per live `flowId`. A second `awaitAuthApproval` while reserved, awaiting, or still settling a cancellation rejects `validation` / `already awaiting` and must not prune the owner's tombstone. Discarded flows call `cancelAuthFlow(flowId)` (Paykit FFI has no auth-flow cancel primitive; native discard cancels the await job, drops a not-yet-awaited UniFFI flow so its relay subscription stops, stops keepalive, and tombstones the id). Cancel-before-await: the later `awaitAuthApproval` rejects `auth_flow_cancelled` and that caller is the owner who prunes the tombstone. A wait already spawned by `awaitApproval` runs to completion inside Paykit and cannot be aborted; after that FFI return native must not persist, must `close()` the handle exactly once, and rejects `auth_flow_cancelled`. Bridge/module invalidation and coroutine-scope teardown reject `unavailable` (not `auth_flow_cancelled`) and never persist; after invalidation, `startAuthFlow` / `awaitAuthApproval` / `cancelAuthFlow` reject `unavailable` immediately. Close is exact-once: idle / cancel-before-await close immediately; the admitted owner closes after FFI settles (success, failure, or cancel-during-await). `LinkService.requireSessionAlias` throws `auth` / `Enable encrypted messaging to write to your homeserver.`

**Denied:** not a first-class phase. Ring denial surfaces as `error` with whatever `awaitAuthApproval` rejects (may be coarse `authentication failed` if wrapped, or raw `Error.message` if not).

## Per-peer `LinkStatus` (not shown in UI)

Type `LinkStatus` in `src/types/link.ts`, produced by `LinkService.ensureLinkWith` → `ensureLinkLocked` (`src/services/link/LinkService.ts`).

| Value | Producer (symbol) | Meaning (from `src/types/link.ts`) | UI copy |
|---|---|---|---|
| `needs-enable` | `ensureLinkLocked` | no session / no marker | **None on Thread/Chats.** Only Enable Messaging CTA if `!hasSession` |
| `session-offline` | restore `offline` | alias kept, restore failed network | **None** on thread |
| `native-missing` | `!PaykitLinkNative.isAvailable()` | module missing | Enable Messaging only |
| `not-enrolled` | `getReceiverMarker === null` | peer has no receiver marker | **None.** Sends still Alert `Send failed` + `Error.message` |
| `handshaking-initiator` / `handshaking-responder` | `roleStatus` | Noise XX in progress | **None** |
| `ready` | established restore/advance | live link | **None** (composer just works) |
| `message-request` | documented on the type | inbound held by WoT | **Never returned as this string in `LinkService.ts`.** UI is `MessageRequestsScreen` (“Inbound message request”) via `StorageService` rows |
| `error` | `ensureLinkWith` catch | unexpected failure | Send Alert only |

Thread and Chats **do not** call `ensureLinkWith` for a status banner. Users cannot see “not enrolled” vs “handshaking”.

## Delivery labels (overstatement)

`LinkDeliveryState` in `src/types/link.ts`: `'sending' | 'sent' | 'delivered' | 'read' | 'failed'`. Comment: **`delivered` and `read` are reserved for receipt kind `chat.receipt.v0`; no receipt logic exists yet.** Received messages persist as `delivered` on arrival (`LinkService` inbound path). Outbound `sent` means native send accepted, not peer ACK.

| UI | File | Copy |
|---|---|---|
| DM bubble meta (mine) | `ThreadScreen.tsx` `formatDeliveryState` | `sending…` / `failed to send` / `sent` / **`delivered`** / **`read`** |
| Channel bubble meta (mine, private) | `ChannelScreen.tsx` | raw `item.deliveryState` interpolated (` · {item.deliveryState}`) — can show **`delivered`** / **`read`** with no mapping |
| Attachment sending | `AttachmentBubble.tsx` | `Uploading…` / `Failed to send` / `Saved on this device` / `Tap to download` / `Decrypting…` |

**Flag:** Thread and Channel claim `delivered`/`read` without receipts. That overstates Encrypted Link guarantees.

## Payments / tips

`PaymentDisplayStatus` from `displayPaymentStatus` (`src/types/payment.ts`): `pending | accepted | rejected | cancelled | proof_received | expired | sending | claimed | verified`.

| Display | `PaymentRequestCard.statusLabel` |
|---|---|
| `claimed` / `proof_received` | `Payment claimed` (neutral; comment: empty `{}` proof must not say paid) |
| `verified` | `Paid` with `✓` |
| `sending` | `sending` |
| `expired` | chip via `status.replace('_', ' ')` → `expired`; plus `ExpiryLabel` `Expired` / `Expires in {n}` |
| other | `pending`, `accepted`, `rejected`, `cancelled` with underscore → space |

Other payment copy: `Payment request` / `{amount} BTC` / Accept / Reject / Cancel / `Pay in wallet` / `Preimage (optional)` / `I paid` / `Choose destination` / `Open wallet` / compose `Request payment` / `Amount (BTC)` / `Reference` / `Enter a valid BTC amount` / `Enter a payment reference` / `Payment reference is invalid` / `Send request`. Tip bar: `Tip` / `Send my tip list` / `No tip destinations from this peer yet.` / `Pay in wallet` / `Expired` / `Expires {ISO timestamp}`. Settings: `My tip endpoints` / `Shared privately over Encrypted Links. This app never pays — wallets open via lightning: or bitcoin: links after validation.` / `Bolt11 invoice` / `On-chain address` / `Save tip endpoints`. Wallet: `No wallet installed` / `Copy the payment URI and paste it into a wallet that supports lightning: or bitcoin: links.` / `Copy URI`. Invoice amount mismatch uses a constructed error naming BTC amounts (`walletHandoff.ts`).

## Empty / error / status strings (other screens)

| Screen | Empty / hint / error |
|---|---|
| Chats | `No conversations yet.` / `Search for a contact to start chatting.` / preview `No messages yet` / relative `now` `Nm` `Nh` `Nd` |
| Contacts | `No contacts yet.` / `Pull to import follows, or add someone by pubky.` / `Updating follows…` / `Import failed: {message}` / Nexus error text as `nexusNote` / badges `Mutual` `Following` `Follower` `Added` |
| Contact search | placeholder `Paste Pubky key (z-base-32)…` / `Must be a 52-character z-base-32 pubky (no 0, 2, l, or v).` / `Scan QR` / `QR scanning requires a camera module that is not installed in this build.…` / service messages `Not a valid 52-character z-base-32 pubky.` / `No homeserver found for that pubky. Check the key and try again.` / Alert `Contact Added` |
| Message requests | `No pending requests.` / `Inbound links from people you do not follow wait here.` / `Inbound message request` / `Accept` / `Decline` |
| Channels | `No channels yet.` / `Create a private group or join a public channel.` / `Public channel` / `Private group` / modal titles `New channel` `Join public channel` |
| Channel | loading spinner; `Message deleted`; `You have left this channel.`; `Leave channel`; `Refresh from homeserver`; `Members` / `Chat`; membership line `{pubky slice}… {body}` |
| Profile | `Unnamed` / full pubky / `Keys managed by pubky-ring` / `Disconnect pubky-ring` |
| Settings | `Not connected` / mesh `BLE Mesh (quarantined)` / backup paragraph / `Write this recovery code down` / `It is shown once here. Store it in Ring or a password manager.` / restore success `Restore complete. History is local. Enable messaging again…` / `Telemetry` / `Anonymous delivery counters only` / `Live proof (dev)` |
| Backup errors | `Recovery code is required` / `No backup found on this account` / `Backup belongs to a different account` / `Backup failed` / `Restore failed` — shown as `restoreNote` **raw** |
| Debug signup (`__DEV__`) | `Encrypted messaging enabled` / `Identity secret` / `Continue` / errors as `String(err)` |

## Capability strings, keys, raw errors (flags)

| Issue | Where | Detail |
|---|---|---|
| Raw capability grants | `EnableMessagingScreen.tsx` explanation | `/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw` shown to users |
| Caps in paykit-connect URL | `AwaitingRingAuthScreen` selectable `authUrl`; `Welcome` QR | Full `pubkyring://paykit-connect?…&caps=` including encoded `RING_GRANT_CAPABILITIES` |
| Untruncated z32 | `ThreadScreen` title (`numberOfLines={1}` middle ellipsize, still the full 52-char string as `accessibilityLabel`); `ChatsScreen` peer name + `accessibilityLabel={item.participantPubky}`; `ChannelScreen` sender line full pubky; `ProfileScreen` `profilePubky` **selectable full key**; Contacts row `ellipsizeMode="middle"` but full string in tree; Message requests name may truncate display (`slice(0,6)…slice(-4)`) while pubky line is full |
| Raw `Error.message` / `String(err)` | Welcome Alert; RootNavigator Authorization Failed (URL); Thread/Channel send; Channels create/join; ContactSearch catch; Payment/Tip Alerts; Enable Messaging `error` phase; Settings backup `restoreNote`; DebugSignupPanel | Native coarse mapping exists (`toLinkNativeError`) but UI often passes `err.message` without going through it |
| Identity secret on screen | `DebugSignupPanel` / `E2eSignupHud` (`__DEV__`) | Full 64-hex secret, selectable |

## Copy that is accurate (keep)

- Welcome: Hypercolor never holds the private key.
- Settings backup: history restores; links re-handshake; attachments without keys unavailable.
- Tip form: this app never pays.
- Payment claimed vs Paid (`verified` only after preimage check).
- Public channel plaintext warning.
- Notifications strategy is documented off-UI (`docs/NOTIFICATIONS.md`), not contradicted by a “delivered to lock screen” string.
