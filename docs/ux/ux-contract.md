# Hypercolor UX Contract

Binding specification for the Hypercolor UX/UI sweep. Implementation waves execute this
document; where it conflicts with current code, this document wins.

**Repo pins.** Mobile: `/Users/johncarvalho/work/hypercolor`, `main @ b12e8d6` (React Native).
Web: `/Volumes/vibedrive/vibes-dev/hypercolor-web`, `main @ 89048ad` (Next.js static export).

**Boundaries that are not redesigned.** Pubky Ring holds keys and authorizes via
`pubkyauth://` / `paykit-connect`. Bitkit (and any other wallet) is reached only through a
`lightning:` / `bitcoin:` URI handoff. Nothing in this contract changes either app.

**No protocol changes.** Where a screen would need one — read receipts
(`CHAT_RECEIPT_KIND`, reserved and unimplemented in both repos) or stranger-first-DM
discovery (web ADR 0004 `docs/adr/0004-open-inbox-drop-point.md`, Proposed, unimplemented) —
this contract specifies the honest interim UI instead and says so on screen.

**Design direction inherited from the approved plan.** Evolve the existing identity: `#0a0a0a`
canvas, `#7c3aed` brand, hairline borders, 12px radius, operational copy. No rebrand.

---

## A. Information architecture

### A.1 Primary destinations

Mobile has exactly four tabs. Web has exactly four primary nav links plus two conditional
brand links (`Enable`, `Connect`), which is ≤5 primary destinations and mirrors mobile.

| Slot | Mobile tab | Web nav link / route | Shell |
| --- | --- | --- | --- |
| 1 | `Chats` | `Chats` → `/chats/[[...conversationId]]` | master/detail |
| 2 | `Channels` | `Channels` → `/channels/[[...id]]` | master/detail |
| 3 | `Contacts` | `Contacts` → `/contacts/[[...pubky]]` | master/detail |
| 4 | `Profile` | `Profile` → `/profile` | single pane |

Web removes three current nav entries: `Discover` (folds into Channels → Public),
`Requests` (becomes a pinned row inside Chats), and `Settings` (reached from Profile, as on
mobile). Current nav list: `src/components/site-nav.tsx:11-19`. The conditional `Enable`
(`site-nav.tsx:66`) and `Connect` (`site-nav.tsx:75`) links stay; they are session affordances,
not destinations.

Mobile tab registration that stays as-is: `src/navigation/MainTabs.tsx:34-53`.

### A.2 Screen homes — every screen in both inventories

| Screen / route | Mobile home | Web home |
| --- | --- | --- |
| Welcome / Connect | `Auth` stack → `Welcome` (`src/screens/auth/WelcomeScreen.tsx`) | `/` (`src/components/welcome-page.tsx`) |
| Awaiting Ring authorization | `Auth` stack → `AwaitingRingAuth` (`src/screens/auth/AwaitingRingAuthScreen.tsx`) | inline auth panel on `/` (`src/components/auth-url-panel.tsx`) |
| Ring callback | deep link `hypercolor://ring-callback`, handled in `src/navigation/RootNavigator.tsx:92-103` (no screen) | `/ring-callback` (`src/components/ring-callback-page.tsx`), transient |
| Enable Messaging | root stack modal-push `EnableMessaging` (`RootNavigator.tsx:157-161`) | `/enable` (`src/components/enable-page.tsx`) |
| Chats list | tab 1 (`src/screens/main/ChatsScreen.tsx`) | `/chats` master pane |
| Thread (DM) | root stack push `Thread` (`RootNavigator.tsx:132-136`) | `/chats/{conversationId}` detail pane |
| Message requests | root stack push `MessageRequests` (`RootNavigator.tsx:147-151`), entered from the pinned Requests row in Chats | `/requests`, entered from the pinned Requests row in Chats |
| Channels list | tab 2 (`src/screens/main/ChannelsScreen.tsx`), segmented Private \| Public | `/channels` master pane, segmented Private \| Public |
| Channel / group view | root stack push `ChannelScreen` (`RootNavigator.tsx:137-141`) | `/channels/{id}` detail pane (`src/components/channel-view.tsx`) |
| Public topic (tag channel) | not implemented on mobile — see §A.4 | Channels → Public mode; topic detail renders `src/components/tag-channel-view.tsx` |
| Contacts list | tab 3 (`src/screens/main/ContactsScreen.tsx`) | `/contacts` master pane |
| Contact detail | new detail screen, root stack push `ContactDetail` (§D.9) | `/contacts/{pubky}` detail pane (`src/components/contact-detail.tsx`) |
| Add contact / search | root stack push `ContactSearch` (`RootNavigator.tsx:142-146`) | inline panel at top of `/contacts` master pane (`src/components/contacts-page.tsx:167-201`) |
| Follows import consent | new sheet from Contacts (§D.8) | inline panel on `/contacts` (`src/components/follows-import-panel.tsx`) |
| Profile | tab 4 (`src/screens/main/ProfileScreen.tsx`) | `/profile` |
| Settings | root stack push `Settings` (`RootNavigator.tsx:152-156`), entered from Profile | `/settings`, entered from Profile |
| Sign-out confirmation | sheet over Profile (§D.15) | sheet over `/profile` (§D.15) |
| Backup / recovery gate | sheet over Settings (§D.13) | sheet over `/settings` (§D.13) |
| Tip endpoint settings | Settings section (`src/components/TipEndpointsSettings.tsx`) | not present; hidden by design (§E) |
| Payment compose | sheet from Thread composer action menu (`src/components/PaymentComposeSheet.tsx`) | not present; hidden by design (§E, decision 5) |
| Payment review | new sheet from Thread (§D.12) | not present |
| Composer action menu | new sheet from Thread and Channel composers (§D.11) | new sheet from `src/components/composer.tsx` (photo/file only) |
| Tab-lock banner | n/a | app shell, above nav (`src/components/tab-lock-banner.tsx`) |
| Session banner | app shell (new, §D.19) | app shell (`src/components/session-banner.tsx`) |
| PWA update prompt | n/a | app shell (`src/components/pwa-register.tsx`), §D.20 |
| Live proof / dev panels | Settings, `__DEV__` only (`src/screens/main/SettingsScreen.tsx:329-372`) | `/e2e/*` routes, excluded from nav by `site-nav.tsx:35` |
| Debug signup panel | Auth stack, `__DEV__` only (`src/screens/auth/DebugSignupPanel.tsx`) | n/a |

### A.3 Requests placement (ruling applied)

Requests is **not** a tab and **not** a web nav link. It surfaces in exactly two places on
each platform, both of which point at the same destination:

1. **A pinned row at the top of the Chats list**, always rendered (including when the chat
   list is empty), labelled `Message requests` with a count badge when `> 0`.
2. **A count badge on the Chats tab (mobile) / Chats nav link (web)**, mirroring the same
   number, so a pending request is visible from any destination.

The mobile Contacts header Requests button (`src/screens/main/ContactsScreen.tsx:163-168`) is
removed; two entry points into one queue from two different destinations is the current
divergence, not a feature. The mobile Chats header Requests button
(`src/screens/main/ChatsScreen.tsx:116-121`) is replaced by the pinned row. The web
`Requests` nav link (`src/components/site-nav.tsx:16`) is removed; `/requests` remains a real
route reached from the pinned row and by deep link.

### A.4 Public topics placement (ruling applied)

Public discovery is a **mode inside Channels**, never a destination of its own. Channels
carries a two-option segmented control at the top of the master pane: `Private` | `Public`.

- `Private` lists private groups. Row meta reads `Private group`
  (current: `src/screens/main/ChannelsScreen.tsx:196`).
- `Public` lists public rooms and carries the public-graph warning (§B.6) above the list.

The two platforms currently implement different public substrates and this contract does not
merge them, because merging is a protocol/product change, not a UX change:

- **Mobile** `Public` lists Hypercolor public channels backed by
  `/pub/hypercolor.app/v1/public-channels` (`src/types/group.ts:132`), created and joined
  through `GroupService.createPublicChannel` / `joinPublicChannel`.
- **Web** `Public` lists Nexus hot tags and tag channels, per accepted ADR 0002
  (`docs/adr/0002-public-chat-as-graph.md:72`, which explicitly says do not implement
  `public-channels/` on web). The existing `/discover` UI
  (`src/components/discover-page.tsx`) moves under `/channels` in `Public` mode; the route
  `/discover/[[...tag]]` is kept as a redirect to `/channels?mode=public` so existing links
  do not 404.

Both platforms label the mode `Public` and both show the same warning copy. The substrate
divergence is stated on screen in one line (§D.10) so no user is told the two lists are the
same thing. Convergence is Open Question 1 (§G).

---

## B. Glossary — canonical strings and what they replace

Every "current" line below is a literal in the tree at the cited path. Implementers replace
the current string with the canonical string.

### B.1 Connect vs Enable

Two distinct Ring approvals. Never use one word for the other.

- **Connect** = adopt an identity on this device. First Ring approval.
- **Enable messaging** = grant the Paykit + Hypercolor write scopes and publish a receiver
  marker. Second Ring approval.

| Canonical string | Where used | Current divergent strings |
| --- | --- | --- |
| `Connect with Pubky Ring` | Welcome primary button, web `Connect` nav link | mobile `Connect with pubky-ring` (`src/screens/auth/WelcomeScreen.tsx:62`, a11y label `:54`); web button label is already `Connect with Pubky Ring` in `src/components/enable-messaging-cta.tsx:14` but the nav link says `Connect` (`src/components/site-nav.tsx:75`) |
| `Enable encrypted messaging` | Enable screen title, Settings row, CTA button | mobile title `Enable encrypted messaging` (`src/screens/main/EnableMessagingScreen.tsx:92`), Settings row `Enable encrypted messaging` (`src/screens/main/SettingsScreen.tsx:198`) — both already correct; web `/enable` title `Enable encrypted messaging` (`src/components/enable-page.tsx:35-36`) already correct; web nav shortcut says `Enable` (`src/components/site-nav.tsx:66`) — keep the short nav label, it is a link not a CTA |
| `Approve the Paykit and Hypercolor write scopes in Pubky Ring.` | Enable screen body, Enable CTA hint | mobile `Approve Paykit + Hypercolor write access in Pubky Ring` (`src/components/EnableMessagingCta.tsx:13`); mobile Settings hint `Authorize Pubky Ring for Paykit links` (`src/screens/main/SettingsScreen.tsx:199`); web `Encrypted DMs and homeserver writes share one Paykit session. Approve /pub/paykit/:rw,/pub/hypercolor.app/v1/:rw in Pubky Ring.` (`src/components/enable-page.tsx:37-43`) — web keeps the scope string as secondary monospace detail below the canonical sentence |
| `Pubky Ring` | every user-facing mention of the app | mobile `pubky-ring` in `src/screens/auth/WelcomeScreen.tsx:48`, `src/screens/auth/AwaitingRingAuthScreen.tsx:43`, `:45`, `src/screens/main/ProfileScreen.tsx:34`, `:35`, `:84`, `:123`, `:127`, `src/screens/main/SettingsScreen.tsx:214`, `src/screens/auth/WelcomeScreen.tsx:31` |
| `paykit-connect URL` | the copyable authorization URL | mobile `Copy authorization URL` (`src/screens/main/EnableMessagingScreen.tsx:150-151`) — keep as the button label; web `Scan or copy the paykit-connect URL` (`src/components/welcome-page.tsx:39-40`) already correct |

### B.2 Room vocabulary

| Canonical string | Meaning | Current divergent strings |
| --- | --- | --- |
| `Private group` | Encrypted Link group, member-capped at 50 (`src/flags/config.ts:39`) | mobile row meta `Private group` (`src/screens/main/ChannelsScreen.tsx:197`) and toggle `Private group` (`:248`) already correct; web `New private group` (`src/components/channels-page.tsx:125`) already correct |
| `Public topic` | anything in Channels → Public mode | mobile row meta `Public channel` (`src/screens/main/ChannelsScreen.tsx:197`), toggle `Public` (`:254`), join modal title `Join public channel` (`:312`), empty hint `Create a private group or join a public channel.` (`:221`); web page title `Discover` (`src/components/discover-page.tsx:43`) |
| `Chat` | a one-to-one DM | mobile empty state `No conversations yet.` (`src/screens/main/ChatsScreen.tsx:141`) → `No chats yet.` |
| `Message requests` | the held-inbound queue | mobile `Message requests` (`src/screens/main/MessageRequestsScreen.tsx:165`) and web `Message requests` (`src/components/requests-page.tsx:71`) already correct; mobile Chats button label `Requests` (`src/screens/main/ChatsScreen.tsx:121`) and mobile Contacts label `Requests` (`src/screens/main/ContactsScreen.tsx:168`) become the pinned row label `Message requests` |

### B.3 Message status words

Only four words may appear as an outbound message status. Inbound messages never show a
status.

| Canonical string | Condition |
| --- | --- |
| `Queued` | `deliveryState === 'sending'` — the item is in the retry queue or the Encrypted Link handshake has not completed |
| `Sent` | `deliveryState === 'sent'` — the ciphertext was written to the peer's receiver |
| `Failed` | `deliveryState === 'failed'` — with a `Retry` action |
| *(no status)* | any inbound message, and any message in a public topic |

`delivered` and `read` must not render anywhere. `CHAT_RECEIPT_KIND` is reserved and
unimplemented in both repos; showing those words claims knowledge the client does not have.
Storage may keep the enum values; the formatter maps them to `Sent` until a receipt protocol
ships.

Current divergent strings:

- mobile `sending…` / `failed to send` / `sent` / `delivered` / `read`
  (`src/screens/main/ThreadScreen.tsx:456-470`)
- mobile raw enum interpolation in group messages
  (`src/screens/main/ChannelScreen.tsx:357` renders `item.deliveryState` directly)
- web `sending` / `sent` / `delivered` / `read` / `failed`
  (`src/components/message-bubble.tsx:17-26`, rendered at `:53` and `:119`)

### B.4 Custody line

**Canonical sentence (verbatim, one sentence, no variants):**

> Pubky Ring holds your key. Hypercolor never sees it.

Screens that must show it, in this exact wording (placement per §D): Welcome/Connect,
Awaiting Ring authorization, Enable Messaging (all phases), Profile identity block, Settings
identity row, Sign-out confirmation.

Backup and restore need a second, distinct line because a recovery code *is* a secret
Hypercolor generates, and reusing the custody line there would be misleading:

> This code unlocks your local backup. It is not your identity key — Pubky Ring still holds that.

Current divergent strings:

- mobile `Your identity is managed by pubky-ring.` (`src/screens/auth/WelcomeScreen.tsx:48`)
- mobile `Keys managed by pubky-ring` (`src/screens/main/ProfileScreen.tsx:84`,
  `src/screens/main/SettingsScreen.tsx:214`)
- mobile `The root Ed25519 secret key is NEVER seen or held by Hypercolor.`
  (`src/services/PubkyRingAuthService.ts`, code comment — leave as a comment, do not surface)
- web `Your identity is managed by Pubky Ring. Hypercolor never holds your private key.`
  (`src/components/welcome-page.tsx:37-39`)
- web `Hypercolor never holds your identity secret.` (`src/components/enable-page.tsx:42`)
- web `Keys managed by Pubky Ring` (`src/components/profile-page.tsx:43`)

### B.5 Follows-import consent copy

**Canonical block (used verbatim on both platforms):**

> **Use your pubky.app follows**
>
> Your follows at `/pub/pubky.app/follows/` are already world-readable. Hypercolor only reads
> what anyone can already see, and never writes a follow.
>
> Imported follows become suggestions, not contacts, and they never auto-accept a message —
> every new inbound chat still waits in Message requests.
>
> While this is on, opening Contacts re-reads that listing from your homeserver. If the
> homeserver listing is unavailable, the public index (Nexus) is asked for your following
> list and each name is re-checked against your homeserver. Hypercolor never asks Nexus who
> follows you.
>
> ☐ I understand my follows are public, that importing does not hide them, and that messaging
> someone may reveal I use Hypercolor.
>
> [Use my follows]  [Not now]

Two current strings are factually wrong and must be deleted, not reworded. Web
`src/components/follows-import-panel.tsx:46` says `Inbound chats from people you follow may
be accepted automatically.` and `:50-51` says `Stopping import clears follow recognition so
it cannot keep auto-accepting.` Both platforms' gate
(`src/services/link/wotGate.ts`, identical logic in each repo) auto-accepts on
`hasPriorRoutedConversation` only and explicitly ignores `isFollowing`, `isMutual`, and
`addedManually`. Following someone has never opened your inbox to them. The second sentence
is at `src/components/follows-import-panel.tsx:50-51`.

Other current divergent strings:

- web panel title `pubky.app follows` (`src/components/follows-import-panel.tsx:39`)
- web enable button `Use my pubky.app follows to recognise people`
  (`src/components/follows-import-panel.tsx:163`)
- web checkbox `I understand follows are public, that import does not hide them, and that
  messaging someone may reveal I use Hypercolor.`
  (`src/components/follows-import-panel.tsx:129-130`)
- web disable note `Import is off. Follow recognition was cleared. Inbound chats from those
  follows need an explicit accept unless you added them or already have a conversation.`
  (`src/components/follows-import-panel.tsx:106-108`)
- web suggestion header `Suggestions from pubky.app follows` and subcopy `Not your contact
  list. Add one to keep them. Hypercolor does not write a follow.`
  (`src/components/contacts-page.tsx:243-245`)
- mobile: **no consent copy exists.** `ContactsScreen.handleRefresh` calls
  `ContactsService.importFollows` unconditionally on every pull-to-refresh
  (`src/screens/main/ContactsScreen.tsx:59`) and then `syncRelationships`, which reaches
  Nexus, with no opt-in. The only related string is the empty hint `Pull to import follows,
  or add someone by pubky.` (`src/screens/main/ContactsScreen.tsx:192`).

### B.6 Public-graph warning

**Canonical block**, shown above the Channels → Public list and above a public topic view:

> **Public** — anything you post here is world-readable and permanent. Loading this list asks
> the public index for topics; the index operator sees that query. Your chats and private
> groups are never sent here.

Current divergent string: web `This is the global public index — rooms anyone can already
query. Loading topics asks the index for the hot-tag list; the operator sees that query.
Opening a topic is a public read; the index operator sees which tags you look up. Private DMs
and groups stay on Chats and Channels and are never sent here. Skip this page if you do not
want that query to happen.` (`src/components/discover-page.tsx:44-50`). Mobile has no warning
on public channels at all — `src/screens/main/ChannelsScreen.tsx:220-221` and
`:312-323` say nothing about publicity.

### B.7 Session-offline retry

**Canonical strings:**

- Banner label: `You are offline. Messages will send when you reconnect.`
- Banner action: `Try again`
- Enable-screen status label: `Session offline`

Current divergent strings: web banner label comes from `sessionStatusLabel`, which returns the
bare `Session offline` (`src/lib/session-ui.ts:24`), and the action is `Try again`
(`src/components/session-banner.tsx:44`) — action already correct, label expands. Mobile has
`Session offline` as an Enable-screen phase label
(`src/screens/main/EnableMessagingScreen.tsx:35`) and no app-level banner at all.

### B.8 Error surfaces

Raw exception text must never be the whole user-facing message. Every catch renders a
canonical sentence and puts the raw text in a collapsed `Details` disclosure.

Current divergent strings (raw `err.message` rendered directly): web
`src/components/requests-page.tsx:130` (`"Accept failed"` fallback but raw message otherwise),
`:157`, `src/components/contacts-page.tsx:101`, `:155`,
`src/components/settings-page.tsx:79`, `:155`, `src/components/contact-detail.tsx:59`; mobile
`src/screens/auth/WelcomeScreen.tsx:31`, `src/navigation/RootNavigator.tsx:86-88`, `:99-101`,
`src/screens/main/MessageRequestsScreen.tsx:57`, `:76`,
`src/components/PaymentRequestBubble.tsx:36-42`,
`src/components/ComposerAttachButton.tsx:28-33`, `src/components/ThreadTipBar.tsx:26`, `:34-40`.

---

## C. Session / auth state contract

Eight states. Each has exactly one canonical label, one body line, one primary action, and at
most one secondary action. The same eight render identically on both platforms.

| State | Label | Body | Primary | Secondary | Mobile owner | Web owner |
| --- | --- | --- | --- | --- | --- | --- |
| No identity | `Not connected` | `Pubky Ring holds your key. Hypercolor never sees it.` | `Connect with Pubky Ring` | — | `useAuthStore.isAuthenticated === false` (`src/stores/authStore.ts`), gating `RootNavigator.tsx:129` | `SessionUiStatus.kind === 'no-identity'`, label at `src/lib/session-ui.ts:20-21`; `hasIdentity()` false at `:3-10` |
| Needs enable | `Messaging not enabled` | `Approve the Paykit and Hypercolor write scopes in Pubky Ring.` | `Enable encrypted messaging` | `Not now` | `LinkEnableStatus === 'needs-enable'` (`src/services/link/LinkService.ts:135`, produced at `:244-246`) | `SessionUiStatus.kind === 'needs-enable'`, label `Identity adopted — enable messaging` at `src/lib/session-ui.ts:22-23` |
| Waiting for Ring | `Waiting for Pubky Ring…` | `Approve the request in Pubky Ring, or scan the code on another device.` | `Open Pubky Ring` | `Copy authorization URL` | `EnableMessagingState.phase === 'authorizing'` (`src/screens/main/enableMessagingController.ts:85`), label `src/screens/main/EnableMessagingScreen.tsx:37-38` | `usePaykitConnect` pending; label `Waiting for Pubky Ring…` at `src/components/enable-page.tsx:60` |
| Expired | `Authorization expired` | `The paykit-connect link is only valid for five minutes.` | `Generate new authorization` | `Cancel` | handoff TTL comment `src/services/PubkyRingAuthService.ts:73-74`; screen has no expired phase today — add one | `HANDOFF_TTL_MS` (`src/services/RingConnect.ts:11`), consumed at `src/hooks/usePaykitConnect.ts:97`; labels `src/components/welcome-page.tsx:59-61` and `src/components/enable-page.tsx:59` |
| Denied | `Authorization declined` | `Pubky Ring did not grant the scopes Hypercolor asked for.` | `Try again` | `Cancel` | `EnableMessagingState.phase === 'error'` (`src/screens/main/enableMessagingController.ts:115`, `:138`) with the declined branch split out | web `enable-page.tsx:52-54` `Could not enable encrypted messaging`, split the declined branch out of the generic error |
| Offline | `You are offline. Messages will send when you reconnect.` | *(label is the body; no second line)* | `Try again` | — | `LinkEnableStatus === 'session-offline'` (`src/services/link/LinkService.ts:243`); phase at `src/screens/main/enableMessagingController.ts:158` | `SessionUiStatus.kind === 'session-offline'` (`src/lib/session-ui.ts:24-25`), rendered by `src/components/session-banner.tsx:14-46` |
| Revoked | `Access was revoked` | `Pubky Ring no longer grants Hypercolor write access. Your local history is untouched.` | `Enable encrypted messaging` | `Sign out` | derived: `getEnableStatus()` returns `needs-enable` after a previously published receiver exists (`src/services/link/LinkService.ts:245-247`) — the screen must distinguish "never enabled" from "was enabled, now not" | derived the same way from `getEnableStatus()` in `src/services/link/session.ts`, surfaced through `sessionStatusStore.setFromRestore` |
| Enabled | `Encrypted messaging enabled` | `Ring approved the grant and this device published a receiver marker.` | `Open chats` | `Authorize again` | `LinkEnableStatus === 'enabled'` (`src/services/link/LinkService.ts:247`); phase `success` (`src/screens/main/enableMessagingController.ts:107`), label `src/screens/main/EnableMessagingScreen.tsx:39-40` | `SessionUiStatus.kind === 'enabled'` (`src/lib/session-ui.ts:28-29`); `isMessagingEnabled()` at `:12-14` |

Two additional non-states exist in code and must never reach the user as a state label:

- Mobile `native-missing` (`src/services/link/LinkService.ts:240`, label `Native module missing`
  at `src/screens/main/EnableMessagingScreen.tsx:31-32`) is a build defect, not a user state.
  It renders as `Encrypted messaging is unavailable in this build.` with no action.
- Web `unknown` (`src/lib/session-ui.ts:18-19`, `Checking session…`) is a loading state, not a
  session state. It renders as a skeleton, never as a banner.

Mobile must gain an app-level `StatusBanner` above the tab content that renders the Offline
and Revoked states, mirroring web's `src/components/session-banner.tsx`. Today mobile only
shows those states inside the Enable screen, so a user whose session dropped while sitting in
Chats sees nothing.

---

## D. Per-screen specifications

Acceptance criteria are written as observable statements. `AC` numbering is per screen.

### D.1 Welcome / Connect

*Mobile `src/screens/auth/WelcomeScreen.tsx` · Web `/` `src/components/welcome-page.tsx`*

**Layout regions.** (1) Product name. (2) Custody line (§B.4). (3) One-line explanation of
what Connect does. (4) Primary button. (5) Auth panel (QR + copyable URL) once a link exists.
(6) Adoption confirmation block when a pubky is pending.

**Actions.** Primary `Connect with Pubky Ring`. Secondary, only when a link exists:
`Copy paykit-connect URL`. When expired: `Generate new link` replaces the panel.

**Exits.** Mobile: none — this is the root of the unauthenticated stack; the OS back gesture
exits the app. Web: none; there is no signed-in shell to return to.

**States.**

- Loading: `Preparing paykit-connect…` (web current string at
  `src/components/welcome-page.tsx:54` — keep).
- Expired: `This paykit-connect link expired. Generate a new one.` (web current string at
  `:60-61` — keep) with `Generate new link`.
- Error: `Could not start authorization.` plus collapsed `Details`. Replaces mobile's raw
  `Alert.alert('Error', (err as Error).message ?? 'Failed to start pubky-ring authorization')`
  (`src/screens/auth/WelcomeScreen.tsx:31`).
- Offline: `You are offline. Connect again when you reconnect.` with `Try again`.
- Adoption pending: `Continue as {pubky}?` with `Continue` / `Cancel` (web current at
  `src/components/welcome-page.tsx:70-80`).

**AC.**
1. The custody line (§B.4) is present verbatim before any button is pressed.
2. No string on this screen contains `pubky-ring` in lowercase-hyphenated form.
3. Pressing the primary button twice within the TTL does not create a second pending
   authorization; the second press is a no-op while a link is live.
4. When the link is older than five minutes, the QR is replaced by the expired copy and the
   only enabled action is `Generate new link`.

### D.2 Awaiting Ring authorization

*Mobile `src/screens/auth/AwaitingRingAuthScreen.tsx` · Web: inline panel on `/`*

**Layout regions.** (1) Back control. (2) Title `Waiting for Pubky Ring…`. (3) Body
`Approve the request in Pubky Ring, or scan the code on another device.` (4) QR. (5) Primary
`Open Pubky Ring`. (6) Secondary `Copy paykit-connect URL`. (7) Custody line.

**Exits.** Back cancels the pending authorization and returns to Welcome. Android hardware
back does the same. Cancelling must abort the in-flight poll, not orphan it.

**States.** Waiting (default), Expired (§C), Denied (§C), Offline (§C).

**Current divergent strings.** `Waiting for pubky-ring`
(`src/screens/auth/AwaitingRingAuthScreen.tsx:43`), `Approve the authorization in pubky-ring
to continue.` (`:45`), `Scan with Bitkit or Pubky Ring on this or another device.` (`:52`).
The Bitkit mention is removed: Bitkit is a wallet handoff boundary, not an authorizer, and
naming it here is a wrong instruction.

**AC.**
1. Back is reachable with a ≥44pt target and cancels the pending authorization.
2. After five minutes without approval the screen shows the Expired state and the QR is no
   longer rendered.
3. The screen never instructs the user to scan with Bitkit.

### D.3 Enable Messaging — all phases

*Mobile `src/screens/main/EnableMessagingScreen.tsx` (+ `enableMessagingController.ts`) ·
Web `/enable` `src/components/enable-page.tsx`*

**Layout regions.** (1) Header with Back. (2) Title `Enable encrypted messaging`. (3) Body:
canonical scope sentence (§B.1), with the literal scope string
`/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw` below it in monospace secondary text. (4) Status
block. (5) Phase content. (6) Custody line pinned at the bottom.

**Phases.**

| Phase | Status label | Phase content | Primary | Secondary |
| --- | --- | --- | --- | --- |
| Checking | `Checking messaging status…` | skeleton | — | — |
| Needs enable | `Messaging not enabled` | scope explanation | `Enable encrypted messaging` | `Not now` |
| Authorizing | `Waiting for Pubky Ring…` | QR + copyable URL | `Open Pubky Ring` | `Copy authorization URL` |
| Expired | `Authorization expired` | expired copy | `Generate new authorization` | `Cancel` |
| Denied | `Authorization declined` | declined copy | `Try again` | `Cancel` |
| Offline | `Session offline` | offline copy | `Try again` | `Cancel` |
| Unavailable | `Encrypted messaging is unavailable in this build.` | nothing | — | `Back` |
| **Success** | `Encrypted messaging enabled` | see below | **`Open chats`** | `Done` |

**Success surface (decision 4, resolves P0-1).** Full-height centred block:

1. A brand-tinted success glyph.
2. Title `Encrypted messaging enabled`.
3. One body line: `Ring approved the grant and this device published a receiver marker.`
4. **Primary full-width button `Open chats`.**
5. Text secondary `Done`.

`Open chats` resets the navigation stack to the Chats tab — mobile
`nav.reset({ index: 0, routes: [{ name: 'Main', params: { screen: 'Chats' } }] })`, web
`router.replace('/chats')`. `Done` pops back to the screen the user came from (Chats CTA,
Thread CTA, or Settings row). Hardware/gesture back behaves as `Done`. Neither exit can
re-enter the `authorizing` phase.

The current mobile success surface — the sentence `Ring approved the grant and this device
published a receiver marker. You can leave this screen.`
(`src/screens/main/EnableMessagingScreen.tsx:158-161`) with only a small `← Back` text control
(`:85`) — is replaced. The trailing `You can leave this screen.` is deleted: it is an
instruction where a button belongs. Web's equivalent, an inline `Open chats` link
(`src/components/enable-page.tsx:74-78`), becomes the same primary button.

**Return from Ring while backgrounded (decision 4).** On mobile, the screen subscribes to
`AppState`. On every transition to `active`, and on web on every `visibilitychange` to
visible, the screen re-runs `getEnableStatus()` before rendering:

- `enabled` → render Success immediately. The screen must never show
  `Waiting for Pubky Ring…` after the grant already landed.
- still pending and within the five-minute TTL → keep Authorizing, with the QR refreshed.
- still pending and past the TTL → render Expired.
- offline → render Offline.

`hypercolor://ring-callback` arriving while this screen is mounted is handled by
`RootNavigator.tsx:92-103` and must push the resulting status into the same controller rather
than only firing an `Alert`.

**AC.**
1. In the success phase a full-width `Open chats` button is present and is the only
   brand-filled control on screen.
2. Tapping `Open chats` lands on the Chats tab and pressing back from there does not return
   to the Enable screen.
3. Backgrounding the app during `authorizing`, approving in Ring, and returning shows the
   success phase within one render, with no intermediate `Waiting for Pubky Ring…`.
4. Backgrounding for longer than five minutes without approving returns to the Expired phase
   with `Generate new authorization`.
5. `Native module missing` never appears as a status label.

### D.4 Chats list

*Mobile `src/screens/main/ChatsScreen.tsx` · Web `/chats` master pane
`src/components/chats-page.tsx`*

**Content (decision 1). Chats lists one-to-one DMs only.** Private groups and public topics
live in Channels. Web's `loadInboxRows` currently merges DMs and group channels
(`src/stores/inboxStore.ts:33-49`); the group half moves to the Channels store. Mobile is
already DM-only (`StorageService.listLinkConversations`) and does not change.

Rationale: with a dedicated Channels destination in the four-slot tab bar, merging groups into
Chats either duplicates every group in two places or leaves Channels holding only public
topics — which would make the Private/Public segmented control lopsided and make "Channels"
mean "public", contradicting §A.4. One row type per list also lets the Chats row show a peer
avatar and a message status, which a group row cannot.

**Layout regions.** (1) Header: title `Chats`, trailing `New chat` action. (2) Pinned
Message-requests row. (3) Session `StatusBanner` when offline or revoked. (4)
`EnableMessagingCta` when `LinkEnableStatus !== 'enabled'`. (5) Conversation list.

**Pinned requests row (decision 2).** Always rendered directly beneath the header, above the
`EnableMessagingCta`:

- Label `Message requests`
- Trailing `Badge` with the pending count when `> 0`; no badge at zero
- Row is tappable at zero as well, so the queue is reachable to check
- The same count renders as a badge on the Chats tab (mobile) / Chats nav link (web)

**Actions.** Primary `New chat` → Contact search. Row tap → Thread. Row long-press (mobile) /
row overflow (web) → `Mute`, `Delete chat` (both already backed by storage).

**Exits.** Mobile: tab root, no back. Web `<md`: selecting a row navigates to the detail
route; the detail pane carries its own Back (§D.18).

**States.**

- Loading: three skeleton rows.
- Empty: title `No chats yet.` body `Add someone by pubky, then start a chat. Nobody can
  message you first until you have talked before or you invite them.` Primary `Add a contact`.
  Replaces `No conversations yet.` / `Search for a contact to start chatting.`
  (`src/screens/main/ChatsScreen.tsx:141-142`).
- Needs enable: the `EnableMessagingCta` block, title `Messaging not enabled`, body
  `Approve the Paykit and Hypercolor write scopes in Pubky Ring.`, action
  `Enable encrypted messaging`.
- Offline: banner `You are offline. Messages will send when you reconnect.` with `Try again`.
- Error: `Could not load your chats.` with `Try again` and collapsed `Details`.

**AC.**
1. No private group and no public topic appears in the Chats list on either platform.
2. The `Message requests` row is present when the list is empty and when it is populated.
3. The badge count on the row and the badge count on the Chats tab/nav link are the same
   number in the same render.
4. With `LinkEnableStatus === 'needs-enable'`, the composer entry point (`New chat`) is
   disabled and the enable CTA is the only brand-filled control.

### D.5 Thread (DM)

*Mobile `src/screens/main/ThreadScreen.tsx` · Web `/chats/{id}`
`src/components/thread-view.tsx`*

**Layout regions.** (1) Header: Back, peer identity, overflow. (2) Message list. (3) Status
banner slot. (4) Composer: action button, text input, send.

**Header identity.** Display name when known, else `shortPubky`. The full pubky moves into the
overflow menu and Contact detail. Web currently renders the full monospace pubky as the header
title (`src/components/thread-view.tsx:74`), which wraps to three lines on a phone.

**Back (web, resolves P0-3).** The header Back control renders at all viewport widths and is
the first focusable element in the detail pane. See §D.18.

**Message status.** Outbound only, per §B.3: `Queued` / `Sent` / `Failed`. `Failed` renders a
`Retry` action inline (web already has one at `src/components/message-bubble.tsx:55`; mobile
must add it). Inbound bubbles render no status. The formatters at
`src/screens/main/ThreadScreen.tsx:456-470` and `src/components/message-bubble.tsx:17-26` are
rewritten to the four-value mapping, with `delivered` and `read` folded into `Sent`.

**Composer.** The `+` control opens the `ComposerActionMenu` sheet (§D.11) rather than the
current `Alert.alert('Attach', 'Choose a source', …)`
(`src/components/ComposerAttachButton.tsx:43-75`). Send is disabled when the draft is empty or
a send is in flight.

**States.**

- Loading: skeleton bubbles.
- Empty: `No messages yet.` body `Say something. Only the two of you can read this.`
- Needs enable: composer replaced by the enable CTA block; text input not focusable.
- Offline: banner `You are offline. Messages will send when you reconnect.` The composer stays
  usable and sends enter the queue as `Queued`.
- Send error: the bubble shows `Failed` with `Retry`. Replaces mobile's
  `Alert.alert('Send failed', …)` (`src/screens/main/ThreadScreen.tsx:119`).
- Attachment error: an inline failed attachment bubble with `Retry`, replacing
  `Alert.alert('Attachment failed', message)`
  (`src/components/ComposerAttachButton.tsx:34`).

**AC.**
1. `delivered` and `read` never render, for any message, in any locale.
2. An inbound bubble renders no status text.
3. With the network off, sending shows `Queued`; restoring the network transitions the same
   bubble to `Sent` without a reload.
4. On web at 375px the Back control is visible in the header without scrolling.
5. The peer's full pubky is not the header title at any viewport width.

### D.6 Message requests

*Mobile `src/screens/main/MessageRequestsScreen.tsx` · Web `/requests`
`src/components/requests-page.tsx`*

**Layout regions.** (1) Header with Back and title `Message requests`. (2) Explanatory
paragraph. (3) Request list. (4) Invite block (always present, see below).

**Explanatory paragraph (canonical).** `New inbound chats wait here until you accept. Nothing
is auto-accepted — following someone does not open your inbox to them. Accepting opens the
chat and any held group invitations. Declining drops the held items and remembers the
decline.` This replaces web's version at `src/components/requests-page.tsx:72-77`, whose
`Group invitations show a name only.` sentence moves to the invitation row itself, and mobile's
`Inbound links from people you do not follow wait here.`
(`src/screens/main/MessageRequestsScreen.tsx:172`), which is wrong for the same reason as
§B.5 — the follow relationship is not what gates the queue.

**Decline is not a block.** The user may still open a thread and send to that pubky.
Sending a message to a declined-not-blocked peer accepts the request (`declined →
accepted`) atomically before Encrypted Link establishment. The thread shows a
one-line notice above the composer until that send (or until Accept from the
Declined section): `You declined a request from this person. Sending a message
accepts it.` Requests lists declined rows under `Declined` with an explicit
`Accept` that performs the same user-initiated promotion without messaging.
`acceptMessageRequest` still refuses a declined row — inbound Accept is unchanged.
Sticky `upsertMessageRequest` cannot overwrite `declined`. Inbound from that peer
is not adopted until the row is `accepted`. Unblock remains the release path only
for a peer who was blocked.

**Held request row.** Display name or `shortPubky`, full pubky in monospace secondary, arrival
time, and any held group invitations as `Group invitation · {name}` (web already does this at
`src/components/requests-page.tsx:98-107`; mobile must add it — mobile currently shows only
the hint `Inbound message request`, `src/screens/main/MessageRequestsScreen.tsx:127`).
**No message body preview renders before accept, on either platform.** Mobile already does not
preview; web must not add one. A stranger must not be able to place arbitrary text in your UI
before you accept them.

**Actions per row.** `Accept` (brand) and `Decline` (outline). Both disabled while that row is
busy.

**Invite block (honest interim UI for ADR 0004).** Because stranger-first-DM discovery is not
implemented, someone who has never talked to you cannot reach this queue at all. The screen
says so and gives the working alternative:

> Someone who has never messaged you cannot reach this queue yet — Hypercolor has no public
> drop point. Share your pubky and they can start the chat.
>
> [Copy my pubky] [Share]

**States.**

- Empty: `No pending requests.` body `New inbound chats wait here until you accept.` plus the
  invite block. (Web current empty copy at `src/components/requests-page.tsx:81-84` is close;
  mobile's at `:170-173` is replaced.)
- Loading: two skeleton rows.
- Accept error: inline row error `Could not accept this request.` with `Try again` and
  collapsed `Details`, replacing raw `err.message`
  (`src/components/requests-page.tsx:130`, mobile `Alert.alert('Accept failed', …)` at
  `src/screens/main/MessageRequestsScreen.tsx:57`).
- Decline error: same shape (`src/components/requests-page.tsx:157`,
  `src/screens/main/MessageRequestsScreen.tsx:76`).
- Offline: rows render read-only; `Accept` and `Decline` disabled with the banner above.

**AC.**
1. No inbound message body text renders on this screen before that request is accepted.
2. The invite block is present in both the empty and the populated state.
3. Accepting a request whose sender also has a held group invitation resolves both, and the
   resulting chat appears in Chats without a reload.
4. The copy on this screen never says that following someone auto-accepts their messages.

### D.7 Contacts — populated

*Mobile `src/screens/main/ContactsScreen.tsx` · Web `/contacts`
`src/components/contacts-page.tsx`*

**Layout regions.** (1) Header: title `Contacts`, trailing `Add`. (2) Add/search panel (web
inline, mobile pushed screen). (3) Contact list, sorted by relationship then trust
(`src/screens/main/ContactsScreen.tsx:93-100`). (4) Suggestions section, only when follows
import is on.

**Requests entry removed.** The header Requests button
(`src/screens/main/ContactsScreen.tsx:163-168`) is deleted per §A.3.

**Row.** Avatar, display name or `shortPubky`, relationship chip (`Mutual` / `Following` /
`Follower`), trailing chevron. Tap opens Contact detail (§D.9), not the thread — the thread is
one action inside the detail.

**Suggestions section.** Header `Suggestions from your follows`, subcopy `Not your contact
list. Add one to keep them. Hypercolor never writes a follow.` Each row has `Add as contact`.
Current web strings at `src/components/contacts-page.tsx:243-245`, `:263`.

**Pull-to-refresh (mobile).** Re-reads local contacts and, **only if follows import is already
consented**, re-reads the follows listing. Today `handleRefresh` calls
`ContactsService.importFollows` and `syncRelationships` unconditionally
(`src/screens/main/ContactsScreen.tsx:53-72`), which performs a homeserver read and a Nexus
call with no opt-in. That is the defect §D.8 fixes.

**States.** Loading skeleton; Error `Could not load contacts.` with `Try again`; Offline banner
with the list rendered from local storage.

**AC.**
1. With follows import off, a pull-to-refresh performs no homeserver follows read and no Nexus
   request.
2. A suggestion row is visually distinct from a contact row and is never counted in the
   contact total.
3. Tapping a contact row opens Contact detail on both platforms.

### D.8 Contacts — empty state and follows-import consent (decision 3)

**Empty state.** Regions: illustration-free centred `EmptyState`.

- Title `No contacts yet.`
- Body `Add someone by pubky, or use your public pubky.app follows to recognise people you
  already know.`
- Primary `Add someone by pubky`
- Secondary `Use my follows`

This replaces `No contacts yet.` / `Pull to import follows, or add someone by pubky.`
(`src/screens/main/ContactsScreen.tsx:191-192`), which advertises a gesture that does not exist
on an empty `FlatList` in any discoverable way.

**Consent sheet.** `Use my follows` opens a sheet containing the canonical consent block from
§B.5 verbatim. The `Use my follows` confirm button is disabled until the checkbox is checked.
No network read happens before confirm. Confirm persists a per-owner
`followsImportEnabled` flag (web already has `setFollowsImportEnabled`, mobile adds the
equivalent) and then runs `ContactsService.importFollows`.

**After consent.** Contacts grows a `pubky.app follows` section with `Refresh follows` and
`Stop using follows`, mirroring web's panel (`src/components/follows-import-panel.tsx:58-118`).
`Stop using follows` clears the imported relationship flags and shows
`Import is off. Imported suggestions were cleared.` — the current web note's auto-accept
clause (`:106-108`) is deleted per §B.5.

**States.**

- Import running: `Reading…` on the button, list unchanged.
- Import result: `Imported {n} confirmed follows as suggestions.` or `No confirmed follows
  yet.` (web current at `src/components/follows-import-panel.tsx:151-154`).
- Import failed: `Could not read your follows.` with `Try again` and collapsed `Details`,
  replacing mobile's `Import failed: {message}` (`src/screens/main/ContactsScreen.tsx:61`).
- Nexus fallback used: append `Read from the public index and re-checked against your
  homeserver.`
- Offline: `Use my follows` disabled with `You are offline.`

**AC.**
1. From a cold install with zero contacts, follows import is reachable in two taps
   (`Contacts` → `Use my follows`).
2. No request to `/pub/pubky.app/follows/` and no Nexus request is issued until the consent
   checkbox is checked and confirm is pressed.
3. The consent copy contains no sentence claiming that follows are auto-accepted.
4. Turning import off removes every suggestion row without removing any added contact.

### D.9 Contact detail

*Mobile: new `ContactDetail` screen · Web `/contacts/{pubky}`
`src/components/contact-detail.tsx`*

Mobile has no contact detail today — a contact row goes straight to the thread — so the pubky,
relationship, and trust explanation have no home. This screen is added on mobile and
restructured on web.

**Layout regions.** (1) Header with Back. (2) Identity block: avatar, display name, full pubky
with `Copy`. (3) Relationship block: `Mutual` / `Following` / `Follower` / `No relationship`,
plus the trust explanation already produced by `TrustEngine.explain`
(`src/screens/main/ContactsScreen.tsx:41-43`). (4) Actions. (5) Danger block.

**Actions.** Primary `Message`. Secondary `Copy pubky`, `Share`.

**Payment methods.** Mobile keeps a read-only `Public payment methods` block sourced from the
peer's Paykit receiver. **Web removes it** (decision 5): `src/components/contact-detail.tsx:124`
renders the heading and `:126` renders `Read-only from their Paykit receiver. This app does not
send payments.` — a block whose own subtitle says it cannot be acted on, which also triggers a
network read on every contact open. It is deleted from web rather than reworded.

**Danger block.** `Block` and `Remove contact`, each behind a confirmation sheet naming what is
deleted locally. `Block` is fail-closed and inbound-authoritative: the owner-scoped deny is
persisted first; leftover Encrypted Link cleanup is retryable. Unblock is an explicit user
action, never a side effect of adding a pubky.

**Block / Unblock contract.**

- **Blocked.** Contact detail (and the search/add flow for that pubky) shows `Blocked` and an
  `Unblock` action. Message and Block are hidden. The Unblock confirmation body is: `They can
  send you a message request again. No chats, encrypted link, or contact data is restored.`
- **Blocked · cleanup pending.** A leftover contact row stays in the list with that label after
  a Block whose decline/delete failed. Contact detail shows the same label, `Retry` (finishes
  cleanup while the deny stays), and `Unblock`. Navigating away and back keeps Retry — cleanup
  pending is persisted per owner, not component state.
- **Unblock and add.** Pasting a blocked pubky does not lift the deny. Search (and Add as
  contact) returns a blocked result and opens `This pubky is blocked. Unblock and add?`
  Decline keeps the block. Confirm persists the contact first, then lifts the deny and
  releases the terminal `declined` row. If persist fails, the deny remains.
- **Fail-closed ordering.** Block: deny, then decline, then delete contact. Unblock: release
  declined row, then drop the deny. Manual add of a blocked pubky: persist contact, then
  unblock. Inbound and handshake establishment consult the deny at the Encrypted Link choke
  point; queued payloads for a blocked peer are dropped as `Failed` (not delivered),
  not retried. Group fan-out records a per-recipient terminal state; the group
  message derives an aggregate from those states (`Sent`, `Sent to N of M`,
  `Not delivered to {name} (blocked)`), never from drain order. A declined message
  request is not a deny at this choke.
- **Send to a blocked pubky.** The thread shows `You blocked this contact. Unblock
  to message them.` with `Unblock`. Send never surfaces an internal error string.
- **Block sheet.** Names local deletion (contact row, Encrypted Link, one-to-one messages,
  follows-import skip) and states that Unblock is a separate action — adding the pubky again
  does not lift the block.

**States.** Loading skeleton; `Could not load this contact.` with `Try again`; Offline renders
from local storage with the payment block (mobile) collapsed and labelled `Unavailable
offline`; `Blocked`; `Blocked · cleanup pending` with `Retry`; send-to-blocked
`You blocked this contact. Unblock to message them.` with `Unblock`.

**AC.**
1. The full pubky is selectable and copyable on both platforms.
2. Web's contact detail issues no Paykit receiver request.
3. `Message` opens the thread and back from the thread returns to contact detail, not to the
   contacts list.

### D.10 Channels — Private / Public modes

*Mobile `src/screens/main/ChannelsScreen.tsx` · Web `/channels`
`src/components/channels-page.tsx` (+ folded `src/components/discover-page.tsx`)*

**Layout regions.** (1) Header: title `Channels`, trailing `+`. (2) Segmented control
`Private` | `Public`. (3) Mode-specific banner. (4) List. (5) Create/join sheets.

**Private mode.** Lists private groups. Row: avatar initial, name, relative time, meta
`Private group` (`src/screens/main/ChannelsScreen.tsx:197`). Empty state: title `No private groups yet.` body `A private group is
end-to-end encrypted to every member, up to 50 people.` primary `New private group`.
Replaces `No channels yet.` / `Create a private group or join a public channel.`
(`src/screens/main/ChannelsScreen.tsx:220-221`), which described both modes at once.

**Public mode.** Shows the public-graph warning (§B.6) above the list, then the platform's
public list, then one substrate line so the two clients are not misrepresented as identical:

- Mobile: `Public topics here are Hypercolor rooms on your homeserver.`
- Web: `Public topics here are tags on the public Pubky graph.`

Mobile public list: joined public channels, row meta `Public topic`, header actions
`New public topic` and `Join by link`. Web public list: hot tags from the public index, gated
behind the existing explicit `Load public topics` button
(`src/components/discover-page.tsx:60`) so no index query happens on navigation. Web empty:
`The public index has no topics right now.` (current: `The public index has no hot tags right
now.`, `:70`). Web error: `Could not reach the public index.` with `Try again` (current: raw
error at `:64-66`).

**Create sheet (mobile).** Title `New channel` (`:235`) becomes `New`. The
`Private group` / `Public` toggle (`:248`, `:254`) stays. Selecting `Public` reveals the
public-graph warning inside the sheet before the create button is enabled. Cancel at `:293`.

**Join sheet (mobile).** Title `Join public channel` (`:312`) becomes `Join a public topic`;
placeholder `hypercolor://join-public?channel=…` (`:317`) stays.

**Modal dismissal.** Both mobile modals must set `onRequestClose` so the Android hardware back
button dismisses them. Neither does today (`src/screens/main/ChannelsScreen.tsx:232`, `:309`).

**AC.**
1. Navigating to Channels issues no request to the public index; the index is only queried
   after `Load public topics` is pressed in Public mode.
2. The Android hardware back button dismisses the create sheet and the join sheet.
3. The public-graph warning is visible before any public post can be composed.
4. Web `/discover` and `/discover/{tag}` resolve to Channels in Public mode rather than 404.

### D.11 Channel / group view and the composer action menu

*Mobile `src/screens/main/ChannelScreen.tsx` · Web `src/components/channel-view.tsx`,
`src/components/tag-channel-view.tsx`, `src/components/composer.tsx`*

**Layout regions.** (1) Header: Back, channel name, member count, overflow. (2) Message list.
(3) Composer.

**Message status.** Private group outbound messages use the §B.3 four-value mapping. The raw
enum interpolation at `src/screens/main/ChannelScreen.tsx:357` is replaced by the shared
formatter. Public topic messages show no delivery status at all — a public write has no
per-recipient state.

**ComposerActionMenu (sheet).** Opened by the composer `+`. Items, in order, each with an icon
and a label:

| Item | Private DM | Private group | Public topic |
| --- | --- | --- | --- |
| `Photo` | yes | yes | yes |
| `File` | yes | yes | yes |
| `Request payment` | mobile only | no | no |
| `Send a tip` | mobile only | no | no |
| `Cancel` | yes | yes | yes |

Web's menu contains `Photo`, `File`, `Cancel` only (decision 5). The sheet replaces mobile's
`Alert.alert('Attach', 'Choose a source', [...])`
(`src/components/ComposerAttachButton.tsx:43-75`) and absorbs the two chips currently floating
above the composer, `Tip` and `Send my tip list`
(`src/components/ThreadTipBar.tsx:64`, `:67`).

**Permission denial.** `Photo library access is required to send images.`
(`src/components/ComposerAttachButton.tsx:50`) becomes an inline composer notice with an
`Open settings` action rather than a bare alert.

**AC.**
1. A raw `deliveryState` enum value never renders as visible text.
2. A public topic message shows no status text.
3. Every composer action is reachable in one tap from the composer, and the sheet dismisses on
   backdrop tap, `Cancel`, and Android hardware back.

### D.12 Payment Review (mobile)

*New sheet, mobile only. Replaces the inline destination picker in
`src/components/PaymentRequestBubble.tsx:118-178` and the direct `openPayUri` call in
`src/components/ThreadTipBar.tsx:25-27`.*

A wallet handoff currently happens on a single tap: `Open wallet`
(`src/components/PaymentRequestBubble.tsx:175`) and `Pay in wallet`
(`src/components/ThreadTipBar.tsx:97`) both leave the app immediately. Every handoff now goes
through one Review sheet.

**Layout regions.** (1) Title `Review before paying`. (2) Recipient: display name and
`shortPubky`. (3) Amount: the requested amount and, when the destination carries an invoice,
the invoice amount on its own line. (4) Destination: the selected endpoint identifier
(`formatTipIdentifierDisplay`) and payload preview. (5) Warnings. (6) Actions.

**Amount mismatch.** When `prepareRequestHandoff` returns an invoice amount that differs from
the requested amount, the sheet shows a warning row `The invoice is for {invoice} BTC, not the
{requested} BTC that was requested.` and the primary button stays enabled but is outline, not
brand-filled. When `prepareRequestHandoff` returns `ok: false`, the primary button is disabled
and the error renders in the warnings region.

**Expiry.** When the destination invoice has expired, the sheet shows `This invoice expired.`
and the primary is disabled. (`ThreadTipBar` already computes this at
`src/components/ThreadTipBar.tsx:75-77`.)

**Actions.** Primary `Open wallet`. Secondary `Copy payment URI`. Text `Cancel`.

**Exits.** `Cancel`, backdrop tap, and Android hardware back all dismiss without recording a
displayed invoice.

**States.** Destination list empty: `This peer has no destination that matches this request.`
(current: the thrown `No matching destination from this peer for this request`,
`src/components/PaymentRequestBubble.tsx:96-100`). Offline: destinations render from cache and
`Open wallet` stays enabled — the handoff is a local URI open. Handoff failure:
`No app on this device can open that payment link.` with `Copy payment URI` promoted to
primary.

**AC.**
1. No code path opens a `lightning:` or `bitcoin:` URI without this sheet having been
   displayed and confirmed.
2. When the invoice amount differs from the requested amount, both numbers are visible in the
   same view before the wallet opens.
3. Cancelling records no displayed invoice.

### D.13 Backup / recovery-code gate

*Mobile `src/screens/main/SettingsScreen.tsx:92-165` · Web `/settings`
`src/components/settings-page.tsx:79-155`*

**Layout regions.** (1) Section title `Encrypted backup`. (2) Explanation. (3) Recovery code
block. (4) Confirmation gate. (5) Restore block.

**Explanation (canonical).** `A backup encrypts your local history with a recovery code. Only
you have that code — Hypercolor cannot restore your history without it.` Followed by the
backup custody line from §B.4.

**Recovery code display.** The code renders in monospace, chunked, with a `Copy` action. Above
it: `Write this recovery code down` (mobile current at
`src/screens/main/SettingsScreen.tsx:125`, web at `src/components/settings-page.tsx:89`).

**Gate (ruling: the code cannot be casually left).** While a freshly generated code is on
screen, the section cannot be dismissed until the user checks
`☐ I have written this code down` and presses `Done`. On mobile, hardware back and the
Settings back control are intercepted while the code is displayed and show a confirmation:
`Leave without saving your recovery code? Your backup cannot be restored without it.` with
`Go back` and `Leave anyway`. On web, the same confirmation is wired to `beforeunload` and to
in-app navigation away from `/settings`.

**Restore block.** Input placeholder `Paste recovery code to restore` (both platforms already:
`src/screens/main/SettingsScreen.tsx:139`, `src/components/settings-page.tsx:133`), action
`Restore from backup` (`src/screens/main/SettingsScreen.tsx:165`). Success note (web current
at `src/components/settings-page.tsx:151`, adopted verbatim on mobile): `Restore complete.
History is local. Enable messaging again so links re-handshake. Attachments without keys stay
unavailable until re-shared.`

**States.** Backup running: `Encrypting…`. Backup failed: `Could not create a backup.` with
`Try again` and collapsed `Details`, replacing raw `err.message`
(`src/components/settings-page.tsx:79`). Restore failed: `That recovery code did not work.`
with collapsed `Details`, replacing `src/components/settings-page.tsx:155`. Offline: both
actions stay enabled — backup and restore are local.

**AC.**
1. A newly generated recovery code cannot leave the screen without either the checkbox
   confirmation or an explicit `Leave anyway`.
2. The recovery code is never rendered inside a screenshot-friendly toast or an OS alert.
3. The backup custody line (§B.4) is present wherever a recovery code is displayed.

### D.14 Profile

*Mobile `src/screens/main/ProfileScreen.tsx` · Web `/profile`
`src/components/profile-page.tsx`*

**Layout regions.** (1) Identity block: avatar, display name, full pubky with `Copy`. (2)
Custody line (§B.4). (3) Session status row rendering the §C state with its action. (4)
Navigation rows: `Settings`, `Message requests`. (5) Danger row `Sign out`.

**Current divergent strings.** `Keys managed by pubky-ring`
(`src/screens/main/ProfileScreen.tsx:84`) and `Keys managed by Pubky Ring`
(`src/components/profile-page.tsx:43`) both become the canonical custody line.
`Not connected` (`src/components/profile-page.tsx:40`) is retained as the no-identity label
per §C. The danger button `Disconnect pubky-ring`
(`src/screens/main/ProfileScreen.tsx:127`, a11y label `:123`) becomes `Sign out`.

**AC.**
1. Profile is the only route to Settings on both platforms.
2. The session status row shows the same label as the app-level banner for the same state.

### D.15 Sign-out confirmation

*Sheet over Profile on both platforms. Mobile replaces the `Alert.alert` in `handleSignOut`
(`src/screens/main/ProfileScreen.tsx:32-48`).*

**Canonical copy.**

> **Sign out of Hypercolor?**
>
> This device deletes your chats, groups, contacts, attachments, and the Paykit session.
> Pubky Ring keeps your key and your identity — you can connect again and re-authorize.
>
> If you have not made an encrypted backup, this history is not recoverable.
>
> [Sign out] [Cancel]

`Sign out` is destructive-styled; `Cancel` is the default focus. When no backup exists, the
third line is shown; when a backup exists, it is replaced by `Your last backup was
{relative time}.`

Current divergent strings: title `Disconnect from pubky-ring`
(`src/screens/main/ProfileScreen.tsx:34`) and body `This removes Hypercolor's delegated
access. You will need to re-authorize with pubky-ring to use the app.` (`:35`) — the current
body states what is revoked but not what is deleted, which is the part the user cannot undo.

**AC.**
1. The sheet enumerates local deletion and Ring retention in two separate sentences.
2. `Cancel` is the default-focused control.
3. Signing out returns to Welcome with no residual conversation visible.

### D.16 Settings

*Mobile `src/screens/main/SettingsScreen.tsx` · Web `/settings`
`src/components/settings-page.tsx`*

**Section order.** (1) Identity (pubky, custody line). (2) Messaging (`Enable encrypted
messaging` row showing the §C state). (3) Encrypted backup (§D.13). (4) Payments — mobile
only, hosting `TipEndpointsSettings`. (5) Privacy (`Anonymous delivery counters only`,
`src/screens/main/SettingsScreen.tsx:179`). (6) Experimental (`BLE Mesh (quarantined)`,
`:78`). (7) Developer — `__DEV__` / non-production only (`:329-372`).

**Current divergent strings.** `No identity on this device`
(`src/components/settings-page.tsx:46`) is retained. `Enable encrypted messaging` /
`Authorize Pubky Ring for Paykit links` (`src/screens/main/SettingsScreen.tsx:198-199`) — the
hint becomes the canonical scope sentence (§B.1). `Keys managed by pubky-ring` (`:214`)
becomes the custody line.

**AC.**
1. The Developer section does not render in a production build on either platform.
2. The messaging row label matches the §C label for the current state exactly.

### D.17 Web — responsive navigation

*`src/components/site-nav.tsx`, app shell*

At `≥md` the four primary links render as a horizontal row with the conditional `Enable` /
`Connect` link trailing in brand colour. At `<md` they render as a fixed bottom bar with icon
and label, mirroring the mobile tab bar, with the Chats badge (§A.3) on the Chats item. The
current implementation is a wrapping `flex` of seven text links
(`src/components/site-nav.tsx:38-55`) that occupies two lines on a phone and gives no active
affordance beyond an underline.

**AC.**
1. At 375px the primary navigation occupies one row and every target is ≥44×44px.
2. Exactly four primary links render, plus at most one conditional brand link.
3. The active destination is distinguishable without relying on colour alone.

### D.18 Web — list/detail Back (resolves P0-3)

Every master/detail route (`/chats/{id}`, `/channels/{id}`, `/contacts/{pubky}`) renders a
Back control as the first element of the detail pane header at `<md`. It calls
`router.push` to the list route (not `router.back()`, which is wrong on a deep link or a
refresh). At `≥md` the Back control is hidden because both panes are visible. Today the detail
panes render with the master hidden (`hidden md:block`, e.g.
`src/components/discover-page.tsx:42`) and no in-pane Back, so a `<md` user who opens a thread
has no way back except browser chrome — which a standalone-display PWA does not have.

**AC.**
1. At 375px, every detail pane has a visible Back control that returns to its list route.
2. Loading a detail route directly as the first navigation still shows a working Back.
3. At `≥md` no Back control renders in a detail pane.

### D.19 Session banner (both platforms)

*Web `src/components/session-banner.tsx` · Mobile: new app-shell component*

Renders only for the Offline and Revoked states (§C). Role `status`. One line of text plus one
action. It is not dismissible — the condition, not the user, ends it.

Web currently renders for `session-offline` and `unknown`
(`src/components/session-banner.tsx:14-16`); `unknown` is a loading state and is removed from
the banner condition per §C. Mobile has no banner and gains one above the tab content.

**AC.**
1. Turning the network off shows the banner within one poll interval on both platforms.
2. The banner never renders while the session state is merely being checked.
3. `Try again` re-runs the session restore and clears the banner on success.

### D.20 Web — tab lock and PWA update

**Tab lock** (`src/components/tab-lock-banner.tsx`). Copy becomes: `Hypercolor is open in
another tab. Only one tab can send.` with action `Use this tab`. Current:
`Hypercolor is open in another tab — take over?` (`:33`) with `Take over` (`:35`) — a question
in a status region with a button that answers it is ambiguous for screen readers.

**PWA update** (`src/components/pwa-register.tsx`). When a new service worker is waiting, show
a non-blocking bar: `A new version is ready.` with `Reload`. Never auto-reload: a silent
reload during composition loses the draft.

**AC.**
1. The tab-lock banner uses a statement plus an imperative action, not a question.
2. A waiting service worker never activates without an explicit `Reload`.
3. Both bars render above the primary navigation and below any session banner.

---

## E. Feature-exposure resolution

### E.1 Features currently Settings-only, hidden, or harness-only

| Feature | Current exposure | Ruling | Path after this contract |
| --- | --- | --- | --- |
| Enable messaging | mobile Settings row + inline CTAs (`src/screens/main/SettingsScreen.tsx:193-199`) | expose | 1 tap from Chats (pinned CTA) and from Thread; Settings row retained as a secondary path |
| Message requests | mobile: buttons in two different screens; web: nav link | expose, single canonical path | 1 tap from Chats (pinned row), plus a badge visible from every destination (§A.3) |
| Follows import | mobile: pull-to-refresh only, no consent; web: inline panel | expose + gate | 2 taps: `Contacts` → `Use my follows` → consent (§D.8) |
| Contact detail | mobile: none | expose | 1 tap from a Contacts row (§D.9) |
| Public topics | mobile: `Join`/`+` in Channels header; web: separate `/discover` nav link | expose as a mode | 1 tap: `Channels` → `Public` (§A.4) |
| Tip endpoints (own) | mobile Settings (`src/components/TipEndpointsSettings.tsx`) | keep Settings-only | Configuring your own receive destinations is setup, not an in-conversation action. It stays a Settings section; the conversation-side action (`Send my tip list`, `src/components/ThreadTipBar.tsx:67`) moves into the composer action menu (§D.11), which is 1 tap from the composer. |
| Payment request (mobile) | Thread, via `PaymentComposeSheet` | expose | 1 tap: composer `+` → `Request payment` (§D.11) |
| Tip (mobile) | Thread chips above composer | expose | 1 tap: composer `+` → `Send a tip` (§D.11), then Payment Review (§D.12) |
| Payments (web) | harness-only (`/e2e/payments-harness`, `src/services/payments/paymentsHarness.ts`) | **hidden by design** | See decision 5 below. |
| Peer payment methods (web) | read-only block on contact detail (`src/components/contact-detail.tsx:124-126`) | **removed** | Its own subtitle says the app cannot send payments; it is a pay affordance that does not pay, and it costs a network read per contact open. |
| Attachment send | mobile OS alert; web composer | expose | composer action menu (§D.11) |
| Backup / restore | Settings section on both | keep Settings-only | Backup is account maintenance, not a task. It gains the gate in §D.13 and a prompt from the Sign-out sheet (§D.15), which is where a user actually needs it. |
| BLE mesh | mobile Settings toggle, quarantined (`src/screens/main/SettingsScreen.tsx:78`) | **hidden by design** | Quarantined transport. It stays a labelled Experimental toggle in Settings with no promotion anywhere else. |
| Telemetry toggle | mobile Settings (`:179`) | keep Settings-only | Standard privacy control location. |
| Live proof panel | mobile Settings, `__DEV__` (`:329-372`) | **hidden by design** | Developer tooling. Must be compiled out of production, not merely hidden. |
| Debug signup panel | mobile Auth, `__DEV__` (`src/screens/auth/DebugSignupPanel.tsx`) | **hidden by design** | Same. Its `Pubky Ring.` string (`:90`) needs no change since it never ships. |
| E2E harness routes | web `/e2e/*`, excluded from nav (`src/components/site-nav.tsx:35`) | **hidden by design** | Test surface. Excluded from the sitemap and from any prefetch. |
| `hypercolor://join-public` deep link | mobile, handled in `src/navigation/RootNavigator.tsx:75-91` | keep | Invite links must keep working; it now lands in Channels → Public. |

### E.2 Decision 5 in full — web payments

**Ruling: web does not implement payment compose or wallet handoff in this sweep.**

What web ships instead:

1. **A read-only `PaymentNotice` for inbound Paykit payment kinds.**
   `getLinkMessagesForConversation` on web does not filter payment kinds, so a payment request
   sent from mobile currently renders in a web thread as an ordinary `DmMessageBubble` with a
   raw or empty body. That is a live cross-platform defect and it is fixed here, not deferred:
   the bubble renders `Payment request` with the amount and reference, and one line —
   `Payments are not available on web. Open Hypercolor on mobile to act on this.` No accept,
   reject, cancel, or pay control renders.
2. **No payment entry in the web composer action menu.**
3. **Removal of the web contact-detail payment-methods block** (§D.9).

Justification. Mobile parity is not a QR and a copy button; it is the request lifecycle —
create, accept, reject, cancel, expiry, proof submission, invoice/amount-match validation, and
the displayed-invoice record — implemented in `src/services/payments/PaymentService.ts` and
`src/services/payments/walletHandoff.ts`. Shipping a URI-only web flow would be a second,
mobile-incompatible payment path: a web user could open a wallet for a request that mobile
still considers pending, with no cancel and no proof. The existing web harness
(`src/services/payments/paymentsHarness.ts`) covers Paykit *endpoint listing*, not payment
requests, so there is nothing to promote from it. Hiding is reversible in one wave; a divergent
money path is not.

### E.3 Dead-code candidates

Implementers re-verify zero callers workspace-wide before deleting anything marked remove.

| Candidate | Repo | Ruling |
| --- | --- | --- |
| `lucide-react` dependency (unused) | web | **Remove.** The icon set the design-system wave needs is decided in §F; an unused icon dependency in a static export is shipped weight. |
| Leftover default Next.js SVGs in `public/` | web | **Remove.** Not referenced by any component and not part of the PWA icon set. |
| `/discover` route components after the fold-in | web | **Keep.** `src/components/discover-page.tsx` and `src/components/tag-channel-view.tsx` become the Public mode of Channels; only the route wrapper becomes a redirect. |
| `Requests` nav entry | web | **Remove** from `LINKS` (`src/components/site-nav.tsx:16`); the `/requests` route and page stay. |
| `sessionStatusLabel` `unknown` branch | web | **Keep.** Still used by the loading skeleton path; only the banner stops rendering it. |
| Mobile Contacts `Requests` button and its handler | mobile | **Remove** (`src/screens/main/ContactsScreen.tsx:163-168`, `onRequests` prop at `:111`, `:121`, `:88`). |
| `WOT_AUTO_ACCEPT_TRUST_THRESHOLD` | mobile (`src/flags/config.ts:29`) | **Keep.** Its own comment records that it is retained so existing overrides are not dead; removing it would break stored config. It must not influence any UI copy. |
| `formatDeliveryState` `delivered` / `read` branches | mobile (`src/screens/main/ThreadScreen.tsx:464-467`) | **Remove the branches, keep the function.** The enum values stay in storage; the formatter maps them to `Sent`. |
| `deliveryLabel` `delivered` / `read` branches | web (`src/components/message-bubble.tsx:21-24`) | **Remove the branches, keep the function.** Same reason. |
| `ThreadTipBar` chips | mobile (`src/components/ThreadTipBar.tsx:60-69`) | **Keep the component, remove the chip row.** Its endpoint list becomes the `Send a tip` sheet content (§D.11). |
| `PaymentRequestBubble` inline destination picker | mobile (`:118-178`) | **Remove.** Superseded by the Payment Review sheet (§D.12); the bubble keeps only the card and the action that opens Review. |
| `ComposerAttachButton` `Alert.alert` source chooser | mobile (`:43-75`) | **Remove.** Superseded by the composer action menu (§D.11); the upload logic in `send` is kept. |
| `paymentsHarness.ts` | web | **Keep.** It backs `/e2e/payments-harness`, which is a live test surface. |

---

## F. Components the design-system wave must build

Every primitive below has at least one consuming screen in this contract.

| Primitive | Consumers |
| --- | --- |
| `Button` (brand / outline / text / destructive; ≥44pt target; disabled and busy states) | every screen in §D |
| `ListRow` (avatar slot, title, subtitle, meta, trailing slot, chevron) | Chats (§D.4), Requests (§D.6), Contacts (§D.7), Channels (§D.10), Settings (§D.16), Profile (§D.14) |
| `PageHeader` (Back slot, title, trailing action slot) | Thread (§D.5), Requests (§D.6), Contact detail (§D.9), Channel view (§D.11), Settings (§D.16), Enable (§D.3), web detail panes (§D.18) |
| `EmptyState` (title, body, primary action, optional secondary) | Chats (§D.4), Contacts (§D.8), Requests (§D.6), Channels both modes (§D.10), Thread (§D.5) |
| `StatusBanner` (`role="status"`, label, single action, non-dismissible) | app shell both platforms (§D.19), tab lock (§D.20), PWA update (§D.20), public-graph warning (§B.6) |
| `AuthQrPanel` (QR, copyable URL, TTL countdown, expired swap) | Welcome (§D.1), Awaiting Ring (§D.2), Enable authorizing phase (§D.3) |
| `Sheet` (backdrop dismiss, `onRequestClose` / Escape, focus trap, safe-area padding) | composer action menu (§D.11), Payment Review (§D.12), follows consent (§D.8), sign-out (§D.15), Channels create/join (§D.10), contact danger confirmations (§D.9) |
| `ComposerActionMenu` (built on `Sheet`) | Thread (§D.5), Channel view (§D.11) |
| `PaymentReview` (built on `Sheet`) | mobile Thread payment request and tip (§D.12) |
| `RecoveryCodeGate` (chunked monospace code, copy, confirm checkbox, leave interception) | Settings backup (§D.13) |
| `Badge` (numeric, capped display, zero renders nothing) | Chats tab / nav link and pinned requests row (§A.3), Channels unread |
| `Avatar` (identicon fallback derived from pubky, initial fallback for named groups) | Chats (§D.4), Contacts (§D.7), Contact detail (§D.9), Requests (§D.6), Channels (§D.10), Thread header (§D.5), Profile (§D.14) |
| `AttachmentBubble` (uploading, ready, failed + retry, unavailable-without-key) | Thread (§D.5), Channel view (§D.11) |
| `MessageStatus` (the only place the four status words are produced) | Thread (§D.5), Channel view private groups (§D.11), `AttachmentBubble` |

`PaymentNotice` — the read-only inbound payment bubble specified in §E.2 — is web-only and is
built as a variant of `AttachmentBubble`'s non-actionable layout rather than as its own
primitive, so it is not listed separately.

---

## G. Open questions

Three, each with a recommended default. Work proceeds on the default unless overruled.

**1. Do the two public substrates converge, and in which direction?**
Mobile implements Hypercolor public channels at `/pub/hypercolor.app/v1/public-channels`
(`src/types/group.ts:132`); accepted web ADR 0002 drops exactly that schema
(`docs/adr/0002-public-chat-as-graph.md:72`) in favour of tags on the public graph. §A.4 ships
both under one `Public` mode with one honest substrate line each, because converging is a
product and protocol decision, not a UX one. ADR 0002's own open question 1
(`:321`) asks whether mobile ever wrote those objects — it did, and it still does.
*Recommended default:* ship the divergence as specified, and schedule a follow-up wave that
either adds tag-channel reading to mobile (mobile's `NexusClient` currently serves only the
follower/following graph, `src/flags/config.ts:7-12`) or writes a read-only importer for
existing `public-channels/` objects. Do not silently strand data that mobile users have
already posted.

**2. Should Chats show a peer's display name from the public graph, or only what the user
typed?**
Contacts already hydrate `displayName` from pubky.app profiles during follows import
(`PROFILE_HYDRATE_CONCURRENCY`, `src/flags/config.ts:31-32`), and both Chats and Requests fall
back to `shortPubky`. Showing a self-asserted public display name for someone the user has not
added is an impersonation surface: anyone can set their pubky.app name to match a person the
user trusts.
*Recommended default:* show the display name only for contacts the user added or accepted;
show `shortPubky` everywhere else, including in Message requests, with the display name as
secondary text prefixed `claims to be`. Requests already resolves a name when a contact record
exists (`src/components/requests-page.tsx:90-92`), so this is a rule change, not new data.

**3. Does the Requests invite block share a bare pubky, or a Hypercolor deep link?**
§D.6 specifies `Copy my pubky` and `Share` as the honest workaround for the missing open inbox.
A `hypercolor://` deep link would be friendlier but only works for someone who already has the
app, and a web fallback URL would publish a Hypercolor-usage signal at a fixed address.
*Recommended default:* share the bare pubky only. It works in every client, reveals nothing
beyond the identity the user is already handing over, and does not create a new hosted
endpoint that has to be maintained and privacy-reviewed.
