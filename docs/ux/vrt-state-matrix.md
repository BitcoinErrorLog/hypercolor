# Hypercolor VRT state matrix

Visual states that later screenshot waves must capture, with **deterministic fixtures** (no live homeserver, no real Ring, no live identities). Screen list matches `docs/ux/screen-inventory.md`.

Nondeterministic regions to **mask** on every capture that includes them: relative timestamps (`now` / `3m` / `toLocaleTimeString` / `toLocaleDateString` / ISO expiry), `AuthQr` PNG (hash of URL), avatar letters derived from pubky, unread badges that change, `Date.now()` in tip expiry, E2E HUD secrets.

Fixture identities: use fixed z32 strings of length 52 that pass `isValidPubky` (no `0`, `2`, `l`, `v`). Example shape only for harness authors: store in test JSON, never mint from Ring. Conversation ids: `dm:{peer}` via `buildDmConversationId`.

## Existing test / VRT tooling (installed)

| Tool | Evidence | What it does today |
|---|---|---|
| Jest 29.7 + `jest-expo` ~54 | `package.json` `devDependencies`; `jest.config.js` `preset: 'jest-expo'`, `testMatch: **/__tests__/**/*.test.@(ts|tsx)` | Unit/component renderer tests. **No** `toMatchImageSnapshot`, **no** screenshot reporter |
| `react-test-renderer` | `EnableMessagingScreen.test.tsx`, `WelcomeScreen.test.tsx`, `AuthQr.test.tsx`, `PaymentComposeSheet.test.tsx` | Tree assertions, not pixels |
| Maestro | `package.json` `"test:e2e": "maestro test .maestro/p7-product.yaml"`; `.maestro/config.yaml`; `.maestro/p7-product.yaml`; 16 subflows under `.maestro/subflows/` | **Live** two-party product flow (debug signup, enable messaging, DM, payment). Needs staging tokens in env. Not a state catalog |
| CI | `.github/workflows/ci.yml` | `npm ci` + `typecheck` + `lint` + `npm test` on ubuntu. **No** Maestro, **no** screenshots, **no** iOS/Android emulator |
| Detox | not in `package.json` | Absent |
| Storybook / `@storybook/react-native` | `rg` on `package.json` / lockfile empty | Absent |
| Root `__tests__/` | empty directory | Unused |
| `__DEV__` deep links | `src/navigation/e2eDeepLinks.ts` | `e2e/debug-signup`, `switch`, `add-contact`, `send-dm`, `sync-inbox`, `request-payment`, `open-thread`, `whoami`, `ping`, `liveproof`, `last-bodies` — **networked** helpers, not offline VRT |
| Exported `*Content` presenters | `ThreadScreenContent`, `ChannelsScreenContent`, `ChannelScreenContent`, `ContactsScreenContent`, `MessageRequestsContent`, `ThreadTipBarContent` | Already take props — the right injection point for fixture-driven shots |

## Recommendation (do not implement here)

Keep Jest-expo for logic; **do not add Detox** (nothing in the tree uses it). Maestro is the only installed multi-platform UI runner (`test:e2e` already targets iOS `org.name.hypercolor` and Android `com.hypercolor`). A deterministic catalog should **not** reuse `.maestro/p7-product.yaml` (it spends signup tokens and real Encrypted Links).

Wire VRT as: (1) a `__DEV__` or test-only navigator that mounts each `*Content` / screen with frozen props (the Content split already exists for Thread, Channels, Channel, Contacts, Message Requests, Tip bar); (2) Maestro **screenshot** flows that open those states via a new `hypercolor://e2e/vrt?scene=` hook patterned on `e2eDeepLinks.ts` (Android `singleTask` already documents VIEW issues — the existing clipboard/file channel in `e2eClipboardChannel.ts` is the Android bypass); (3) mask timestamps/QR/pubky via Maestro `eraseText`/`optional` crop or a `testID` overlay. Jest `react-test-renderer` remains the PR gate; pixel diffs belong on a nightly emulator job, not `ci.yml`’s ubuntu `npm test`.

## State matrix

Fixture columns: data the harness must inject. “Offline” = `LinkService` session-offline or a banner; many screens **have no offline UI** today — still capture the actual blank/error you get.

### Bootstrap

| ID | States | Fixtures | Mask |
|---|---|---|---|
| App splash | loading spinner on `#0a0a0a` | Force `ready=false` | none |
| Linking fallback | same spinner | `NavigationContainer` fallback | none |

### Auth

| ID | States | Fixtures | Mask |
|---|---|---|---|
| Welcome | idle; Connect loading (`ActivityIndicator`); Error Alert | `requestDelegation` mock delay / reject | none |
| Welcome `__DEV__` | Debug panel empty; busy; error; result with Continue | `completeDebugSignup` mock | secret + pubky |
| AwaitingRingAuth | with URL (QR + buttons + Cancel); **without** URL (spinner + title only — `ringAuthUrl` missing) | Fixed `pubkyring://paykit-connect?…` string | QR image, full URL text |
| AwaitingRingAuth copied | `Copied` on secondary button | after copy | QR |
| Ring fail Alert | `Authorization Failed` | throw from `handleRingCallback` | URL in message |

### Tabs

| ID | States | Fixtures | Mask |
|---|---|---|---|
| Chats | messaging off + CTA + empty; messaging on + empty; populated 1 row; populated + unread 99+; pending requests badge | `LinkConversationSummary[]`; `countPendingMessageRequests` | time column, avatar letter, pubky |
| Chats | (no dedicated error/offline — still shoot after failed `syncInbox`, list stale) | local rows only | time |
| Channels | empty; populated private + public rows; create modal private (contacts listed / cap); create modal public (plaintext hint); join modal empty/invalid/busy `…` | `GroupChannel[]`; `Contact[]`; `busy` | `lastMessageAt` |
| Contacts | empty (the lying “Pull to import” view); populated mutual/following/follower/added badges; syncing bar; `nexusNote` | `Contact[]`; `pendingCount`; `syncing`; `nexusNote` | pubky lines |
| Profile | unnamed + no pubky; with pubky; Settings visible; sign-out Alert; `__DEV__` debug switch + panel | `authStore` profile/pubky | full pubky, secrets |

### Stack overlays

| ID | States | Fixtures | Mask |
|---|---|---|---|
| Thread | loading spinner; empty history; populated mine/theirs; send disabled; sending spinner; failed delivery; **delivered/read labels** (document current overstatement); messaging CTA; payment bubble pending/accepted/expired/claimed/verified; attachment uploading/failed/image/backup-unavailable; compose sheet open; tip bar collapsed/expanded empty/with expiry | `LinkMessage[]` with each `deliveryState`; `PaymentRequestRecord`; `AttachmentRecord`; `TipEndpointRecord[]`; `composePayment` | times, pubky title, QR none, avatars n/a |
| PaymentComposeSheet | visible idle; amount error; reference error; busy | `visible` `busy` `error` via `paymentComposeError` | none |
| Channel chat | loading; empty; text mine/theirs; deleted; reply preview; reactions; membership system line; composer hidden (`!selfActive`); public vs private (no attach / no react) | `GroupChannel` `isPublic`; `GroupMessage[]`; `selfActive` | times, sender pubky |
| Channel members | list active/removed; admin add row; leave; left copy; public refresh | `GroupMember[]` `isAdmin` | member pubky |
| ContactSearch | empty input; invalid z32; valid enabled Add; loading; Not Found Alert; Contact Added Alert; QR fallback card | `parsePubky` fixtures | none |
| MessageRequests | empty; one row with name; busy spinner on Accept | `RequestRow[]` `busyPeer` | pubky |
| Settings | default (mesh off, telemetry off, no recovery); mesh on; telemetry on; backup busy; recovery code shown; restore note success; restore note error; Enable Messaging row; `__DEV__` live proof idle/running/ok/fail steps | `FeatureFlags`; `homeserver`; `recoveryCode`; `restoreNote`; `LiveProofReport` | recovery code, homeserver z32, tokens |
| EnableMessaging | `checking`; `native-missing`; `enabled`; `session-offline`; `authorizing` + QR; `authorizing` https URL (no auto-open); `success` (**P0 trap**); `error` + Try again | controller state object | QR, pubky, auth URL, capability text |

### Overlays / alerts (shoot on host screen)

| ID | States | Fixtures | Mask |
|---|---|---|---|
| Attach Alert | Photo / File / Cancel | trigger attach | none |
| Permission Alert | photo library denied | mock permission | none |
| No wallet Alert | Copy URI / Cancel | `canOpenURL` false | payment URI |
| E2E HUD success/error (`__DEV__`) | Continue; error `pointerEvents none` | `setE2eSignupHud` | secret, pubky |
| Sign-out Alert | Cancel / Disconnect | Profile | none |

### States that do not exist yet (still list as “capture current absence”)

Shoot Thread **without** a “not enrolled” / “handshaking” / “session offline” banner — that absence is the regression baseline. Shoot Contacts empty **without** pull spinner. Shoot Profile **Unnamed**. Shoot Discover: **do not** invent a screen; the catalog should omit it until one exists.

## Platform notes for a future runner

- iOS: Maestro already waits on `welcomeScreen` / `chatsScreen` testIDs.
- Android: `MainActivity` `launchMode="singleTask"`; P7 comments that Maestro `openLink` VIEW is not delivered — VRT deep links must use the clipboard channel (`e2eClipboardChannel.ts`) or in-app Debug controls.
- Channel/Channels lack testIDs — screenshot those via visible text (`Channels`, `No channels yet.`) or add testIDs in a later wave (this inventory does not change source).
- Tab bar: capture Chats/Channels/Contacts/Profile focused vs unfocused Ionicons (tint `#7c3aed` / `#6b7280`).
