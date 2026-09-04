# Hypercolor design token contract

Status: **OWNER-APPROVED 2026-09-02 by John Carvalho — Part 2 migration authorized**. This is the
mapping from the as-implemented literals in `docs/ux/design-tokens-current.md`
to `src/theme/tokens.ts`. Identity rule: premium cohesive evolution of the
current dark-violet Hypercolor — black canvas, violet brand, hairline surfaces,
12 px product radius. Not a rebrand. No Ring-like mark, no messenger-bubble
chrome.

Module: `src/theme/tokens.ts` (pure TS, frozen, tree-shakeable). Entry:
`src/theme/index.ts`.

## How to read this

- **map** — keep the visual role; call the named token.
- **delete** — stop using the literal. The replacement token is listed; the
  reason is contrast, grid, or consolidation.
- Hex is documented in lowercase 3- or 6-digit form as it appears in source.
  The TypeScript module stores 6-digit uppercase (`#0A0A0A`).

Part 2 may not introduce a new raw brand/style value that is not in this
contract. Unexplained literals fail the token audit.

## Wave 3 Addendum — 2026-09-03

The owner-approved token contract keeps the existing token names but corrects the
text ladder exposed by production VRT captures:

- `color.textSecondary` now maps to `#9CA3AF`, measured at 7.80:1 on `canvas`.
- `color.textMuted` now maps to `#808692`, measured at 5.41:1 on `canvas`.
- `color.onBrandMuted` is added as `#EFE6FD`, measured at 4.72:1 on `brand`, for outgoing-bubble metadata. `rgba(255,255,255,0.7)` over `brand` remains rejected at 3.60:1 for body text.
- `color.brandText` is the only brand text token for small body/meta text on `canvas`; unread list metadata uses it instead of `color.brand`.
- `color.onDanger`, `color.dangerSurface`, and `color.dangerSurfacePressed` define the filled destructive button states and are covered by `textOnSurfacePairs`.

---

## Color

| Token                        | Value                     | Role                                       | Rationale                                                                                                                                               |
| ---------------------------- | ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color.canvas`               | `#0A0A0A`                 | Screen background                          | Existing identity.                                                                                                                                      |
| `color.surface`              | `#111111`                 | Modals, cards, raised panels               | Unifies `#111` / `#111111`.                                                                                                                             |
| `color.surfaceRaised`        | `#1A1A1A`                 | Inputs, composer, tab fill                 | Same value as the hairline; used as a fill.                                                                                                             |
| `color.surfaceBrand`         | `#1F1B2E`                 | Brand-tinted card (Enable CTA)             | Keep the existing tinted well.                                                                                                                          |
| `color.bubbleIncoming`       | `#1F1F1F`                 | Received message bubble                    | Existing incoming fill.                                                                                                                                 |
| `color.well`                 | `#1F2937`                 | Avatar fallback, QR frame fallback         | Existing inset gray.                                                                                                                                    |
| `color.hairline`             | `#1A1A1A`                 | Default divider                            | Identity hairline. Decorative on canvas (not a text color).                                                                                             |
| `color.hairlineStrong`       | `#374151`                 | Visible border, input outline              | Existing stronger border.                                                                                                                               |
| `color.brand`                | `#7C3AED`                 | Fill, spinner, active tab, outgoing bubble | Identity accent. **UI/large only** as text on canvas (3.47:1).                                                                                          |
| `color.brandDeep`            | `#4C1D95`                 | Pressed / selected fill                    | Existing toggle-on. Fill only, never text (1.81:1).                                                                                                     |
| `color.brandMuted`           | `#C4B5FD`                 | Icons, chevrons, recovery emphasis         | Existing lavender; body-safe on canvas (10.72:1).                                                                                                       |
| `color.brandSoft`            | `#A78BFA`                 | Secondary brand text                       | Existing CTA hint (7.27:1).                                                                                                                             |
| `color.brandText`            | `#8F57F0`                 | Small brand text on canvas                 | a11y replacement so brand-colored body copy hits 4.5:1.                                                                                                 |
| `color.brandHighlight`       | `#E9D5FF`                 | Rare highlight (was tip bar)               | Existing `#e9d5ff`.                                                                                                                                     |
| `color.textPrimary`          | `#F9FAFB`                 | Primary copy                               | Existing.                                                                                                                                               |
| `color.textSecondary`        | `#9CA3AF`                 | Secondary copy, labels, inactive tab       | Wave 3 addendum: corrected ladder value; measured 7.80:1 on `canvas`, above muted.                                                                      |
| `color.textMuted`            | `#808692`                 | Timestamps, footer/meta copy               | Wave 3 addendum: corrected ladder value; measured 5.41:1 on `canvas`, still body-safe.                                                                  |
| `color.textOnBrand`          | `#FFFFFF`                 | Label on brand fill                        | Existing; 5.70:1.                                                                                                                                       |
| `color.onBrandMuted`         | `#EFE6FD`                 | Outgoing-bubble metadata on brand          | Wave 3 addendum: measured 4.72:1 on `brand`; replaces opacity-dimmed white for body metadata.                                                           |
| `color.textOnBrandMuted`     | `rgba(255,255,255,0.843)` | Body metadata on brand                     | 4.50:1. Replaces 70–80% white used as body.                                                                                                             |
| `color.textOnBrandUi`        | `rgba(255,255,255,0.6)`   | Large/bold chrome on brand                 | 3.01:1 UI/large. Never body.                                                                                                                            |
| `color.onDanger`             | `#0A0A0A`                 | Label on destructive fill                  | Wave 3 addendum: measured 5.26:1 on `dangerSurface` and 7.16:1 on `dangerSurfacePressed`.                                                               |
| `color.dangerSurface`        | `#EF4444`                 | Destructive control fill                   | Wave 3 addendum: body-safe filled destructive surface.                                                                                                  |
| `color.dangerSurfacePressed` | `#F87171`                 | Pressed destructive control fill           | Wave 3 addendum: body-safe pressed destructive surface.                                                                                                 |
| `color.danger`               | `#FCA5A5`                 | Error copy, failed send                    | Existing; pair with an icon, never color-only.                                                                                                          |
| `color.dangerStrong`         | `#EF4444`                 | Destructive control fill / strong error    | Existing disconnect red. Body-safe on canvas; not on brand.                                                                                             |
| `color.warning`              | `#F59E0B`                 | Warning copy                               | Existing.                                                                                                                                               |
| `color.warningStrong`        | `#FBBF24`                 | Strong warning on canvas                   | Existing payment warning.                                                                                                                               |
| `color.success`              | `#86EFAC`                 | Success copy                               | Existing.                                                                                                                                               |
| `color.overlay`              | `rgba(0,0,0,0.6)`         | Modal backdrop                             | Existing.                                                                                                                                               |
| `color.overlayDeep`          | `rgba(0,0,0,0.72)`        | Destructive confirmation backdrop          | Wave 3 addendum: deepens sign-out backdrop so underlying content no longer competes.                                                                    |
| `color.overlaySoft`          | `rgba(0,0,0,0.25)`        | Input wash                                 | Existing.                                                                                                                                               |
| `color.overlayOnBrand`       | `rgba(255,255,255,0.18)`  | Decorative on-brand border                 | Not text.                                                                                                                                               |
| `color.overlayOnBrandFaint`  | `rgba(255,255,255,0.12)`  | Decorative on-brand fill                   | Not text.                                                                                                                                               |
| `color.chipWarning`          | `rgba(250,204,21,0.2)`    | Pending chip wash                          | Existing. Chip also has a text label.                                                                                                                   |
| `color.chipSuccess`          | `rgba(74,222,128,0.2)`    | Ok chip wash                               | Existing.                                                                                                                                               |
| `color.chipDanger`           | `rgba(248,113,113,0.2)`   | Bad chip wash                              | Existing.                                                                                                                                               |
| `color.qrQuietZone`          | `#FFFFFF`                 | QR pad                                     | Required for scan contrast.                                                                                                                             |
| `color.qrModules`            | `#000000`                 | QR modules                                 | 21:1 on the pad.                                                                                                                                        |
| `color.nativeSplash`         | `#FFFFFF`                 | Android `splashscreen_background`          | Documented mismatch with in-app canvas. Do not use in JS screens. Changing the native splash is a later native-polish task, not Part 2 token migration. |

`textOnSurfacePairs` in `tokens.ts` is the allowed text-on-surface matrix. Tests
compute WCAG 2.2 contrast for every row.

---

## Spacing

4 pt grid. Header gutter stays 20 (`space.xl`).

| Token        | Value | Use                               |
| ------------ | ----: | --------------------------------- |
| `space.none` |     0 | Reset                             |
| `space.xs`   |     4 | Tight inset                       |
| `space.sm`   |     8 | Default inner padding             |
| `space.md`   |    12 | Composer, list row inset          |
| `space.lg`   |    16 | Section padding, header vertical  |
| `space.xl`   |    20 | Page gutter (`paddingHorizontal`) |
| `space.xxl`  |    24 | Section gaps                      |
| `space.xxxl` |    32 | Empty-state outer                 |

`measure.hitTarget` is 44. Visual glyphs may be smaller inside that target.
`measure.authQr` is 220 (was `AUTH_QR_SIZE_PT`). `measure.hairlineWidth` is 1
(prefer `StyleSheet.hairlineWidth` at the call site when drawing a physical
hairline on a given screen).

---

## Radius

| Token               | Value | Use                                           |
| ------------------- | ----: | --------------------------------------------- |
| `radius.sm`         |     8 | Dense rows                                    |
| `radius.md`         |    12 | **Product radius** — buttons, cards, QR frame |
| `radius.lg`         |    16 | Bubbles, sheet top                            |
| `radius.xl`         |    20 | Composer pill                                 |
| `radius.xxl`        |    24 | List avatars                                  |
| `radius.full`       |   999 | Chips, circular avatars                       |
| `radius.bubbleTail` |     4 | Bubble inner corner                           |

---

## Typography

Unscaled sizes. React Native `Text` already applies the system `fontScale`.
Do **not** pre-multiply `typeRole.*.fontSize` into `Text` styles. Use
`typeLayoutSize(role, fontScale)` only to grow containers so 200% Dynamic Type
does not clip the primary CTA. `fontScaling.allowFontScaling` is `true`.
`maxFontSizeMultiplier` is unset on primary content.

| Token                 | Size / line / weight       | Use                              |
| --------------------- | -------------------------- | -------------------------------- |
| `typeRole.display`    | 32 / 40 / 600              | Wordmark, large avatar letter    |
| `typeRole.title`      | 24 / 32 / 600              | Tab titles                       |
| `typeRole.heading`    | 20 / 28 / 600              | Screen headings                  |
| `typeRole.titleStack` | 17 / 24 / 600              | Stack titles                     |
| `typeRole.body`       | 16 / 24 / 400              | Buttons, body                    |
| `typeRole.bodyStrong` | 16 / 24 / 600              | Emphasized body                  |
| `typeRole.numeric`    | 18 / 24 / 600              | Payment amounts                  |
| `typeRole.callout`    | 15 / 22 / 400              | Bubbles, hints                   |
| `typeRole.secondary`  | 14 / 20 / 400              | Secondary copy                   |
| `typeRole.caption`    | 13 / 18 / 400              | Settings hints                   |
| `typeRole.mono`       | 13 / 18 / 400, `monospace` | Keys, URLs, recovery code        |
| `typeRole.label`      | 12 / 16 / 600              | Caps labels, chips               |
| `typeRole.meta`       | 12 / 16 / 400              | Timestamps, badges (12 px floor) |

`fontFamily.mono` is `'monospace'`. UI type uses the platform default (no family token). `maxFontSizeMultiplier` stays unset on primary content.

---

## Icon size

| Token         | Value | Use                                    |
| ------------- | ----: | -------------------------------------- |
| `iconSize.sm` |    16 | Inline                                 |
| `iconSize.md` |    20 | List trailing                          |
| `iconSize.lg` |    24 | Tab icons                              |
| `iconSize.xl` |    28 | Header `+` glyph inside a 44 pt target |

---

## Motion

From `docs/ux/a11y-motion-vrt-contract.md` §C. Reduced motion maps every
duration to `durationMs.instant` (0). Sheets fade rather than slide. Stack
pushes fade rather than `slide_from_right`. `scrollToEnd` is not animated.

| Token                    | Value                      |
| ------------------------ | -------------------------- |
| `durationMs.instant`     | 0                          |
| `durationMs.sheet`       | 150                        |
| `durationMs.short`       | 200                        |
| `durationMs.navigation`  | 250                        |
| `easing.enter`           | `[0.2, 0.8, 0.2, 1]`       |
| `easing.exit`            | `[0.4, 0, 1, 1]`           |
| `easingCss.enter`        | `cubic-bezier(.2,.8,.2,1)` |
| `easingCss.exit`         | `cubic-bezier(.4,0,1,1)`   |
| `easing.platformEaseOut` | `ease-out`                 |

Helpers: `durationFor(name, reducedMotion)`, `modalAnimationType`,
`stackAnimation`, `scrollAnimated`.

No bounce, spring overshoot, auto-scrolling carousel, animated gradient, or
flashing state.

---

## Haptics

Event names only. The policy wrapper and in-app switch ship with `expo-haptics`
in a later pass (a11y contract §C). Direct component imports of a haptic API
are forbidden.

| `hapticEvent`   | `hapticStyle` | When                                     |
| --------------- | ------------- | ---------------------------------------- |
| `sendAccepted`  | `light`       | Message accepted for send — not delivery |
| `walletHandoff` | `medium`      | User confirmed Open wallet               |
| `authCompleted` | `success`     | Connect or Enable actually completed     |

No haptic for typing, scrolling, navigation, polling, incoming-message render,
validation error, or retry.

---

## Raw value mapping

Every unique hex and rgba in `docs/ux/design-tokens-current.md` is listed.
Action is **map** or **delete**.

### Hex

| Raw value | Token                                     | Action                                                                                      |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `#7c3aed` | `color.brand`                             | map                                                                                         |
| `#f9fafb` | `color.textPrimary`                       | map                                                                                         |
| `#fff`    | `color.textOnBrand` / `color.qrQuietZone` | map — same white, two roles                                                                 |
| `#ffffff` | `color.textOnBrand` / `color.qrQuietZone` | map                                                                                         |
| `#FFFFFF` | `color.nativeSplash`                      | map — Android splash only, not in-app canvas                                                |
| `#6b7280` | `color.textSecondary`                     | delete — 4.10:1 on canvas, fails body AA; replacement `#808692`                             |
| `#4b5563` | `color.textSecondary`                     | delete — 2.62:1 on canvas; placeholders use the secondary token                             |
| `#1a1a1a` | `color.hairline` / `color.surfaceRaised`  | map — border vs fill share the value                                                        |
| `#0a0a0a` | `color.canvas`                            | map                                                                                         |
| `#c4b5fd` | `color.brandMuted`                        | map                                                                                         |
| `#9ca3af` | `color.textMuted`                         | map                                                                                         |
| `#374151` | `color.hairlineStrong`                    | map                                                                                         |
| `#fca5a5` | `color.danger`                            | map                                                                                         |
| `#1f2937` | `color.well`                              | map                                                                                         |
| `#86efac` | `color.success`                           | map                                                                                         |
| `#1f1f1f` | `color.bubbleIncoming`                    | map                                                                                         |
| `#111`    | `color.surface`                           | map                                                                                         |
| `#111111` | `color.surface`                           | map                                                                                         |
| `#a78bfa` | `color.brandSoft`                         | map                                                                                         |
| `#f59e0b` | `color.warning`                           | map                                                                                         |
| `#ef4444` | `color.dangerStrong`                      | map                                                                                         |
| `#e9d5ff` | `color.brandHighlight`                    | map                                                                                         |
| `#141414` | `color.surface`                           | delete — one-off tip-bar fill between canvas and raised; unify to `surface`                 |
| `#fbbf24` | `color.warningStrong`                     | map                                                                                         |
| `#1f1b2e` | `color.surfaceBrand`                      | map                                                                                         |
| `#4c1d95` | `color.brandDeep`                         | map — fill only                                                                             |
| `#e5e7eb` | `color.textPrimary`                       | delete — near-white ChannelScreen chrome; use primary text                                  |
| `#f87171` | `color.danger`                            | delete — red-400 on canvas is fine but redundant with `danger`; **never** on brand (2.06:1) |
| `#d1d5db` | `color.textMuted`                         | delete — decline label; muted is the secondary-on-canvas token                              |
| `#111827` | `color.well`                              | delete — QR fallback duplicate of the gray-800 well                                         |

### rgba

| Raw value                                                     | Token                       | Action                                                                 |
| ------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `rgba(0,0,0,0.6)`                                             | `color.overlay`             | map                                                                    |
| `rgba(0,0,0,0.72)`                                            | `color.overlayDeep`         | map — destructive confirmation backdrop                                |
| `rgba(0,0,0,0.25)`                                            | `color.overlaySoft`         | map                                                                    |
| `rgba(255,255,255,0.7\|0.8\|0.6\|0.55\|0.5\|0.4\|0.18\|0.12)` | see alphas below            | split — the source wrote this as one scan hit                          |
| `rgba(255,255,255,0.8)`                                       | `color.textOnBrandMuted`    | delete — 4.22:1 fails body; use 84.3% white                            |
| `rgba(255,255,255,0.7)`                                       | `color.textOnBrandUi`       | delete as body — 3.58:1 is UI/large only; body uses `textOnBrandMuted` |
| `rgba(255,255,255,0.6)`                                       | `color.textOnBrandUi`       | map — UI/large only                                                    |
| `rgba(255,255,255,0.55)`                                      | `color.textOnBrandUi`       | delete — 2.76:1 fails UI/large                                         |
| `rgba(255,255,255,0.5)`                                       | `color.textOnBrandUi`       | delete — 2.54:1                                                        |
| `rgba(255,255,255,0.4)`                                       | `color.textOnBrandUi`       | delete — 2.10:1                                                        |
| `rgba(255,255,255,0.18)`                                      | `color.overlayOnBrand`      | map — decorative only                                                  |
| `rgba(255,255,255,0.12)`                                      | `color.overlayOnBrandFaint` | map — decorative only                                                  |
| `rgba(250,204,21,0.2)`                                        | `color.chipWarning`         | map                                                                    |
| `rgba(74,222,128,0.2)`                                        | `color.chipSuccess`         | map                                                                    |
| `rgba(248,113,113,0.2)`                                       | `color.chipDanger`          | map                                                                    |

The source scan records the on-bubble alphas as one string,
`rgba(255,255,255,0.7|0.8|0.6|0.55|0.5|0.4|0.18|0.12)`;
each alpha is listed above.

### Font size

| Raw px | Token                                | Action                                                         |
| ------ | ------------------------------------ | -------------------------------------------------------------- |
| `40`   | `typeRole.display` (32)              | delete — Welcome logo at 40 clips at 200% scale; display is 32 |
| `32`   | `typeRole.display`                   | map                                                            |
| `28`   | `iconSize.xl`                        | map — header plus glyph, not type                              |
| `24`   | `typeRole.title`                     | map                                                            |
| `22`   | `typeRole.heading` (20)              | delete — merge into heading                                    |
| `20`   | `typeRole.heading`                   | map                                                            |
| `18`   | `typeRole.numeric`                   | map                                                            |
| `17`   | `typeRole.titleStack`                | map                                                            |
| `16`   | `typeRole.body` / `bodyStrong`       | map                                                            |
| `15`   | `typeRole.callout`                   | map                                                            |
| `14`   | `typeRole.secondary`                 | map                                                            |
| `13`   | `typeRole.caption` / `typeRole.mono` | map                                                            |
| `12`   | `typeRole.label` / `typeRole.meta`   | map                                                            |
| `11`   | `typeRole.meta` (12)                 | delete — a11y floor 12 px for metadata                         |
| `10`   | `typeRole.meta` (12)                 | delete — same floor                                            |

### Radius

| Raw                             | Token               | Action                                                  |
| ------------------------------- | ------------------- | ------------------------------------------------------- |
| `10`                            | `radius.md` (12)    | delete — off the product radius                         |
| `12`                            | `radius.md`         | map                                                     |
| `20`                            | `radius.xl`         | map                                                     |
| `16`                            | `radius.lg`         | map                                                     |
| `24`                            | `radius.xxl`        | map                                                     |
| `999`                           | `radius.full`       | map                                                     |
| `8`                             | `radius.sm`         | map                                                     |
| `40`                            | `radius.full`       | delete — profile avatar is circular, not a 40 px corner |
| `6`                             | `radius.sm` (8)     | delete — off the 4 pt grid                              |
| `4` (`borderBottomRightRadius`) | `radius.bubbleTail` | map                                                     |
| `AUTH_QR_SIZE_PT = 220`         | `measure.authQr`    | map                                                     |

### Spacing

| Raw  | Token           | Action                                                             |
| ---- | --------------- | ------------------------------------------------------------------ |
| `8`  | `space.sm`      | map                                                                |
| `16` | `space.lg`      | map                                                                |
| `20` | `space.xl`      | map                                                                |
| `12` | `space.md`      | map                                                                |
| `14` | `space.lg` (16) | delete — header vertical joins the 16 pt step                      |
| `10` | `space.md` (12) | delete — off the 4 pt grid                                         |
| `4`  | `space.xs`      | map                                                                |
| `6`  | `space.sm` (8)  | delete — chips get 44 pt via `measure.hitTarget`, not 6 pt padding |
| `32` | `space.xxxl`    | map                                                                |

---

## Counts (this revision)

| Set                                |                                                                     Count |
| ---------------------------------- | ------------------------------------------------------------------------: |
| Semantic color tokens              |                                                                        38 |
| Spacing tokens                     |                                                                         8 |
| Radius tokens                      |                                                                         7 |
| Type roles                         |                                                                        13 |
| Icon sizes                         |                                                                         4 |
| Measure tokens                     |                                                                         3 |
| Motion durations                   |                                                                         4 |
| Easing tokens                      |                                            5 (`easing` 3 + `easingCss` 2) |
| Haptic events                      |                                                                         3 |
| Text-on-surface pairs under test   |                                                                        30 |
| Raw hex rows in the mapping table  |                                                                        31 |
| Raw rgba rows in the mapping table |                                                                        13 |
| Raw hex mapped (not delete)        |                                                                        24 |
| Raw hex deleted                    | 7 (`#6b7280` `#4b5563` `#141414` `#e5e7eb` `#f87171` `#d1d5db` `#111827`) |
| Raw rgba mapped                    |                                   8 (including the split alphas that map) |
| Raw rgba deleted                   |                                      5 (0.8, 0.7 as body, 0.55, 0.5, 0.4) |

Owner approval of this file is the gate for Part 2 (migrating screens onto
these tokens). Until then, existing screens keep their literals.
