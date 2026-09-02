# Hypercolor accessibility, motion, and visual-regression contract

Status: **binding for every UX/UI implementation wave**. This contract covers mobile at
`b12e8d6` and web at `89048ad`. A wave does not close until the applicable checks in
section G pass. The black `#0a0a0a` canvas, violet `#7c3aed` brand, `#1a1a1a` hairline,
muted gray family, and 12 px product radius remain the visual identity.

## A. Contrast

Ratios below were computed from WCAG 2.2 relative luminance after sRGB
linearization. CSS `oklch()` colors were converted through OKLab to sRGB before
measurement; alpha colors were composited over their stated background first.
`Body` uses the 4.5:1 threshold. `UI/large` uses 3:1 for non-text controls and text
at least 18 pt regular or 14 pt bold. Small 10–16 px copy is body text, even when
called metadata. Disabled controls are exempt from WCAG contrast, but their ratios
are recorded because disabled state must remain perceptible.

### Mobile pairs

| Foreground / background | Ratio | Body | UI/large | Binding replacement when used as body text |
|---|---:|:---:|:---:|---|
| `#7c3aed` / `#0a0a0a` | 3.47 | Fail | Pass | Keep brand for icons, focus, large/bold text; use `#8f57f0` for small brand text (4.50). |
| `#fff` / `#7c3aed` | 5.70 | Pass | Pass | None. |
| `#6b7280` / `#0a0a0a` | 4.10 | Fail | Pass | `#727986` (4.50). |
| `#6b7280` / `#111111` | 3.91 | Fail | Pass | `#757c89` (4.50). |
| `#6b7280` / `#141414` | 3.81 | Fail | Pass | `#777e8b` (4.50). |
| `#6b7280` / `#1a1a1a` | 3.60 | Fail | Pass | `#7c828e` (4.50). |
| `#6b7280` / `#1f1f1f` | 3.41 | Fail | Pass | `#808692` (4.50). |
| `#6b7280` / `#1f1b2e` | 3.46 | Fail | Pass | `#7f8591` (4.50). |
| `#4b5563` / `#0a0a0a` | 2.62 | Fail | Fail | `#717984` for body (4.50), minimum `#545e6b` for UI/large (3.00). |
| `#4b5563` / `#111111` | 2.50 | Fail | Fail | `#757c87` for body, minimum `#57616e` for UI/large. |
| `#4b5563` / `#141414` | 2.44 | Fail | Fail | `#777e89` for body, minimum `#59626f` for UI/large. |
| `#4b5563` / `#1a1a1a` | 2.30 | Fail | Fail | `#7b828d` for body, minimum `#5d6673` for UI/large. |
| `#4b5563` / `#1f1f1f` | 2.18 | Fail | Fail | `#7f8690` for body, minimum `#616a76` for UI/large. |
| `#4b5563` / `#1f1b2e` | 2.22 | Fail | Fail | `#7e858f` for body, minimum `#606975` for UI/large. |
| `#fca5a5` / `#0a0a0a` | 10.43 | Pass | Pass | None. |
| `#fca5a5` / `#111111` | 9.95 | Pass | Pass | None. |
| red-400 `#f87171` / brand | 2.06 | Fail | Fail | Do not place red-400 text on brand. Use `#fddddd` for body (4.50) or `#fba6a6` for UI/large (3.00), plus an error icon and text. |
| amber-400 `#fbbf24` / brand | 3.41 | Fail | Pass | `#fde29d` for body (4.50); current amber is acceptable only for UI/large. |
| `#fbbf24` / `#111111` | 11.31 | Pass | Pass | None. |
| `#f59e0b` / `#0a0a0a` | 9.22 | Pass | Pass | None. |
| `#c4b5fd` / `#0a0a0a` | 10.72 | Pass | Pass | None. |
| `#a78bfa` / `#0a0a0a` | 7.27 | Pass | Pass | None. |
| `#9ca3af` / `#0a0a0a` | 7.80 | Pass | Pass | None. |
| `#86efac` / `#0a0a0a` | 14.10 | Pass | Pass | None. |
| white 80% / brand | 4.21 | Fail | Pass | Use white at least 84.3% for body or opaque white. |
| white 70% / brand | 3.57 | Fail | Pass | Use white at least 84.3% for body; at least 59.8% is sufficient only for UI/large. |
| white 60% / brand | 3.01 | Fail | Pass | Same replacement. |
| white 55% / brand | 2.76 | Fail | Fail | Raise to at least 84.3% for body or 59.8% for UI/large. |
| white 50% / brand | 2.52 | Fail | Fail | Same replacement. |
| white 40% / brand | 2.10 | Fail | Fail | Same replacement. |
| white 18% / brand | 1.38 | Fail | Fail | This may remain a decorative border/fill only; never text or a required control boundary. |
| white 12% / brand | 1.24 | Fail | Fail | Decorative fill only. |

The raised-surface rows cover the implemented `#111`/`#111111` modals and cards,
`#141414` tip bar, `#1a1a1a` inputs/hairlines, `#1f1f1f` received bubbles, and
`#1f1b2e` enable card. The replacement is background-specific; introducing one
muted-body token must use the worst-case `#808692` so it passes on all of them.

### Web pairs

| Foreground / background | Ratio | Body | UI/large | Binding replacement |
|---|---:|:---:|:---:|---|
| `oklch(0.985 0 0)` / `oklch(0.145 0 0)` | 18.96 | Pass | Pass | None. |
| `oklch(0.708 0 0)` / `oklch(0.145 0 0)` | 7.63 | Pass | Pass | None. |
| `oklch(0.708 0 0)` / card `oklch(0.205 0 0)` | 6.91 | Pass | Pass | None. |
| `#7c3aed` / `oklch(0.145 0 0)` | 3.47 | Fail | Pass | Use `#8f57f0` for small links; keep brand for UI, large/bold text, and decoration. |
| `#7c3aed` / secondary `oklch(0.269 0 0)` | 2.65 | Fail | Fail | Use `#a273f2` for body (4.50), or at least `#8548ee` for UI/large (3.00). |
| `#fff` / `#7c3aed` | 5.70 | Pass | Pass | None. |
| white 70% / `#7c3aed` | 3.57 | Fail | Pass | Use at least 84.3% white for 11 px bubble metadata. |
| red-400 `#f87171` / background | 7.16 | Pass | Pass | None. |
| red-400 `#f87171` / card | 6.48 | Pass | Pass | None. |
| amber-400 `#fbbf24` / card | 10.73 | Pass | Pass | None. |
| primary foreground `oklch(0.205 0 0)` / primary `oklch(0.922 0 0)` | 14.22 | Pass | Pass | None. |
| muted foreground at 60% / secondary | 3.04 | Fail | Pass | Disabled-only today. If it becomes meaningful text, remove opacity and use the normal muted foreground. |
| foreground at 80% / background | 12.07 | Pass | Pass | None. |
| black QR modules / white pad | 21.00 | Pass | Pass | None. |

There are **27 platform usage pairs that fail body-text contrast**; **13 also fail
3:1**. This count treats the same brand pair on mobile and web as two platform
usages and includes low-alpha on-bubble text. Decorative low-alpha fills are only
acceptable when they carry no information.

## B. Interaction and accessibility requirements

### Requirements shared by both clients

- Every interactive target is at least 44 by 44 logical points/CSS pixels,
  including inline links, icon buttons, reaction chips, checkboxes, and dismiss
  controls. Visual glyphs may remain smaller inside the target.
- Every control exposes a stable accessible name, role, disabled/selected/checked
  state, and current value where applicable. Do not use a raw pubky, emoji, `+`,
  `←`, `₿`, or `↑` as the only accessible name.
- Error states use text plus an icon or semantic role, never color alone. Put the
  error adjacent to the field/action, identify the failed operation, and preserve
  the user's input.
- Text must scale to 200% without overlap, truncation of required meaning, or
  clipping/occlusion of the primary CTA. Containers grow; body copy wraps; control
  rows may stack. Pubkys may wrap or use an accessible abbreviated visual form
  whose accessible name is a human label plus a deliberately grouped identifier.

### Mobile

Use `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` only where the
result is not evident from the label, `accessibilityState`, and
`accessibilityValue`. Group composite status cards with
`accessible={true}` only when doing so does not hide child actions. Switches expose
`checked`; busy buttons expose `busy` and `disabled`; selected channel/member/toggle
states expose `selected` or `checked`.

The current scan found exactly **37 unlabeled `TouchableOpacity` instances**:

| Path | Instances (current lines) | Required names |
|---|---:|---|
| `src/components/ThreadTipBar.tsx` | 3 (63, 66, 78) | Tip toggle with expanded state; Send my tip list; payment endpoint including method and destination label. |
| `src/components/AttachmentBubble.tsx` | 2 (111, 136) | Open/decrypt image attachment; open/decrypt file attachment with filename. |
| `src/components/PaymentRequestBubble.tsx` | 2 (126, 157) | Select payment destination; Open wallet. |
| `src/components/PaymentRequestCard.tsx` | 1 (133) | The supplied action label: Accept, Reject, Cancel, Pay, or I paid. |
| `src/components/TipEndpointsForm.tsx` | 1 (54) | Save tip endpoints. |
| `src/screens/auth/AwaitingRingAuthScreen.tsx` | 1 (81) | Cancel Pubky Ring connection. |
| `src/screens/main/ChannelsScreen.tsx` | 10 (181, 210, 213, 244, 250, 266, 292, 295, 322, 325) | Open named channel; Join channel; New channel; Private group; Public channel; select named member with checked state; Cancel/Create; Cancel/Join. |
| `src/screens/main/ChannelScreen.tsx` | 12 (370, 375, 385, 388, 416, 422, 452, 468, 474, 479, 507, 529) | Reply; named reaction; Edit; Delete; Back; Members/Chat with expanded state; Remove named member; Add member; Refresh; Leave; clear reply; Send message. |
| `src/screens/main/EnableMessagingScreen.tsx` | 1 (145) | Copy authorization URL. |
| `src/screens/main/SettingsScreen.tsx` | 4 (100, 144, 209, 362) | Backup now; Restore from backup; Open Profile; Run live proof. |

The 37 count excludes two additional unlabeled native `Switch` controls in
`src/screens/main/SettingsScreen.tsx` (mesh and telemetry); they must be labelled
and expose checked state as well.

Current sub-44 targets that must be enlarged without inflating their glyphs:

- `src/screens/main/ThreadScreen.tsx`: 32 pt Back and payment buttons; 40 by 40
  Send.
- `src/screens/main/ChannelScreen.tsx`: 32 pt minimum Back/Members and 40 by 40
  Send.
- `src/components/ComposerAttachButton.tsx`: 40 by 40 Attach.
- `src/components/ThreadTipBar.tsx`: 6 px vertical-padding chips.
- `src/components/PaymentRequestCard.tsx`: 8 px vertical-padding status/action
  chips.
- `src/screens/main/ChatsScreen.tsx`,
  `src/screens/main/ChannelsScreen.tsx`, and
  `src/screens/main/ContactsScreen.tsx`: header `+` controls have no 44 pt
  minimum or hit slop.
- `src/screens/main/EnableMessagingScreen.tsx`,
  `src/screens/main/SettingsScreen.tsx`, and
  `src/screens/main/MessageRequestsScreen.tsx`: the 60 px-wide Back text has no
  44 pt minimum height.

All mobile typography is hardcoded and therefore requires a 200% layout pass.
The affected sites are:
`src/components/EnableMessagingCta.tsx`,
`src/components/TipEndpointsForm.tsx`,
`src/components/TipEndpointsSettings.tsx`,
`src/components/PaymentRequestBubble.tsx`,
`src/components/PaymentRequestCard.tsx`,
`src/components/AttachmentBubble.tsx`,
`src/components/ThreadTipBar.tsx`,
`src/components/PaymentComposeSheet.tsx`,
`src/components/ComposerAttachButton.tsx`,
`src/navigation/E2eSignupHud.tsx`,
`src/screens/auth/WelcomeScreen.tsx`,
`src/screens/auth/AwaitingRingAuthScreen.tsx`,
`src/screens/auth/DebugSignupPanel.tsx`,
`src/screens/main/ChatsScreen.tsx`,
`src/screens/main/ChannelsScreen.tsx`,
`src/screens/main/ChannelScreen.tsx`,
`src/screens/main/ContactsScreen.tsx`,
`src/screens/main/ContactSearchScreen.tsx`,
`src/screens/main/ThreadScreen.tsx`,
`src/screens/main/EnableMessagingScreen.tsx`,
`src/screens/main/MessageRequestsScreen.tsx`,
`src/screens/main/ProfileScreen.tsx`, and
`src/screens/main/SettingsScreen.tsx`.
Keep RN font scaling enabled, do not solve clipping with
`allowFontScaling={false}`, and do not use a restrictive
`maxFontSizeMultiplier` for primary content. In particular, remove layout
dependence on the Thread/Channel composer `maxHeight: 120`, fixed one-line status
rows, and fixed-height CTA/header assumptions.

Announcements:

- Thread and channel sends: the composer group is busy while sending; announce
  “Message sending”, then “Message sent”, “Message queued”, or “Message failed”.
  Do not repeatedly announce polling changes.
- Inbox refresh and request decisions: expose one polite live status and announce
  completion/count changes. Errors are assertive once.
- Messaging session changes: announce offline/revoked as an alert once, and
  restored/enabled as a polite status.
- On Android use `accessibilityLiveRegion`; on both platforms use
  `AccessibilityInfo.announceForAccessibility` for one-shot transitions that are
  not reliably represented by a mounted live region. Do not announce auth URLs,
  recovery codes, invoices, or full pubkys.

### Web

The current unnamed/weakly named surfaces are:

- `src/components/composer.tsx`: the visually hidden file `<input>` has no name.
  Give it “Choose attachment”; keep the sibling button “Attach file”.
- `src/components/message-bubble.tsx`: emoji reaction buttons expose only the
  emoji. Name them “React with {reaction name}”; expose pressed state when the
  current user selected one.
- `src/components/site-nav.tsx`: the `<nav>` landmark is unnamed. Set
  `aria-label="Primary"`.
- `src/components/contacts-page.tsx`: contact-row accessible names are raw pubkys.
  Prefer “Open contact {display name}, identifier {grouped short identifier}”.
- `src/components/chats-page.tsx`: rows without display names can similarly fall
  back to a grouped short identifier, not 52 unbroken characters.
- `src/components/auth-qr.tsx`: the wrapper and image duplicate “Authorization QR
  code”. Keep one exposed image/name and make the chrome presentational.

Current sub-44 web targets:

- `src/components/ui/button.tsx`: default and icon are 36 px, small is 32 px,
  large is 40 px. All variants must have `min-h-11`; icon must also have
  `min-w-11`.
- `src/components/ui/input.tsx`: 36 px. Use `min-h-11`.
- `src/components/composer.tsx`: 36 by 36 Attach through the icon variant.
- `src/components/message-bubble.tsx`: reaction, Edit, and Delete text buttons
  have no 44 px minimum.
- `src/components/tag-channel-view.tsx`: disabled 32 px post control. It remains
  disabled but must still be perceptible at 44 px.
- `src/components/site-nav.tsx`: text-run links have no minimum target box.
- Small-button call sites inherit the 32 px violation from
  `src/components/attachment-bubble.tsx`,
  `src/components/follows-import-panel.tsx`,
  `src/components/session-banner.tsx`,
  `src/components/enable-messaging-cta.tsx`,
  `src/components/discover-page.tsx`,
  `src/components/tab-lock-banner.tsx`,
  `src/components/settings-page.tsx`,
  `src/components/requests-page.tsx`,
  `src/components/contacts-page.tsx`,
  `src/components/channels-page.tsx`,
  `src/components/channel-view.tsx`,
  `src/components/chats-page.tsx`, and
  `src/components/message-bubble.tsx`.

Add a first-focus skip link in `app/layout.tsx`, visually revealed on focus,
targeting `<main id="main-content" tabIndex={-1}>`. Route headings are `h1`; panel
headings preserve hierarchy.

For list-to-detail navigation in Chats, Channels, Contacts, and Discover:

1. Opening a row records the row's stable DOM id.
2. On a detail route, move focus to the detail `h1` after navigation.
3. The mobile-width detail header includes “Back to Chats/Channels/Contacts/
   Discover”.
4. Back restores focus to the originating row. If the route was opened directly,
   focus the list heading after Back. If the row no longer exists, focus the list
   heading.
5. Closing Settings recovery and Channel members restores focus to the control
   that opened the panel. Never leave focus on an unmounted button.

Live semantics:

- Send forms (`src/components/composer.tsx`, thread/channel hosts): set
  `aria-busy` on the form or timeline while settling; use one `role="status"`
  `aria-live="polite"` result. Failed sends use `role="alert"` and move focus to
  Retry only when the failure followed a keyboard submit.
- Inbox/channel/request loaders: the owning region gets `aria-busy`; loading and
  completion/count copy uses a polite status.
- `src/components/session-banner.tsx`: offline/revoked becomes `role="alert"`;
  checking and restored are polite statuses. `src/components/tab-lock-banner.tsx`
  remains a named status.
- Validation errors use `aria-invalid`, `aria-describedby`, and an error summary
  when more than one field fails.

At browser zoom/text scaling of 200%, primary CTAs remain visible without
horizontal scrolling at 390 CSS px. The 11 px metadata in
`src/components/message-bubble.tsx` must become at least 12 px and wrap. Do not
truncate action labels.

Keyboard-only users must complete: Connect/adopt/cancel on `/`; Enable/Open Chats/
retry on `/enable`; open list row, Back, compose, attach, send, Retry in a thread;
create/open/member actions in Channels; Contacts search/add/detail/open chat;
Requests accept/decline; Settings backup confirmation/copy/hide/restore; Profile
sign out; and tab takeover. Tab order follows visual order, Enter/Space activate
buttons, Escape closes only actual dismissible overlays, and focus is always
visible at 3:1 against adjacent colors.

## C. Motion and haptics

### Motion budget

| Motion | Maximum duration | Easing |
|---|---:|---|
| Opacity, color, chip, inline status, and short slide (up to 24 px) | 200 ms | Enter `cubic-bezier(.2,.8,.2,1)`; exit `cubic-bezier(.4,0,1,1)` |
| Full-screen navigation push/pop | 250 ms | Platform-standard ease-out; no parallax over 8% of width |
| Modal/sheet appear/disappear | 150 ms | Opacity plus at most 16 px translation |
| Loading spinner | Indeterminate while work is active | No fake minimum time; replace with static “Loading…” under reduced motion |

No bounce, spring overshoot, auto-scrolling carousel, animated gradient, or
flashing state is allowed. Nothing flashes more than three times per second.
Motion never delays input, changes a protocol timeout, or serves as the only
signal that state changed.

### Reduced motion

Mobile subscribes to `AccessibilityInfo.isReduceMotionEnabled()` and
`reduceMotionChanged`:

- iOS Reduce Motion: set React Navigation transitions to fade/no animation,
  `Modal.animationType="none"`, make `scrollToEnd` non-animated unless initiated
  by the user, stop decorative transforms, and show static progress/status.
- Android Remove animations / animator duration scale 0: use Reanimated
  `reduceMotion: ReduceMotion.System` for every decorative `withTiming` and
  transition. Reanimated short-circuits `withTiming` when animator scale is 0.
  **Semantic timers** (expiry, debounce, auth wait, protocol timeout, delayed
  cleanup) must not be implemented as animation completion callbacks; if an
  existing Reanimated timing primitive must drive a semantic clock, explicitly
  use `ReduceMotion.Never` and keep it visually inert. Decorative motion must
  never use `Never`.
- The reduced path updates final layout/state in the same event-loop turn where
  practical and retains all completion callbacks needed for product state.

Web defines a global `@media (prefers-reduced-motion: reduce)` rule that sets
decorative transition/animation duration to effectively zero, stops smooth
scrolling, and removes transforms. Component code also queries
`matchMedia("(prefers-reduced-motion: reduce)")` for scripted animation. VRT's
`animations: "disabled"` is test stabilization, not proof of this product behavior.

### Haptics

Haptics are optional and limited to:

- one light confirmation when a message is accepted for send;
- one medium handoff acknowledgement when the user deliberately opens a wallet;
- one success notification after Connect or Enable has actually completed.

No haptic is allowed for typing, scrolling, navigation, polling, incoming-message
render, validation error, or repeated retry. Never imply delivery or payment with
a send/handoff haptic. Mobile must provide an in-app **Haptics** switch, default
on while also respecting OS vibration/haptic accessibility settings; when off,
no Hypercolor-triggered haptic API may run. Reduced Motion does not itself disable
haptics, but the explicit off switch always wins. Web must not call the Vibration
API. If mobile ships haptics, `expo-haptics` must be added and all calls must pass
through one policy wrapper rather than direct component imports.

## D. Mobile VRT catalog

### Architecture and driver

Create a deterministic catalog inside the mobile repo, reachable only in
`__DEV__` **and** an explicit `E2E_VRT=1` build/runtime gate. Production builds
must tree-shake or refuse the entry. The catalog navigator renders every row and
state in `/tmp/hypercolor-ux/vrt-state-matrix.md`; that matrix is normative,
including “capture current absence” states. It mounts existing presentational
`*Content` components (`ThreadScreenContent`, `ChannelsScreenContent`,
`ChannelScreenContent`, `ContactsScreenContent`, `MessageRequestsContent`,
`ThreadTipBarContent`) and extracts equivalent pure presenters where a screen
currently owns data. Fixtures are frozen objects; `Date.now`, locale, random,
network, KeyStore, Ring, homeserver, Nexus, and native Paykit calls are prohibited.
Any accidental network call fails the scene visibly and the run.

Maestro is the runner. A catalog index exposes stable scene ids and next/previous
controls for manual review. Maestro flows select a scene, wait for a
`vrtSceneReady` testID, and call `takeScreenshot`. iOS may accept a launch argument
or `hypercolor://e2e/vrt?scene=...`. Android must use a launch-argument, clipboard,
or the existing `e2eClipboardChannel.ts` command channel: the activity is
`singleTask`, and Maestro `openLink` VIEW intents are currently dropped. A deep
link alone is not an acceptable Android driver.

### Device matrix and captures

The required fixed matrix is:

- Android small: Pixel 4a profile, 360 by 800 dp.
- Android large: Pixel 8 Pro profile, 448 by 998 dp.
- iOS small: iPhone SE (3rd generation), 375 by 667 pt.
- iOS large: iPhone 15 Pro Max, 430 by 932 pt.

Pin OS version, display scale, font scale 100%, locale `en-US`, 12/24-hour clock,
dark appearance, timezone UTC, and safe-area configuration in runner metadata.
Run a separate 200% font-scale accessibility pass for layout assertions; its
captures are diagnostic rather than pixel-gated against 100% baselines.

Capture names are exactly:

`journey/screen/state/platform/device.png`

Segments are lower-kebab-case and immutable once approved. The capture manifest
maps every matrix row to one or more names; duplicate or missing names fail before
emulators start.

Mask only deterministic privacy/nondeterminism zones, never whole controls:

- QR image and rendered auth URL;
- recovery code;
- full/short z32/pubky identifiers and avatar letters derived from them;
- relative/clock/date/expiry timestamps and `Date.now()` tip expiry;
- unread counts only in scenes not explicitly testing unread;
- E2E HUD tokens/secrets;
- payment URI/invoice payload;
- platform status bar if the simulator cannot pin it.

Each mask is a catalog-owned opaque rectangle with a stable `testID`, rendered in
the candidate and baseline before capture. Maestro's text mutation is not a
reliable pixel mask. Scenes specifically testing avatar or unread layout use fixed
synthetic values and do not mask those regions.

### Baselines, diff, and reports

Store approved PNG baselines directly in Git under
`.maestro/vrt/baselines/<journey>/<screen>/<state>/<platform>/<device>.png`.
The mobile repo does **not** use Git LFS today: `.gitattributes` only declares
`*.pbxproj -text`, and `git lfs ls-files` is empty. AAR/build outputs are not
evidence of LFS. Start with ordinary Git PNGs; adopt LFS only through a separately
approved repository-wide storage decision after measuring repository growth.

Use a Node script with `pixelmatch` + `pngjs`; both are JavaScript-only and add no
native app dependency. Compare equal-sized images in sRGB, write a red/transparent
diff PNG, and fail on either changed pixels above the approved anti-alias threshold
or any dimension mismatch. Default gate: `threshold: 0.1`,
`includeAA: false`, and at most 0.1% changed pixels; scene-specific tolerances
require named-human approval in the manifest and may not mask substantive UI.

Generate a standalone static report:

- header: baseline SHA, candidate SHA, runner version, OS/device matrix, timestamp,
  and overall approval status;
- grouped navigation: journey → screen → state → platform/device;
- each result: baseline, candidate, and diff at identical scale, changed-pixel
  count/percentage, dimensions, mask list, and approval status;
- filters for failed/unreviewed/platform/device and direct anchor links;
- all CSS/images vendored or relative so the directory opens from disk and can be
  zipped.

Pixel work runs in a separate `mobile-vrt` macOS job, never the existing Ubuntu
unit-test job. It builds the e2e catalog once per platform, runs the four simulator
profiles, uploads candidates/diffs/report, and compares against Git baselines.
Baseline updates require a named human approval and a PR label such as
`vrt-baseline-approved`; CI never rewrites baselines.

## E. Web VRT catalog

### Catalog and projects

Add `app/e2e/ux-catalog/**`; every page calls `requireE2eHarness()` before mounting
the catalog host. With `NEXT_PUBLIC_E2E_HARNESS` unset, it must return 404 and must
not be included in a production-facing navigation path. Mount production
presentational components with typed frozen fixtures. Prefer extracted props-only
views over mocking IndexedDB/service singletons. Block `fetch`, WebSocket, service
worker registration, Ring, wasm session bootstrap, and current-time reads in the
catalog; unexpected IO fails the scene.

The catalog implements every state in
`/tmp/hypercolor-ux/web/vrt-state-matrix.md`, including states whose current
absence is itself the baseline. Query keys `journey`, `screen`, and `state` select
one stable scene. A ready marker includes the scene id and fixture revision.

Configure Playwright projects:

- `chromium-mobile-pixel`: Chromium, 390 by 844, pixel gate.
- `chromium-desktop-pixel`: Chromium, 1280 by 800, pixel gate.
- `webkit-smoke`: matching viewports, behavior/accessibility smoke only.
- `firefox-smoke`: matching viewports, behavior/accessibility smoke only.

Pin locale `en-US`, timezone UTC, color scheme dark, reduced motion no-preference,
device scale factor 1, and bundled/local fonts. Chromium on the pinned CI image is
the only baseline renderer. Every pixel assertion uses:

`await expect(scene).toHaveScreenshot(name, { animations: "disabled", mask })`

Mask QR/auth URLs, recovery code, all z32/pubky anchors and identity-derived avatar
letters, clocks/dates/expiry, payment payloads, fixture images unless fixed to a
checked-in 1 by 1 asset, and the OS scrollbar when full-page behavior cannot pin
it. Add stable `data-testid`s at the presenter boundary; do not select masks by
Tailwind class text.

Set `snapshotPathTemplate` to:

`e2e/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}`

Commit Chromium baselines as ordinary PNGs. WebKit/Firefox produce traces and
failure screenshots but have no pixel approval gate.

### Report and approval

Configure Playwright's built-in HTML reporter at `playwright-report/` with
`open: "never"` and retain `test-results/`. A report-builder script creates
`ux-vrt-report/index.html`, copies only VRT baseline/candidate/diff images and
metadata, and presents the same journey → screen → state → platform hierarchy as
mobile. It is static, uses relative assets, records both SHAs and approval state,
and is uploaded with the built-in report as a CI artifact. Stakeholders can unzip
and open `ux-vrt-report/index.html` without Node or a dev server.

Run this in a dedicated `web-vrt` job after unit CI, install the pinned Chromium
binary, and upload both report directories even on failure. A baseline update is
accepted only when a named human reviewer approves the image changes and applies
`vrt-baseline-approved`. Bots and candidate loops may produce candidates but may
not approve or update a baseline.

Expected wiring files:

| Path | Purpose | Human-branch vibeware status |
|---|---|---|
| `app/e2e/ux-catalog/page.tsx` and optional route children | Harness gate and scene route | Allowed on a human branch; outside candidate writable paths. |
| `src/components/ux-catalog/**` and `src/fixtures/ux-catalog/**` | Fixture host, scene registry, frozen synthetic fixtures | Allowed on a human branch; outside candidate writable paths. |
| Existing production presenter files in `src/components/**` | Props-only extraction, mask hooks, a11y fixes | Allowed on a human branch. Some are candidate-writable, but the catalog wave itself is not a candidate branch. |
| `e2e/ux-catalog.spec.ts` | Matrix enumeration and screenshots | Allowed on a human branch; outside candidate writable paths. |
| `e2e/__screenshots__/**` | Approved Chromium baselines | Allowed on a human branch; outside candidate writable paths. |
| `playwright.config.ts` | Projects, snapshot path, HTML reporter | Allowed on a human branch; outside candidate writable paths. |
| `scripts/build-ux-vrt-report.mjs` | Standalone static report | Allowed on a human branch; outside candidate writable paths. |
| `.github/workflows/ux-vrt.yml` | Separate VRT job and artifacts | Human branch allowed, but `.github/**` is candidate-forbidden and CODEOWNERS-reviewed. |
| `package.json` / lockfile, only if scripts or axe are added | VRT/axe commands and dependency pin | Human branch allowed, but candidate-forbidden and CODEOWNERS-reviewed. |

The vibeware path policy is enforced only for marked `vibeware/**` or
`candidate/**` work. All rows above are legal on a normal human branch; this does
not waive CODEOWNERS. Do not implement the catalog in a candidate loop.

## F. Fixture and report privacy

- No real pubkys, names, messages, contacts, group names, recovery codes, auth
  URLs, session cookies, bearer tokens, invoices, payment methods, attachment
  bytes, or homeserver account data may enter fixtures, screenshots, traces, or
  reports.
- Use clearly synthetic identities such as “Aster Example” and “Bramble Example”.
  Valid-format z32 identifiers must be fixed test-only values generated once from
  non-secret bytes and marked synthetic in the fixture source. Message copy is
  invented and contains no production transcript.
- Recovery-code scenes use a deliberately invalid checksum/test vocabulary and
  remain masked. Auth and invoice scenes use non-routable, parseable test payloads.
- Before artifact upload or sharing, recursively scan text, HTML, JSON, traces,
  and extracted screenshot metadata for `pk:`, 52-character z-base-32 patterns
  (`[ybndrfg8ejkmcpqxot1uwisza345h769]{52}`), auth URL schemes/query keys,
  cookies/tokens, invoice prefixes, and every word from the supported recovery/
  BIP39 lists. Any hit blocks publishing until a human confirms it is an approved
  synthetic fixture or removes the artifact.
- Reports are safe to share externally only after that scan passes and a named
  human reviews the mask manifest. Public hosting, including public CI artifacts,
  requires the user's explicit approval. Default artifacts remain access-
  controlled and expire.

## G. Acceptance checklist

### Accessibility

- [ ] Automated axe has no critical or serious violations on every critical web
      route and every catalog state representing a critical route: `/`, `/enable`,
      Chats list/thread, Channels list/detail, Contacts list/detail, Requests,
      Settings/recovery, Profile, Discover/topic, Ring callback, session-offline,
      and tab-lock.
- [ ] iOS Accessibility Inspector audit and manual VoiceOver completion pass on
      Connect, Enable success, first DM/send failure, Requests, private group,
      payment handoff, attachment, backup/recovery, session-offline, and sign out.
- [ ] Android Accessibility Scanner audit and manual TalkBack completion pass on
      the same applicable mobile routes.
- [ ] Every control has name/role/state/value; no raw glyph or pubky is the only
      name; every target measures at least 44 by 44.
- [ ] 200% text/font scale leaves every primary CTA operable and all required copy
      readable at small-device widths.
- [ ] Errors have semantic announcements and non-color indicators.
- [ ] Keyboard-only users complete every web flow listed in section B, with
      visible focus, correct order, detail-entry focus, and list focus restoration.
- [ ] Skip link reaches main content.

### Motion and haptics

- [ ] iOS Reduce Motion recording proves no slide/modal/decorative transform and
      no animated auto-scroll while all state transitions still complete.
- [ ] Android animator scale 0 recording proves decorative Reanimated timing
      short-circuits and auth/expiry/debounce/cleanup timers still complete.
- [ ] Web `prefers-reduced-motion: reduce` recording proves transitions and smooth
      scrolling stop; VRT `animations: disabled` is not used as this proof.
- [ ] Haptics occur only for the three allowed events, communicate no stronger
      state than the UI, respect OS policy, and produce zero calls with the in-app
      switch off.

### Visual regression

- [ ] Every row/state in both Wave 0 VRT matrices has a manifest entry and an
      approved baseline before its implementation wave closes.
- [ ] Mobile runs all four pinned devices through Maestro and pixelmatch; web runs
      both Chromium pixel projects plus WebKit/Firefox smoke.
- [ ] Mask manifests contain only the regions allowed in sections D/E.
- [ ] Candidate, diff, built-in Playwright report, and standalone report artifacts
      are retained on failure and contain both commit SHAs.
- [ ] Baseline changes have named-human review and the
      `vrt-baseline-approved` label.
- [ ] Privacy scan passes before artifact sharing; public hosting has explicit user
      approval.

## Tooling required

- Mobile: install development-only `pixelmatch` and `pngjs`; Maestro is already
  installed/configured. No Detox, Storybook, or native diff dependency is needed.
- Web: Playwright is already installed. Pin/install its CI Chromium browser.
  Install development-only `@axe-core/playwright` for the automated acceptance
  gate. The built-in HTML reporter requires no package.
- Mobile haptics: install `expo-haptics` only when the haptic policy wrapper and
  user off switch ship in the same change.

Runner decisions: mobile uses **Maestro plus the clipboard/launch-argument scene
channel and pixelmatch/pngjs**, with ordinary Git PNG baselines. Web uses
**Git-tracked Chromium Playwright screenshots, the built-in HTML report, and a
standalone static stakeholder index**.
