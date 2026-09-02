# Hypercolor mobile screen inventory

Repo: `/Users/johncarvalho/work/hypercolor` @ `f28d8c3` (`main`).
Scope: every navigator, stack, tab, screen, sheet, modal, and `Alert` reachable from `src/` plus the `App.tsx` bootstrap surface. Build noise (`.ai/`, `modules/*/android/build/`) ignored.

**Global chrome facts (apply unless a row says otherwise):**

- Every React Navigation container uses `headerShown: false` (`src/navigation/RootNavigator.tsx` `Stack.Navigator screenOptions`, `src/navigation/AuthStack.tsx`, `src/navigation/MainTabs.tsx`). iOS has **no system navigation-bar back**. Custom `←` / `← Back` / `Cancel` text is the only in-app header control.
- No `BackHandler`, `gestureEnabled`, or `hardwareBack` override exists in `src/` (searched). Android hardware Back therefore uses React Navigation + `react-native-screens` defaults: pop the focused native-stack screen; on a tab, typically return toward the first tab then leave the activity.
- iOS interactive pop (edge swipe) remains the native-stack default on pushed root-stack screens (`Thread`, `ChannelScreen`, `ContactSearch`, `MessageRequests`, `Settings`, `EnableMessaging`, `AwaitingRingAuth`). Tab roots have nothing to pop.
- Authenticated vs not is a **navigator swap**, not a screen: `useAuthStore().isAuthenticated` in `src/navigation/RootNavigator.tsx`. True → `Main` + overlay stack screens. False → `Auth` only. `hydratePersistedAuth` (`src/stores/hydrateAuthSession.ts`) restores Welcome identity (AppKey + pubky), not a Paykit messaging session.

## Navigators

| Navigator | File | Type | Parent | Screens registered |
|---|---|---|---|---|
| `NavigationContainer` | `src/navigation/RootNavigator.tsx` | container, `ref={navigationRef}` (`src/navigation/navigationRef.ts`) | `App.tsx` → `<RootNavigator />` | linking prefixes `hypercolor://` |
| Root stack `Stack` | `src/navigation/RootNavigator.tsx` | `createNativeStackNavigator<RootStackParamList>` | container | `Auth` **or** (`Main`, `Thread`, `ChannelScreen`, `ContactSearch`, `MessageRequests`, `Settings`, `EnableMessaging`) |
| Auth stack | `src/navigation/AuthStack.tsx` | `createNativeStackNavigator<AuthStackParamList>` | Root `Auth` | `Welcome`, `AwaitingRingAuth` |
| Main tabs | `src/navigation/MainTabs.tsx` | `createBottomTabNavigator<MainTabParamList>` | Root `Main` | `Chats`, `Channels`, `Contacts`, `Profile` |

Param lists: `src/types/index.ts` (`AuthStackParamList`, `MainTabParamList`, `RootStackParamList`).

Lazy screens: `ContactSearch`, `MessageRequests`, `Settings`, `EnableMessaging` (root); `Chats`, `Channels`, `Contacts`, `Profile` (tabs). `ThreadScreen` and `ChannelScreen` are eager imports. Suspense fallback is `LoadingFallback` in `RootNavigator.tsx`.

Dev-only overlay (not a route): `E2eSignupHud` (`src/navigation/E2eSignupHud.tsx`), mounted beside the stack when `__DEV__`.

## Bootstrap (not a named route)

| Surface | File | Params | Enter | Exit | Android Back | iOS header back |
|---|---|---|---|---|---|---|
| App keystore splash | `App.tsx` (`!ready` → `ActivityIndicator`) | none | Cold start until `KeyStore.initKeyStore` + `hydratePersistedAuth` **or** 4000 ms fail-open timer | `setReady(true)` only (timer or init). No button | No navigator yet; OS Back may background the activity | None |
| Navigation linking fallback | `RootNavigator.tsx` `LoadingFallback` | none | `NavigationContainer` `fallback` while linking resolves | Container ready | Same as splash | None |

## Auth stack

| Route | File | Params | Enter | Exit | Android Back | iOS header back |
|---|---|---|---|---|---|---|
| `Welcome` | `src/screens/auth/WelcomeScreen.tsx` | `undefined` | Auth stack initial; linking `hypercolor://welcome` (`RootNavigator.tsx` linking config) | `nav.navigate('AwaitingRingAuth', { ringAuthUrl })` after `PubkyRingAuthService.requestDelegation`; `__DEV__` Debug signup Continue → `setAuthenticated` (unmounts Auth) | First screen of Auth; Back backgrounds/exits | None (no custom back) |
| `AwaitingRingAuth` | `src/screens/auth/AwaitingRingAuthScreen.tsx` | `{ ringAuthUrl: string }` | Welcome `handleConnect` | **User:** Cancel → `nav.goBack()`. **Success:** not this screen — `hypercolor://ring-callback` handled in `RootNavigator.handleDeepLink` → `setAuthenticated` swaps the entire root tree to Main | Pops to Welcome | None; custom Cancel button (`awaitingRingAuthCancel`, **no** `accessibilityLabel`) |
| Debug signup panel (embedded, `__DEV__` only) | `src/screens/auth/DebugSignupPanel.tsx` on Welcome | none | Rendered under Connect on Welcome | Submit stays on Welcome until Continue → `KeyStore.setHomeserver` + `setAuthenticated` | N/A (not a route) | N/A |

## Main tabs

| Route | File | Params | Enter | Exit | Android Back | iOS header back |
|---|---|---|---|---|---|---|
| `Chats` | `src/screens/main/ChatsScreen.tsx` | `undefined` | Default tab (`tabBarButtonTestID` `tabChats`) | Tab switch; `MessageRequests`; `ContactSearch`; `Thread` via `threadRouteParams`; `EnableMessaging` via `EnableMessagingCta` | First tab: typically leaves the app after Back | None |
| `Channels` | `src/screens/main/ChannelsScreen.tsx` | `undefined` | Tab `tabChannels` | Tab switch; `ChannelScreen`; create/join modals | Tab Back behavior | None |
| `Contacts` | `src/screens/main/ContactsScreen.tsx` | `undefined` | Tab `tabContacts` | Tab switch; `ContactSearch`; `MessageRequests`; `Thread` (row press — **there is no contact-detail route**) | Tab Back behavior | None |
| `Profile` | `src/screens/main/ProfileScreen.tsx` | `undefined` | Tab `tabProfile` | Tab switch; `Settings`; sign-out Alert → `PubkyService.signOut` + `clearSession` (Auth returns) | Tab Back behavior | None |

Tab icons: `src/navigation/tabBarIcons.tsx` (`Ionicons` from `@expo/vector-icons`). Labels: Chats / Channels / Contacts / Profile (`MainTabs.tsx`).

## Root stack overlays (authenticated)

| Route | File | Params | Enter | Exit | Android Back | iOS header back |
|---|---|---|---|---|---|---|
| `Thread` | `src/screens/main/ThreadScreen.tsx` | `{ threadId: string; participantPubky: PubkyKey }` (`threadRouteParams` in `src/types/link.ts` sets `threadId` = `dm:{pubky}`) | Chats row; Contacts row; Message Requests Accept; ContactSearch Alert “Chat” (`nav.replace`); `__DEV__` `hypercolor://e2e/open-thread` | Custom `threadBack` → `nav.goBack()`; iOS edge swipe | Pops to the tab that pushed it | None; custom `←` (`threadBack`, 32 pt wide) |
| `ChannelScreen` | `src/screens/main/ChannelScreen.tsx` | `{ channelId: string }` | Channels row; create/join success; pending `hypercolor://join-public` after auth (`takePendingPublicJoin` in `ChannelsScreen.tsx`) | Custom `←` → `nav.goBack()`; Leave channel also `goBack()` | Pops | None; custom `←` (no `accessibilityLabel`, no `testID`) |
| `ContactSearch` | `src/screens/main/ContactSearchScreen.tsx` | `undefined` | Chats `+` (`chatsNew`); Contacts `+` (`contactsAdd`) | Cancel → `goBack()`; success Alert “Chat” → `nav.replace('Thread', …)` | Pops (Cancel / hardware) | None; custom Cancel |
| `MessageRequests` | `src/screens/main/MessageRequestsScreen.tsx` | `undefined` | Chats “Requests”; Contacts “Requests” | Custom `← Back`; Accept also `navigate('Thread', …)` | Pops | None; custom `← Back` |
| `Settings` | `src/screens/main/SettingsScreen.tsx` | `undefined` | Profile “Settings” | Custom `← Back`; “Enable encrypted messaging” pushes `EnableMessaging`; “Profile” row calls `nav.navigate('Profile' as never)` — **Profile is a tab, not a root-stack screen** (see defects) | Pops | None; custom `← Back` |
| `EnableMessaging` | `src/screens/main/EnableMessagingScreen.tsx` + `src/screens/main/enableMessagingController.ts` | `undefined` | Chats CTA (`chatsEnableMessaging`); Thread CTA (`threadEnableMessaging`); Settings row (`settingsEnableMessaging`) | Custom header `enableMessagingBack` → `controller.cancel()` + `nav.goBack()`. **Success phase has no Done/Continue in the body** (P0 trap, below) | Should pop via native-stack default | None; custom `← Back` only |

## Sheets, modals, in-screen panes (not routes)

| Surface | File | Host | Enter | Exit | Android Back | iOS header back |
|---|---|---|---|---|---|---|
| Payment compose | `src/components/PaymentComposeSheet.tsx` (`Modal`) | `ThreadScreen` composer | Thread header `₿` (`threadRequestPay`) | Cancel / `onRequestClose={onClose}` / successful submit closes via parent | `onRequestClose` → close | No nav header; Cancel |
| Channels “New channel” | `src/screens/main/ChannelsScreen.tsx` `<Modal visible={createOpen}>` | Channels | Header `+` | Cancel / Create (navigates to `ChannelScreen`) | **No `onRequestClose`** — hardware Back does not dismiss this modal | No nav header; Cancel |
| Channels “Join public channel” | same file, second `Modal` | Channels | Header “Join” | Cancel / Join | **No `onRequestClose`** | No nav header; Cancel |
| Channel members pane | `src/screens/main/ChannelScreen.tsx` `showMembers` | `ChannelScreen` | Header “Members” | Header “Chat” toggles back; Leave | Hardware Back pops the **screen**, not the pane | Custom `←` pops the screen |
| Thread tip bar (expand-in-place) | `src/components/ThreadTipBar.tsx` | Thread under header | “Tip” chip | Tap Tip again (local `open` flag). Not a Modal | N/A | N/A |
| Payment destination picker | `src/components/PaymentRequestBubble.tsx` | Thread payment bubble after “Pay in wallet” | `onPayInWallet` | Open wallet / parent re-render | N/A | N/A |
| Attach source Alert | `src/components/ComposerAttachButton.tsx` | Thread + private-channel composer | `+` attach | Photo / File / Cancel | Alert default | Alert default |
| `AuthQr` | `src/components/AuthQr.tsx` | AwaitingRingAuth + EnableMessaging authorizing | When a URL exists | Unmount with parent | N/A | N/A |
| Enable messaging CTA card | `src/components/EnableMessagingCta.tsx` | Chats, Thread | `!messagingEnabled` | Navigates to `EnableMessaging` | N/A | N/A |
| Tip endpoints form | `src/components/TipEndpointsSettings.tsx` + `TipEndpointsForm.tsx` | Settings | Always on Settings once loaded | Save stays on Settings | N/A | N/A |
| Live proof panel (`__DEV__`) | `SettingsScreen.tsx` `LiveProofSettingsPanel` | Settings | `__DEV__` | Stays on Settings | N/A | N/A |
| E2E signup HUD (`__DEV__`) | `src/navigation/E2eSignupHud.tsx` | Root overlay | `setE2eSignupHud` after deep-link signup | Success: Continue (`applyE2eSignupContinue`). Error: `pointerEvents="none"` — **no dismiss** | Overlay; error HUD ignores touches | None |
| Sign-out confirm | `ProfileScreen.tsx` `Alert.alert` | Profile | “Disconnect pubky-ring” | Cancel / Disconnect | Alert | Alert |

## Alerts (all `Alert.alert` in product UI)

| Title (as coded) | File | Trigger |
|---|---|---|
| `Error` | `WelcomeScreen.tsx` | `requestDelegation` throw; body is `(err as Error).message` |
| `Authorization Failed` | `RootNavigator.tsx` | `handleRingCallback` throw |
| `Join failed` | `RootNavigator.tsx` + `ChannelsScreen.tsx` | `GroupService.joinPublicChannel` |
| `Send failed` | `ThreadScreen.tsx`, `ChannelScreen.tsx` | DM / channel send |
| `Payment request` | `ThreadScreen.tsx` | `PaymentService.requestPayment` |
| `Accept failed` / `Decline failed` | `MessageRequestsScreen.tsx` | `LinkService.acceptMessageRequest` / `declineMessageRequest` |
| `Not Found` / `Cannot add` / `Error` / `Contact Added` | `ContactSearchScreen.tsx` | `ContactsService.addManualContact` |
| `Could not create group` / `Could not create channel` / `Could not join` | `ChannelsScreen.tsx` | `GroupService.createChannel` / `createPublicChannel` / `joinPublicChannel` |
| `Reaction failed` / `Delete failed` / `Add failed` / `Remove failed` / `Leave failed` / `Refresh failed` | `ChannelScreen.tsx` | group member/message actions |
| `Disconnect from pubky-ring` | `ProfileScreen.tsx` | sign-out confirm |
| `Attachment failed` / `Attach` / `Permission needed` | `ComposerAttachButton.tsx` | picker / send |
| `Payment` | `PaymentRequestBubble.tsx` | accept/reject/cancel/proof/handoff |
| `Tip` / `Tip list` | `ThreadTipBar.tsx` | `openPayUri` / `PaymentService.sendTipList` |
| `No wallet installed` | `src/services/payments/walletHandoff.ts` `openBuiltUri` | no `lightning:`/`bitcoin:` handler; Copy URI / Cancel |

## Deep links and return paths

| URL | Handler | Resulting UI |
|---|---|---|
| `hypercolor://welcome` | RN linking → Auth `Welcome` | Welcome |
| `hypercolor://awaiting-auth` | RN linking → Auth `AwaitingRingAuth` | Waiting screen (**params may lack `ringAuthUrl`**; QR block hidden if empty) |
| `hypercolor://ring-callback?…` | `RootNavigator.handleDeepLink` → `PubkyRingAuthService.handleRingCallback` (`src/services/PubkyRingAuthService.ts`) | On success `setAuthenticated` → Main tabs. On failure Alert `Authorization Failed`. **Does not navigate EnableMessaging.** Welcome `paykit-connect` is identity/UKD only (`LinkService.ts` header comment). |
| `pubkyring://paykit-connect?deviceId&callback=hypercolor://ring-callback&ephemeralPk&caps=` | Built by `buildPaykitConnectUrl`; opened from `requestDelegation` if `Linking.canOpenURL('pubkyring://')` | External Ring; Hypercolor shows `AwaitingRingAuth` |
| `pubkyauth://…` | `LinkService.enable` → `PaykitLinkNative.startAuthFlow`; `enableMessagingController` auto-opens only URLs with prefix `pubkyauth://` | Enable Messaging authorizing + QR. Return is **not** a Hypercolor deep link: native `awaitAuthApproval(flowId)` then `phase: 'success'`. Discarded / user-cancelled flows call `cancelAuthFlow(flowId)` instead of draining via `awaitEnabled()`. |
| `hypercolor://join-public?channel=…` | `RootNavigator.handleDeepLink` + `parsePublicChannelRef` (`src/types/group.ts`). If unauthenticated, `setPendingPublicJoin`; Channels focus calls `takePendingPublicJoin` | `ChannelScreen` or Alert |
| `hypercolor://e2e/*` (`__DEV__` only) | `src/navigation/e2eDeepLinks.ts` (`debug-signup`, `switch`, `add-contact`, `send-dm`, `sync-inbox`, `request-payment`, `open-thread`, `whoami`, `ping`, `liveproof`, `last-bodies`). Stripped from RN linking via `linkingUrlForReactNavigation` | Test HUD / navigation; not shipping UX |
| `lightning:` / `bitcoin:` | `walletHandoff.ts` `openBuiltUri` | External wallet or “No wallet installed” Alert |

## Enable Messaging success (P0 confirmation trap)

**Component:** `EnableMessagingScreen` default export in `src/screens/main/EnableMessagingScreen.tsx`.
**State owner:** `createEnableMessagingController` in `src/screens/main/enableMessagingController.ts`. After `deps.enable()` → `flow.awaitEnabled()` resolves, it `emit({ phase: 'success', pubky, receiverPath })` (`beginAuth`, success emit).

**What the user sees after Ring returns:**

1. Status card value `Encrypted messaging enabled` (`statusLabel` `case 'success'`).
2. Optional truncated pubky (`numberOfLines={1}` `ellipsizeMode="middle"`) and `Receiver path {state.receiverPath}`.
3. Green body copy: “Ring approved the grant and this device published a receiver marker. You can leave this screen.”
4. **No Done, Continue, Close, or Go to Chats control.** `canRetry` is `error | session-offline | enabled` only — the primary button slot is empty on `success`.

**Why it feels like there is no exit:**

- Root stack options for this route: `headerShown: false` (`RootNavigator.tsx`). iOS has no system back affordance.
- The only coded leave control is the custom header `TouchableOpacity` `testID="enableMessagingBack"` (`← Back`, `styles.back` width 60) calling `handleCancel` → `controller.cancel()` + `nav.goBack()`.
- After Ring, attention is on the status card and green paragraph; nothing in that content column is tappable to dismiss. Copy says the user “can leave” without naming Back.
- Maestro `.maestro/subflows/enable-messaging.yaml` only asserts the **`enabled`** phase (“Already enabled”) and then taps `enableMessagingBack`. The Ring **`success`** phase is not covered.

Android hardware Back should still pop (no `BackHandler` lock). That does not give iOS a content-area exit.

Related phases on the same screen: `checking` (spinner), `authorizing` (QR + Open Ring + Copy; Back cancels the native flow via `cancelAuthFlow`), `enabled` (Authorize again + Back), `session-offline` / `error` (Try again + Back), `native-missing` (no retry, Back only).

## Missing product surfaces (confirmed absent)

| Expected surface | Reality |
|---|---|
| Contact detail | **No route.** Contacts row → `Thread`. No edit/delete/homeserver/trust breakdown UI (`TrustEngine.explain` runs for score persistence only, `ContactsScreen.tsx`). |
| Group detail as its own stack screen | Members are an in-screen pane on `ChannelScreen`, not `RootStackParamList`. |
| Attachment gallery / viewer route | `AttachmentBubble` in thread/channel only (`src/components/AttachmentBubble.tsx`). |
| Username search | `ContactSearchScreen` is paste z32 only. `NexusClient.user` exists (`src/services/NexusClient.ts`) and has **zero callers**. |
| Discover / public tags | No screen, tab, or component. Public channels: invite link copy in the create modal (`ChannelsScreen.tsx`) and `src/types/group.ts` (“Nexus does not index chat URIs”). |
| Notifications inbox / OS permission | None. `docs/NOTIFICATIONS.md`: foreground `syncInbox` only. |
| Mesh peer list | `contactStore.meshPeers` is never written. `MeshService` is never imported. Settings has a quarantined BLE switch only. |

## Trapped-screen audit

| Surface | File | Trap type | Why |
|---|---|---|---|
| Enable Messaging `phase === 'success'` | `EnableMessagingScreen.tsx` | **No content-area exit** (P0) | Success copy + empty primary slot; iOS no system back; only a small header Back |
| Channels create `Modal` | `ChannelsScreen.tsx` | Android Back does not dismiss | `transparent` Modal without `onRequestClose` |
| Channels join `Modal` | `ChannelsScreen.tsx` | Android Back does not dismiss | same |
| App keystore splash | `App.tsx` | Exit is timer/async only | Ready after init **or** 4000 ms; no cancel |
| `LoadingFallback` | `RootNavigator.tsx` | Async only | Until `NavigationContainer` is ready |
| Enable Messaging `authorizing` | `EnableMessagingScreen.tsx` + `enableMessagingController.ts` | Completion is async-only; **leave is not** | `awaitEnabled()` until Ring; user can still Back/cancel |
| Awaiting Ring | `AwaitingRingAuthScreen.tsx` | Completion is async-only; **leave is not** | ring-callback or Cancel |
| E2E error HUD (`__DEV__`) | `E2eSignupHud.tsx` | No dismiss | `pointerEvents="none"`; no button |
| Contact Added Alert | `ContactSearchScreen.tsx` | Single action | Only `Chat` (replace Thread). No “Stay on Find Contact”. Dismiss still possible via the Chat button |

Not trapped: Welcome, tabs, Thread, Channel chat, Settings, Message Requests, PaymentComposeSheet (`onRequestClose`), Debug signup result (Continue).

## Sign-out

`ProfileScreen.tsx` `handleSignOut` → Alert → `PubkyService.signOut` (`src/services/PubkyService.ts`: best-effort `rnSignOut`, `LinkService.clearSession`, `KeyStore.clear`) → `useAuthStore.clearSession`. Root navigator remounts Auth. No dedicated sign-out screen.
