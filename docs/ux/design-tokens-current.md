Status: **SUPERSEDED** by `docs/ux/design-tokens-contract.md` and `src/theme/tokens.ts` (owner-approved 2026-09-02).

# Hypercolor mobile design tokens (as implemented)

There is **no theme module, no `colors.ts`, no spacing scale, and no typography tokens** in `src/`. Every value is a `StyleSheet.create` literal (plus `App.tsx`). Counts from a Python scan of `src/**/*.ts(x)` excluding `__tests__`, plus `App.tsx` for hex. Commands:

```bash
# hex/rgba/fontSize/borderRadius/padding|margin|gap
python3  # walk src, regex #[0-9A-Fa-f]{3,8}, rgba?(...), fontSize, borderRadius, spacing props
```

## Theme / token modules

| Expected | Reality |
|---|---|
| Design-token file | **None** |
| React Native `Appearance` / dark-light switch | **None** — hardcoded dark (`#0a0a0a`) |
| Paper / NativeWind / Tamagui | **Not in `package.json`** |
| Dynamic Type | **No** `allowFontScaling` / `maxFontSizeMultiplier` (grep empty). All `fontSize` are absolute numbers, so RN default font scaling applies to `Text` unless disabled — it is **not** disabled, but sizes are not mapped to `Text` variants / `PixelRatio` / iOS text styles |
| Reanimated `reduceMotion` / `AccessibilityInfo` | **None** (grep `reduceMotion`, `Reanimated`, `AccessibilityInfo`, `useReducedMotion` empty in `src/` and `App.tsx`). `Modal` `animationType` `slide`/`fade` always runs |

## Raw hex (29 unique, 309 occurrences in `src/` + 2 in `App.tsx`)

| Token (literal) | Count (`src` walk) | Files |
|---|---|---|
| `#7c3aed` (accent / brand / spinner / tab active) | 51 in src, also `App.tsx` | `App.tsx`; `EnableMessagingCta.tsx`; `PaymentComposeSheet.tsx`; `TipEndpointsForm.tsx`; `E2eSignupHud.tsx`; `MainTabs.tsx`; `RootNavigator.tsx`; `AwaitingRingAuthScreen.tsx`; `DebugSignupPanel.tsx`; `WelcomeScreen.tsx`; `ChannelScreen.tsx`; `ChannelsScreen.tsx`; `ChatsScreen.tsx`; `ContactSearchScreen.tsx`; `ContactsScreen.tsx`; `EnableMessagingScreen.tsx`; `MessageRequestsScreen.tsx`; `ProfileScreen.tsx`; `SettingsScreen.tsx`; `ThreadScreen.tsx` |
| `#f9fafb` (primary text) | 40 | AttachmentBubble, EnableMessagingCta, PaymentComposeSheet, PaymentRequestBubble, ThreadTipBar, TipEndpointsForm, AwaitingRingAuth, DebugSignupPanel, Channel, Channels, Chats, ContactSearch, Contacts, EnableMessaging, MessageRequests, Profile, Settings, Thread |
| `#fff` / `#ffffff` | 31 + 1 QR frame | Most buttons/on-accent text; AuthQr quiet zone `#ffffff` |
| `#6b7280` (secondary text, inactive tab) | 30 | MainTabs inactive tint; body hints |
| `#4b5563` (placeholders, timestamps) | 28 | Inputs `placeholderTextColor` and muted text |
| `#1a1a1a` (hairline / input fill / tab border) | 27 | Headers `borderBottomColor`, composers |
| `#0a0a0a` (canvas) | 16 + `App.tsx` | Every screen `container` + splash |
| `#c4b5fd` (lavender accent text) | 15 | Attach icon, chevrons, recovery code |
| `#9ca3af` | 14 | Labels, cancel text |
| `#374151` | 10 | Borders |
| `#fca5a5` (error) | 9 | Errors, failed send |
| `#1f2937` | 5 | Avatars, QR fallback border |
| `#86efac` (success) | 4 | Enable success, live-proof ok, debug status |
| `#1f1f1f` | 4 | Theirs bubbles, attach button |
| `#111` / `#111111` | 4 + 3 | Modals, cards (same black, two spellings) |
| `#a78bfa` | 3 | CTA hint, tip “Pay in wallet” |
| `#f59e0b` (warning) | 3 | Validation, nexus note |
| `#ef4444` | 2 | Profile disconnect |
| singles | 1 each | `#e9d5ff` `#141414` ThreadTipBar; `#fbbf24` payment warning; `#1f1b2e` EnableMessagingCta; `#4c1d95` Channels toggleOn; `#e5e7eb` `#f87171` ChannelScreen; `#d1d5db` MessageRequests decline |

Android splash XML: `android/app/src/main/res/values/colors.xml` `splashscreen_background` **`#FFFFFF`** (light), opposite the in-app dark canvas.

## Raw rgba (13 unique, 21 hits)

All in payment/thread/channel overlays:

- `rgba(0,0,0,0.6)` — modal backdrops (`PaymentComposeSheet.tsx`, `ChannelsScreen.tsx`)
- `rgba(0,0,0,0.25)` — payment dest / proof input
- `rgba(255,255,255,0.7|0.8|0.6|0.55|0.5|0.4|0.18|0.12)` — on-bubble text/buttons
- `rgba(250,204,21,0.2)` pending chip; `rgba(74,222,128,0.2)` ok chip; `rgba(248,113,113,0.2)` bad chip (`PaymentRequestCard.tsx`)

## Font sizes (hardcoded `fontSize: N`)

| px | Count | Role |
|---|---|---|
| 40 | 1 | Welcome logo (`WelcomeScreen.tsx`) |
| 32 | 1 | Profile avatar letter |
| 28 | 3 | Header `+` (Chats, Channels, Contacts) |
| 24 | 4 | Tab titles |
| 22 | 5 | Headings / back chevron |
| 20 | 5 | Avatar letters, Settings chevron |
| 18 | 4 | Payment amount, send arrow |
| 17 | 6 | Stack titles |
| 16 | 27 | Buttons, body |
| 15 | 21 | Bubbles, hints |
| 14 | 16 | Secondary |
| 13 | 24 | Mono keys, settings hints |
| 12 | 38 | Caps labels, chips, timestamps |
| 11 | 12 | Badges, errors |
| 10 | 4 | Thread/channel meta |

No `fontFamily` except `monospace` on keys/URLs/recovery codes (`ProfileScreen`, `ContactsScreen`, `EnableMessagingScreen`, `DebugSignupPanel`, `SettingsScreen`, `TipEndpointsForm`, `ThreadTipBar`, `PaymentRequestBubble`, `PaymentRequestCard`).

## Radii

| `borderRadius` | Count | Use |
|---|---|---|
| 10 | 19 | Inputs, small buttons |
| 12 | 18 | Primary buttons, cards, QR frame |
| 20 | 5 | Composer pill / send |
| 16 | 3 | Bubbles, modal top |
| 24 | 3 | List avatars |
| 999 | 2 | Tip chips, payment status chips |
| 8 | 2 | Payment dest rows |
| 40 | 1 | Profile avatar |
| 6 | 1 | Contact badges |

Also `borderBottomRightRadius: 4` / `borderBottomLeftRadius: 4` on bubbles (`ThreadScreen.tsx`, `ChannelScreen.tsx`). `AUTH_QR_SIZE_PT = 220` (`AuthQr.tsx`).

## Spacing (padding / margin / gap literals)

Most common: **8 (51), 16 (37), 20 (30), 12 (27), 14 (23), 10 (21), 4 (20), 6 (17), 32 (11)**. Header pattern is `paddingHorizontal: 20` + `paddingVertical: 14|16`. Composer `padding: 12`. No 4-pt grid helper — values are copy-pasted per file.

## Icon set (in-app)

| Set | File | Glyphs |
|---|---|---|
| `@expo/vector-icons/Ionicons` | `src/navigation/tabBarIcons.tsx` `MAIN_TAB_ICONS` | Chats `chatbubble` / `chatbubble-outline`; Channels `radio` / `radio-outline`; Contacts `people` / `people-outline`; Profile `person-circle` / `person-circle-outline` |
| Font load | `loadMainTabIconFont` → `Ionicons.loadFont()` from `App.tsx` | Failure: `console.warn`, UI still mounts |
| Everything else | Unicode in `Text` | `+` new; `←` / `← Back`; `₿` pay; `↑` send; `›` chevron; reaction emoji; `✓` paid / member selected |

No custom SVG icon pack in `src/`.

## App icons / splash (native assets)

**iOS** `ios/hypercolor/Images.xcassets/AppIcon.appiconset/Contents.json`: single `1024x1024` universal slot **with no `filename`**. Directory listing is **only** `Contents.json` — **no PNG**. Expo-generated empty AppIcon. Home-screen icon is missing/placeholder.

iOS splash: `SplashScreenLegacy.imageset/SplashScreenLegacy.png` (79 333 bytes) + 1x only in Contents.json (2x/3x slots empty).

**Android** launcher:

- `android/app/src/main/AndroidManifest.xml`: `android:icon="@mipmap/ic_launcher"` `android:roundIcon="@mipmap/ic_launcher_round"`
- Density webps: `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.webp` and `_round.webp` (mdpi 48×48 PNG-in-webp, 2096 bytes — default Expo glyph, not a Hypercolor mark)
- **No** `mipmap-anydpi-v26/ic_launcher.xml` — **no adaptive icon**
- `drawable/ic_launcher_background.xml` is a **splash layer-list** (`splashscreen_background` + `splashscreen_logo`), not an adaptive background
- Splash logos: `drawable-{mdpi,…}/splashscreen_logo.png`
- Keepalive notification uses `R.mipmap.ic_launcher` (`PaykitAuthKeepaliveService.kt`)

`app.json` has no `expo.icon` / `android.adaptiveIcon` / `ios.icon` entries — icons were not configured in Expo config.

## Accessibility gaps

### Missing `accessibilityLabel` / role on pressables

Grep: 33 `TouchableOpacity` opens **with** `accessibilityLabel` in the opening tag; **37 without**. No `accessibilityRole="button"` anywhere.

Without label (file:line from scan):

- `ThreadTipBar.tsx` Tip chip, Send my tip list, endpoint rows
- `AttachmentBubble.tsx` image and file tap
- `PaymentRequestBubble.tsx` destination rows, Open wallet
- `PaymentRequestCard.tsx` `ActionButton` (Accept/Reject/Cancel/Pay/I paid)
- `TipEndpointsForm.tsx` Save
- `AwaitingRingAuthScreen.tsx` Cancel
- `ChannelsScreen.tsx` all rows, Join, +, toggles, member rows, modal Cancel/Create/Join
- `ChannelScreen.tsx` Reply/react/Edit/Delete, Back, Members, Remove, Add, Refresh, Leave, Clear reply, Send
- `EnableMessagingScreen.tsx` Copy authorization URL
- `SettingsScreen.tsx` Backup now, Restore, Profile row, Run live proof
- Settings `Switch` mesh/telemetry: no `accessibilityLabel`

Tabs use React Navigation’s default tab bar labels (visible text “Chats” etc.), not custom `accessibilityLabel` on icons.

### Touch targets &lt; 44 pt

| Control | Size | File |
|---|---|---|
| Thread back | `styles.backBtn` **width 32** | `ThreadScreen.tsx` |
| Thread ₿ | same `backBtn` width 32 | `ThreadScreen.tsx` |
| Channel back | `minWidth: 32` | `ChannelScreen.tsx` |
| Send | **40×40** | Thread + Channel |
| Attach | **40×40** | `ComposerAttachButton.tsx` |
| Tip chips | `paddingVertical: 6` `paddingHorizontal: 12` | `ThreadTipBar.tsx` |
| Payment chips / action buttons | `paddingVertical: 8` | `PaymentRequestCard.tsx` |
| Header `+` | fontSize 28, no `minHeight`/`hitSlop` | Chats/Channels/Contacts |
| Enable/Settings `← Back` | `width: 60` on the **text**, not a 44-pt hit box | EnableMessaging, Settings, MessageRequests |

### Font scaling

Hardcoded `fontSize` everywhere. Welcome `40` and tab titles `24` will clip or overflow if the user uses large accessibility sizes; composer `maxHeight: 120` will fight scaled text. No `adjustsFontSizeToFit`.

### Color-only signaling

- Failed send: `styles.statusFailed` `#fca5a5` **and** the word `failed to send` (Thread) — text exists.
- Payment chips: color wash **plus** label (`Paid`, `expired`, …) — OK if VoiceOver reads the label (`StatusChip` is a `View`+`Text`, no `accessibilityLabel` on the chip).
- Contacts `nexusNote` `#f59e0b` with the error string — text exists.
- Enable success `#86efac` with sentence — OK.
- Toggle on Channels: selected state is **only** `backgroundColor: '#4c1d95'` vs `#1a1a1a`; labels stay `Private group` / `Public` so not color-only.
- Unread badge: count text on `#7c3aed` — OK.

### Reduced motion

`FlatList` `scrollToEnd({ animated: true })` on Thread (`ThreadScreen.tsx`). Modal `animationType="slide"|"fade"`. Tab/stack `animation: 'slide_from_right'|'slide_from_bottom'`. No `AccessibilityInfo.isReduceMotionEnabled` branch.

### Other

- `AuthQr` has `accessibilityLabel="Authorization QR code"` but the encoded URL is also shown as raw text (good for non-visual; secrets in `pubkyauth` query may be read out).
- Many list rows set `accessibilityLabel` to the **raw 52-char pubky**.
- ChannelScreen and ChannelsScreen have **zero** `testID`s — automation and a11y labels are both thin.
