# Accessibility proof (measured)

Date: 2026-09-04
Tree: `ux/mobile-integrated` @ `a93e520`

## Method

- **Android:** `adb shell uiautomator dump` on VRT catalog scenes after `hypercolor://e2e/vrt?scene=`. Script: `scripts/a11y-android-dump.sh` checks interactive nodes for `content-desc` and bounds ≥ 44dp (`width*px / density`, `height*px / density`).
- **iOS:** `xcodebuild test` Accessibility audit is not wired as a dedicated XCTest in this wave; Inspector-equivalent is the catalog `accessibilityRole` / `accessibilityLabel` tree asserted in Jest plus VoiceOver-sized hit targets (`measure.hitTarget = 44`). Waiver: no Accessibility Inspector CLI on this runner.
- **Contrast:** sampled from captured PNGs via `scripts/a11y-contrast-from-png.ts`. Android samples use `uiautomator dump` text-node bounds; iOS samples use marker-adjacent glyph clusters when a platform dump is unavailable. Each sample compares text pixels inside the detected node/cluster against the nearest surrounding canvas pixels instead of fixed coordinates.
- **Dynamic type:** `WelcomeScreenContent` and `Button` tests mock `PixelRatio.getFontScale()` to `2`, then assert the rendered primary CTA/button keeps a ≥44pt hit target and the label is not capped by `numberOfLines` or `adjustsFontSizeToFit`.

## Android dump results

Prior measured counts (same date, tree `ux/w3-design-system`, product UI dumps): Pixel 4a 5 scenes / status ok 3 / fail 2 / clickable 15 / passing 12 / failing 3; Pixel 8 Pro 5 / 2 / 3 / 19 / 13 / 6.

This run (`a93e520`, 2026-09-04): `bash scripts/a11y-android-dump.sh` after the four-profile recapture. Critical journeys: Welcome idle, Enable authorizing, Chats populated, Thread populated, Settings default.

| Profile                                       | Scenes | Status ok | Status fail | Clickable nodes | Passing nodes | Failing nodes |
| --------------------------------------------- | -----: | --------: | ----------: | --------------: | ------------: | ------------: |
| Pixel 4a (`Hypercolor_Pixel_4a_API_36`)       |      5 |         0 |           5 |              10 |             0 |            15 |
| Pixel 8 Pro (`Hypercolor_Pixel_8_Pro_API_36`) |      5 |         0 |           5 |              10 |             0 |            15 |

Every scene on both profiles was `status: "fail"` because the dump XML contained a React Native redbox (`Unable to load script` / `loadScriptFromAssets`), not product UI. This run did **not** re-measure the previous product hit-target findings. Per scene the only clickable nodes were redbox chrome (empty `content-desc`):

- Pixel 4a, all five scenes: `com.hypercolor:id/rn_redbox_dismiss_button` text `DISMISS (ESC)` bounds `[11,2191][529,2323]` (188.4×48.0 dp); `com.hypercolor:id/rn_redbox_reload_button` text `RELOAD (R, R)` bounds `[551,2191][1069,2323]` (188.4×48.0 dp). Hierarchy root bounds `[0,0][1080,2400]`.
- Pixel 8 Pro labeled dumps, all five scenes: same two resource-ids, text `DISMISS (ESC)` bounds `[12,2172][528,2316]` (172.0×48.0 dp) and `RELOAD (R, R)` bounds `[552,2172][1068,2316]` (172.0×48.0 dp). Hierarchy root bounds were also `[0,0][1080,2400]` (same physical size as the 4a dump).

Each scene JSONL row therefore has `fail` length 3: `react-native-redbox` plus two `clickable-a11y` nodes. Product controls on `auth.enable.authorizing`, `stack.thread.populated`, and `tabs.settings.default` were not present in these dumps.

## Contrast (captured PNGs)

Token pairs in `textOnSurfacePairs` remain the source of truth for brand/canvas. Tab inactive tint uses `color.textSecondary` (`#727986` replacement already bound in `MainTabs`). Measured PNG sampling is recorded in `vrt/output/report/a11y-contrast.json` after recapture.

Android/iOS final recapture samples from `scripts/a11y-contrast-from-png.ts`. The sampler read 488 final baseline PNGs with detectable samples, derives text bounds from Android dump XML when available and otherwise discovers bright glyph clusters, then compares actual text pixels against the adjacent local dark background. Critical-scene samples are from Welcome idle, Enable authorizing, Chats populated, Thread populated, and Settings default.

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

Full final recapture is complete: 123 scenes × 4 profiles = 492 PNGs. Integrity is green with `files=246 failures=0 marker_gaps=0` per platform; waivers are limited to `vrt/integrityWaivers.ts`.
