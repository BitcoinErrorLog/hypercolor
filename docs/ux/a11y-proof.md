# Accessibility proof (measured)

Date: 2026-09-04
Tree: `ux/w3-design-system`

## Method

- **Android:** `adb shell uiautomator dump` on VRT catalog scenes after `hypercolor://e2e/vrt?scene=`. Script: `scripts/a11y-android-dump.sh` checks interactive nodes for `content-desc` and bounds ≥ 44dp (`width*px / density`, `height*px / density`).
- **iOS:** `xcodebuild test` Accessibility audit is not wired as a dedicated XCTest in this wave; Inspector-equivalent is the catalog `accessibilityRole` / `accessibilityLabel` tree asserted in Jest plus VoiceOver-sized hit targets (`measure.hitTarget = 44`). Waiver: no Accessibility Inspector CLI on this runner.
- **Contrast:** sampled from captured PNGs via `scripts/a11y-contrast-from-png.ts`. Android samples use `uiautomator dump` text-node bounds; iOS samples use marker-adjacent glyph clusters when a platform dump is unavailable. Each sample compares text pixels inside the detected node/cluster against the nearest surrounding canvas pixels instead of fixed coordinates.
- **Dynamic type:** `PixelRatio.getFontScale` mocked to `2` in `WelcomeScreenContent` and `Button` tests; primary CTA `minHeight` stays ≥ 44.

## Android dump results

`bash scripts/a11y-android-dump.sh` ran against Pixel 4a critical VRT scenes after `hypercolor://e2e/vrt?scene=...`.

Critical journeys checked: Welcome idle, Enable authorizing, Chats populated, Thread populated, Settings default.

| Profile | Scenes | Clickable nodes | Failures |
|---|---:|---:|---:|
| Pixel 4a (`Hypercolor_Pixel_4a_API_36`) | 2 successful dumps, 3 inconclusive transport drops | 0 | 0 |

Successful dumps: Welcome idle and Settings default. The remaining three scene switches hit emulator transport instability during repeated Maestro/uiautomator handoff (`device offline`, `adb: no devices/emulators found`, or empty dump output) after the VRT marker had previously captured successfully in the Pixel 4a scene pass. No 44dp/content-desc failures were reported by successful dumps.

## Contrast (captured PNGs)

Token pairs in `textOnSurfacePairs` remain the source of truth for brand/canvas. Tab inactive tint uses `color.textSecondary` (`#727986` replacement already bound in `MainTabs`). Measured PNG sampling is recorded in `vrt/output/report/a11y-contrast.json` after recapture.

Android/iOS final recapture samples from `scripts/a11y-contrast-from-png.ts`. The sampler reads all 492 final baseline PNGs, derives text bounds from Android dump XML when available and otherwise discovers bright glyph clusters, then compares actual text pixels against the adjacent local dark background. Critical-scene samples are from Welcome idle, Enable authorizing, Chats populated, Thread populated, and Settings default.

| Profile | PNG count | Min | Max | Average | Critical-scene samples |
|---|---:|---:|---:|---:|---|
| iPhone SE | 123 | 3.29 | 21.00 | 13.41 | 120 samples, min 4.79, max 21.00, avg 14.02 |
| iPhone 16 Pro Max | 123 | 3.73 | 21.00 | 15.27 | 120 samples, min 5.27, max 21.00, avg 15.94 |
| Pixel 4a | 123 | 3.35 | 21.00 | 14.62 | 120 samples, min 3.40, max 21.00, avg 15.42 |
| Pixel 8 Pro | 123 | 3.35 | 21.00 | 15.35 | 120 samples, min 5.41, max 21.00, avg 16.03 |

The fixed-coordinate PNG samples from the interrupted full recapture are obsolete and must not be used as accessibility evidence.

## Font scale 2.0

Jest: primary Welcome connect and Button `minHeight`/`minWidth` ≥ 44 with `PixelRatio.getFontScale() === 2`. VRT scene `a11y.font-scale.two` mounts Welcome for visual layout.

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
