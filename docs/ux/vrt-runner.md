# Mobile VRT runner

Status: **infrastructure for Wave 3**. Product screens are not mounted. The only
catalog scene is a token swatch that proves the pipeline. Wiring `*Content`
screens onto this catalog is Part 2 (after the contacts/exposure branches
integrate). That wiring must not happen in `App.tsx` until those branches land.

## Decision: Maestro + pixelmatch, not Owl or Storybook

`docs/ux/a11y-motion-vrt-contract.md` already binds mobile VRT to **Maestro**
plus **pixelmatch/pngjs**. This repo already ships Maestro for the live P7
product flow (`.maestro/p7-product.yaml`). Reusing it avoids a second on-device
driver.

| Option                              | Why not (or why)                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Maestro + pixelmatch** (chosen)   | Already installed conceptually (`test:e2e`). Captures Android emulator and iOS simulator as separate runs. Screenshots are per-platform PNG files. Diff/report are JS-only (`pixelmatch`, `pngjs`) with no native app dependency. Android must use the existing `HC_E2E:` clipboard/file channel — `MainActivity` is `singleTask` and Maestro `openLink` VIEW intents are dropped. |
| react-native-owl                    | Extra native screenshot dependency, overlapping Maestro, not in the a11y contract.                                                                                                                                                                                                                                                                                                 |
| Storybook RN + on-device screenshot | Storybook is absent; adding it would be a second UI runtime beside the catalog navigator the contract specified.                                                                                                                                                                                                                                                                   |

Headless proof (this wave): `npm run vrt:catalog` renders the token swatch with
`@resvg/resvg-js` from the same `textOnSurfacePairs` the React scene uses, diffs
against a Git baseline with pixelmatch, and writes a static HTML report. That is
**not** an Android or iOS screenshot. Do not treat the headless PNG as a
launcher or device baseline.

## Commands

```bash
# Catalog + headless capture + report (no emulator required)
E2E_VRT=1 npm run vrt:catalog

# First time only, write the headless PNG into Git baselines (does not approve)
E2E_VRT=1 npm run vrt:catalog -- --seed-baseline

# On-device (Part 2, after the catalog is mounted behind E2E_VRT=1)
APP_ID=com.hypercolor maestro test .maestro/vrt/generated/
APP_ID=org.name.hypercolor maestro test .maestro/vrt/generated/
```

`vrt:catalog` always regenerates `.maestro/vrt/generated/*.yaml` from the
registry. Those flows wait on `vrtSceneReady` and call `takeScreenshot`. They
will fail until Part 2 mounts the catalog.

## Catalog entry shape

```ts
{
  id: 'design-system.token-swatch.default',
  journey: 'design-system',
  screen: 'token-swatch',
  platform: 'all' | 'android' | 'ios' | 'headless',
  viewport: 'all' | 'android-small' | 'android-large' | 'ios-small' | 'ios-large' | 'headless',
  theme: 'dark',
  state: 'default',
  render: () => ReactElement,  // production presentational components only
  mask: [{ testID, reason }]
}
```

Capture names are immutable once approved:

`journey/screen/state/platform/device.png`

Pinned viewports (a11y contract §D):

- Android small: Pixel 4a, 360×800
- Android large: Pixel 8 Pro, 448×998
- iOS small: iPhone SE (3rd gen), 375×667
- iOS large: iPhone 15 Pro Max, 430×932

Locale `en-US`, timezone UTC, dark appearance, font scale 100% for pixel gates.
A 200% font-scale pass is diagnostic, not pixel-gated.

## Fixtures

`vrt/fixtures/` supplies frozen synthetic identities (valid z32, repeating
non-secret bytes, names like “Aster Example”), a fixed clock
(`2026-09-02T19:00:00.000Z`), and a network guard that throws on `fetch`.
Catalog scenes must not call Ring, KeyStore, homeserver, Nexus, or native
Paykit. Accidental IO fails the scene.

## Masks

Masks are catalog-owned opaque rectangles with a stable `testID`, present in
both baseline and candidate. Allowed reasons: QR, recovery, pubky, timestamp,
unread (unless the scene is testing unread), payment payload, status bar,
secret. Maestro text mutation is not a mask.

## Baselines and named human approval

Approved PNGs live in Git under

`.maestro/vrt/baselines/<journey>/<screen>/<state>/<platform>/<device>.png`

A candidate may **not** overwrite a baseline because CI went green. Promotion
requires:

1. Named human review of the static report (baseline / candidate / overlay).
2. A row in `docs/ux/vrt-baseline-approvals.md` with reviewer name, date,
   capture path, and candidate SHA.
3. The PR label `vrt-baseline-approved` once this repo’s GitHub job exists.

`--seed-baseline` writes a first file so the pipeline can diff; it is **not**
approval. `approvalStatus` in the report stays `pending-named-human` until the
approvals table names a person.

Default gate: pixelmatch `threshold: 0.1`, `includeAA: false`, at most 0.1%
changed pixels, and no dimension mismatch.

## Report

`vrt/output/report/index.html` is a static file. Open it from disk. Images are
copied into `report/assets/` so the folder zips. Grouping is journey → platform
→ viewport → state. Each card shows baseline, candidate, overlay, changed-pixel
count, masks, and SHAs in the header.

### The report must never contain

- Real pubkys, names, messages, contacts, group names
- Recovery codes or BIP-39 material (even fixtures, if a scene rendered them
  unmasked)
- Auth URLs, `pubkyauth` / `paykit-connect` query strings, session tokens
- Invoices, payment URIs, attachment bytes
- Production homeserver account data

`vrt/privacy/scan.ts` walks the report for `pk:`, 52-character z32 outside the
synthetic allowlist, invoice-like payloads, and credential headers. A hit fails
the run. Public hosting of a report still needs explicit user approval.

## Production gate

`assertCatalogAllowed()` throws unless `E2E_VRT=1` or `NODE_ENV=test`. Do not
import `vrt/catalog.ts` from `App.tsx` in a production path. Part 2 must keep
the catalog behind `__DEV__` and `E2E_VRT=1` so Metro can tree-shake it out of
release builds.
