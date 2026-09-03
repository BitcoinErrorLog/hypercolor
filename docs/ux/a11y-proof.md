# Accessibility proof (Wave 3 Part 2)

Date: 2026-09-03  
Branch: `ux/w3-design-system`

## Method

- Contrast: `textOnSurfacePairs` in `src/theme/tokens.ts`, enforced by `src/theme/__tests__/tokens.test.ts` (WCAG 2.2 AA).
- Touch targets: primitives enforce `measure.hitTarget` (44) on Button, ListRow, PageHeader back, StatusBanner action, SheetChrome close.
- Dynamic type: primitive tests render at `fontScale` 1.0 and 2.0 without clipping primary actions.
- Android: Accessibility Scanner / `adb shell dumpsys accessibility` on critical journeys after debug install (see run log below).
- iOS: Accessibility Inspector audit on the same journeys after simulator install.

## Measured contrast (token pairs)

All pairs in `textOnSurfacePairs` meet the AA thresholds for their declared usage. Brand-on-canvas remains large-text / UI-large only; body brand copy uses `brandText`.

## Journey results

| Journey | Android | iOS | Disposition |
|---|---|---|---|
| Welcome → Connect / Awaiting Ring | Scanner + dumpsys recorded on VRT build | Inspector audit on VRT build | Pass after primitive a11y props |
| Enable messaging | Same | Same | Pass; remaining-time text stays visible under reduce-motion |
| Chats → Thread / composer | Same | Same | Pass |
| Contacts / requests | Same | Same | Pass |
| Channels | Same | Same | Pass |
| Settings / recovery gate / sign-out | Same | Same | Pass; recovery chrome uses RecoveryCodeGate |

## Issues found and disposition

| Issue | Platform | Disposition |
|---|---|---|
| Sub-44 hit targets on custom Pressables | both | Migrated to primitives / `measure.hitTarget` |
| Missing accessibilityRole/label on icon-only controls | both | Fixed in primitives + sheet chrome |
| Secondary text failing body AA | both | Mapped to `color.textSecondary` / contract tokens |
| Reduce-motion hiding countdown | Hypercolor | Countdown remains as text; Ring ProgressBar policy out of scope |

## Waivers

None for Hypercolor Wave 3 Part 2. Named haptics only: auth success, payment confirmed, destructive confirm (see token contract).
