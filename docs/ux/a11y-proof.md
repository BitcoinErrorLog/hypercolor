# Accessibility proof (Wave 3 Part 2)

Date: 2026-09-03
Build: `ux/w3-design-system` after integrated-flow merge + design-system migration

## Method

- Android: `adb shell dumpsys accessibility` plus Accessibility Scanner on critical journeys (Welcome → Connect → Enable → Chats → Thread → Contacts → Channels → Settings).
- iOS: Accessibility Inspector audit via Simulator on the same journeys.
- Contrast: values from `src/theme/tokens.ts` `textOnSurfacePairs` (jest-covered WCAG 2.2 AA).

## Measured contrast (token pairs)

All `textOnSurfacePairs` meet WCAG 2.2 AA thresholds enforced by `src/theme/__tests__/tokens.test.ts`. Brand-on-canvas remains **ui-large only**; small brand text uses `brandText`.

## Issues found and disposition

| Issue | Platform | Disposition |
|---|---|---|
| Pre-migration unlabeled controls / sub-44 targets | both | Fixed by primitives (44×44 min, role/label/state) and screen token migration |
| Secondary text `#6b7280` / `#4b5563` failing body AA | both | Replaced by `color.textSecondary` (`#808692`) per token contract |
| On-brand white at 70–80% failing body AA | both | Replaced by `textOnBrandMuted` (84.3%) |

## Waivers

None. Time-critical countdown readability under reduced motion: remaining-time text remains visible (Ring ProgressBar policy is out of scope; Hypercolor shows countdown text).
