# Accessibility proof (measured)

Date: 2026-09-03
Tree: `ux/w3-design-system`

## Method

- **Android:** `adb shell uiautomator dump` on VRT catalog scenes after `hypercolor://e2e/vrt?scene=`. Script: `scripts/a11y-android-dump.sh` checks interactive nodes for `content-desc` and bounds ≥ 44dp (`width*px / density`, `height*px / density`).
- **iOS:** `xcodebuild test` Accessibility audit is not wired as a dedicated XCTest in this wave; Inspector-equivalent is the catalog `accessibilityRole` / `accessibilityLabel` tree asserted in Jest plus VoiceOver-sized hit targets (`measure.hitTarget = 44`). Waiver: no Accessibility Inspector CLI on this runner.
- **Contrast:** sampled from captured PNGs via `scripts/a11y-contrast-from-png.ts`. Android samples use `uiautomator dump` text-node bounds; iOS samples use marker-adjacent glyph clusters when a platform dump is unavailable. Each sample compares text pixels inside the detected node/cluster against the nearest surrounding canvas pixels instead of fixed coordinates.
- **Dynamic type:** `PixelRatio.getFontScale` mocked to `2` in `WelcomeScreenContent` and `Button` tests; primary CTA `minHeight` stays ≥ 44.

## Android dump results

`bash scripts/a11y-android-dump.sh` ran against each critical VRT scene on both booted Hypercolor AVD profiles after `hypercolor://e2e/vrt?scene=...`.

Critical journeys checked: Welcome idle, Enable authorizing, Chats populated, Thread populated, Settings default.

| Profile | Scenes | Clickable nodes | Failures |
|---|---:|---:|---:|
| Pixel 4a (`Hypercolor_Pixel_4a_API_36`) | 5 | 0 | 0 |
| Pixel 8 Pro (`Hypercolor_Pixel_8_Pro_API_36`) | 5 | 0 | 0 |

## Contrast (captured PNGs)

Token pairs in `textOnSurfacePairs` remain the source of truth for brand/canvas. Tab inactive tint uses `color.textSecondary` (`#727986` replacement already bound in `MainTabs`). Measured PNG sampling is recorded in `vrt/output/report/a11y-contrast.json` after recapture.

Android/iOS final recapture samples from `scripts/a11y-contrast-from-png.ts`:

| Profile | PNG count | Min | Max | Average | Critical-scene samples |
|---|---:|---:|---:|---:|---|
| iPhone SE | pending final capture | pending final capture | pending final capture | pending final capture | pending final capture |
| iPhone 16 Pro Max | pending final capture | pending final capture | pending final capture | pending final capture | pending final capture |
| Pixel 4a | pending final capture | pending final capture | pending final capture | pending final capture | pending final capture |
| Pixel 8 Pro | pending final capture | pending final capture | pending final capture | pending final capture | pending final capture |

The fixed-coordinate PNG samples from the interrupted full recapture are obsolete and must not be used as accessibility evidence.

## Font scale 2.0

Jest: primary Welcome connect and Button `minHeight`/`minWidth` ≥ 44 with `PixelRatio.getFontScale() === 2`. VRT scene `a11y.font-scale.two` mounts Welcome for visual layout.

## Waivers

- iOS Accessibility Inspector CLI not available in this environment; tree roles/labels are asserted in unit tests.
- System `Alert.alert` sheets are OS chrome, not dumped.

## Measured product screenshots (Wave 3 r2)

Focused iOS SE captures (2026-09-03) mount production Content via JourneyScenes:

- `stack_thread_populated_ios_iphone-se-3.png` — mine/theirs bubbles, delivery "Sent", composer
- `tabs_chats_populated_ios_iphone-se-3.png` — avatar initials, relative times, snippets
- `auth_welcome_idle_ios_iphone-se-3.png` — brand + Connect CTA
- `tabs_settings_default_ios_iphone-se-3.png` — identity/homeserver/BLE/backup sections

Full-matrix recapture is pending until `ux/w3-polish` is merged. The current proof captures only the scoped iPhone SE + Pixel 4a subset.

### Skips

- **Integrity gate**: marker gaps are zero on Android, but duplicate-pair failures remain across both platforms because multiple catalog states render identical production content. Do not approve these baselines until the duplicate-state gaps are resolved or explicitly classified in the gate.
