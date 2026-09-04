# Accessibility proof (measured)

Date: 2026-09-04
Tree: `ux/mobile-integrated` @ `5d59d8f` (merge of VRT capture fixes `f6f8219`). Android on-device recapture and a11y dumps were measured on this tree, not `a93e520` / `ed0d39d`.

## Method

- **Android:** `adb shell uiautomator dump` on VRT catalog scenes after `hypercolor://e2e/vrt?scene=`. Script: `scripts/a11y-android-dump.sh` checks interactive nodes for `content-desc` and bounds ≥ 44dp (`width*px / density`, `height*px / density`).
- **iOS:** `xcodebuild test` Accessibility audit is not wired as a dedicated XCTest in this wave; Inspector-equivalent is the catalog `accessibilityRole` / `accessibilityLabel` tree asserted in Jest plus VoiceOver-sized hit targets (`measure.hitTarget = 44`). Waiver: no Accessibility Inspector CLI on this runner.
- **Contrast:** sampled from captured PNGs via `scripts/a11y-contrast-from-png.ts`. Android samples use `uiautomator dump` text-node bounds; iOS samples use marker-adjacent glyph clusters when a platform dump is unavailable. Each sample compares text pixels inside the detected node/cluster against the nearest surrounding canvas pixels instead of fixed coordinates.
- **Dynamic type:** `WelcomeScreenContent` and `Button` tests mock `PixelRatio.getFontScale()` to `2`, then assert the rendered primary CTA/button keeps a ≥44pt hit target and the label is not capped by `numberOfLines` or `adjustsFontSizeToFit`.

## Android dump results

Prior measured counts (same date, tree `ux/w3-design-system`, product UI dumps): Pixel 4a 5 scenes / status ok 3 / fail 2 / clickable 15 / passing 12 / failing 3; Pixel 8 Pro 5 / 2 / 3 / 19 / 13 / 6.

This run (`5d59d8f`, 2026-09-04): `bash scripts/a11y-android-dump.sh` with Metro (`EXPO_PUBLIC_E2E_VRT=1`) serving a `vrt-scene` bundle, APK installed after `package` was ready, and `A11Y_APP_SETTLE_SECONDS=20`. Dumps are product UI (`package="com.hypercolor"`), not redbox. Critical journeys: Welcome idle, Enable authorizing, Chats populated, Thread populated, Settings default. JSONL: `vrt/output/report/a11y-android-4a.jsonl`, `vrt/output/report/a11y-android-8-pro.jsonl`.

| Profile                                       | Scenes | Status ok | Status fail | Clickable nodes | Passing nodes | Failing nodes |
| --------------------------------------------- | -----: | --------: | ----------: | --------------: | ------------: | ------------: |
| Pixel 4a (`Hypercolor_Pixel_4a_API_36`)       |      5 |         4 |           1 |              21 |            20 |             1 |
| Pixel 8 Pro (`Hypercolor_Pixel_8_Pro_API_36`) |      5 |         3 |           2 |              20 |            16 |             4 |

`a93e520` product a11y fixes for `auth.enable.authorizing`, `stack.thread.populated`, and `tabs.settings.default` are present in these dumps (those three scenes are no longer the redbox-only failures). Remaining `clickable-a11y` nodes (not fixed in this capture pass):

- Pixel 4a `tabs.settings.default`: `android.widget.Switch` (BLE Mesh), empty `content-desc` / `resource-id`, bounds `[897,1130][1025,1204]` (46.5×26.9 dp).
- Pixel 8 Pro `auth.enable.authorizing`: `enableMessagingOpenRing` text empty, desc `Open Pubky Ring`, bounds `[60,2102][1020,2230]` (320.0×42.7 dp, height under 44dp); `enableMessagingCopy` desc `Copy authorization URL`, inverted bounds `[60,2296][1020,2230]` (320.0×−22.0 dp, clipped off the 1080×2400 frame).
- Pixel 8 Pro `tabs.settings.default`: unlabeled `android.widget.Switch` bounds `[880,1236][1020,1317]` (46.7×27.0 dp); `Paste recovery code to restore` `EditText` bounds `[60,2295][1020,2400]` (320.0×35.0 dp).

Both AVDs reported `wm size` 1080×2400 (4a @ 440dpi, 8 Pro @ 480dpi). `auth.welcome.idle` and `stack.thread.populated` were status ok on both profiles.

## Contrast (captured PNGs)

Token pairs in `textOnSurfacePairs` remain the source of truth for brand/canvas. Tab inactive tint uses `color.textSecondary` (`#727986` replacement already bound in `MainTabs`). Measured PNG sampling is recorded in `vrt/output/report/a11y-contrast.json` after recapture.

Android/iOS contrast numbers below were measured from the older `a93e520`/`ed0d39d` PNG archive (123 files per profile). This tree’s Android recapture at `5d59d8f` has 122 files per AVD; contrast was not re-sampled. iOS PNG counts (123) are still current. The sampler derives text bounds from Android dump XML when available and otherwise discovers bright glyph clusters, then compares actual text pixels against the adjacent local dark background. Critical-scene samples are from Welcome idle, Enable authorizing, Chats populated, Thread populated, and Settings default.

| Profile           | PNG count |  Min |   Max | Average | Critical-scene samples                      |
| ----------------- | --------: | ---: | ----: | ------: | ------------------------------------------- |
| iPhone SE         |       123 | 3.29 | 21.00 |   13.41 | 120 samples, min 4.79, max 21.00, avg 14.02 |
| iPhone 16 Pro Max |       123 | 3.73 | 21.00 |   15.27 | 120 samples, min 5.27, max 21.00, avg 15.94 |
| Pixel 4a          |       123 | 3.35 | 21.00 |   14.62 | 120 samples, min 3.40, max 21.00, avg 15.42 |
| Pixel 8 Pro       |       123 | 3.35 | 21.00 |   15.35 | 120 samples, min 5.41, max 21.00, avg 16.03 |

The fixed-coordinate PNG samples from the interrupted full recapture are obsolete and must not be used as accessibility evidence.

## Font scale 2.0

Jest: primary Welcome connect and Button hit targets stay ≥44 with `PixelRatio.getFontScale() === 2`, and neither label is single-line capped or auto-shrunk. VRT scene `a11y.font-scale.two` mounts Welcome for visual layout with the diagnostic badge moved to the top-right edge.

## Byte-distinct screenshots

The final PNG archive is not all byte-distinct. After focused recapture, Pixel 4a has 14 identical SHA-256 groups, Pixel 8 Pro has 2, iPhone SE has 13, and iPhone 16 Pro Max has 14. The Pixel 8 Pro contacts alias pair is now byte-identical after status-bar masking (`tabs_contacts_content-populated_android_pixel-8-pro.png` and `tabs_contacts_populated_android_pixel-8-pro.png` share SHA-256 prefix `be3e67a328b75dc2`).

## Waivers

- iOS Accessibility Inspector CLI not available in this environment; tree roles/labels are asserted in unit tests.
- System `Alert.alert` sheets are OS chrome, not dumped.

## Measured product screenshots (Wave 3 r2)

Focused iOS SE captures (2026-09-03) mount production Content via JourneyScenes:

- `stack_thread_populated_ios_iphone-se-3.png` — mine/theirs bubbles, delivery "Sent", composer.
- `tabs_chats_populated_ios_iphone-se-3.png` — avatar initials, relative times, snippets.
- `auth_welcome_idle_ios_iphone-se-3.png` — brand + Connect CTA.
- `tabs_settings_default_ios_iphone-se-3.png` — identity/homeserver/BLE/backup sections.

iOS recapture remains green at `f6f8219` / this merge: 123 scenes × 2 simulators = 246 PNGs, integrity `ok=true files=246 comparedPairs=15006 failures=0 marker_gaps=0 waivedPairs=44`.

Android recapture at `5d59d8f` (2026-09-04): 122/123 scenes per AVD (`ok=122 fail=1` both). Failed scene `tabs.profile.sign-out` — Maestro `Assertion is false: "vrt-scene:tabs.profile.sign-out" is visible` on three attempts (product marker never appeared). PNGs: 244. Integrity `ok=false files=244 comparedPairs=14762 failures=0 marker_gaps=2 waivedPairs=32`. Gaps: `tabs.profile.sign-out|android|pixel-4a` and `tabs.profile.sign-out|android|pixel-8-pro`. Pixel 4a duration 66m 49s; Pixel 8 Pro 63m 32s. `npm run vrt:catalog`: 123 captured, 1 failed (the missing Android sign-out pair).
