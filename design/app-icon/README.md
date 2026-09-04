# Hypercolor app icon

Master: `design/app-icon/hypercolor-icon-master.svg`

The mark is a **faceted violet crystal** on the existing `#0A0A0A` canvas. It
evolves the in-app identity (black field, `#7C3AED` brand, lavender edge) into a
silhouette that still reads at 48 px and does not rely on letterforms.

## Concept

Hypercolor is a dark, operational messenger whose colour is a cut of violet, not
a wash of purple UI chrome. The crystal is that cut: one shard, three facets
(brand `#7C3AED`, soft `#A78BFA`, highlight `#E9D5FF` / `#C4B5FD`), rotated eight
degrees so the outline is a hexagon rather than a square, a circle, or a chat
bubble. The lavender stroke exists so the silhouette holds on a dark launcher
when the inner facets merge at small sizes. Every facet used as fill meets 3:1
against the canvas.

Nothing in the drawing is a ring, an orbit, a speech bubble, a lightning bolt,
or an “H”.

## Alternates considered

All three live in `design/app-icon/alternates/` at 256 px so they can be judged
next to the master.

### A — Folded ribbon (`alt-folded-ribbon.svg`)

A three-segment violet strip, folded once. At 256 px it feels like fabric or a
Möbius. At 48 px it collapses into a zigzag that reads as a generic “activity”
glyph and, from some angles, as a send-arrow. Rejected.

### B — Hex frame (`alt-hex-frame.svg`)

A hollow hexagon with a solid inner hex. Clean, and on-brand in colour, but the
hollow frame is a ring by another name — too close to Pubky Ring, which this
product must not resemble. Rejected.

### C — Split plane (`alt-split-plane.svg`)

Two overlapping rounded squares, one rotated. It looks like a layer stack or a
file icon, which is how several mainstream utilities (and some messengers)
signal “app”. The silhouette is a rounded square inside a rounded square, so
launcher masks erase what made it distinct. Rejected.

The crystal won because the outline stays a pointed hex after circle, squircle,
and iOS continuous-corner masks; the inner facets keep it from looking like
Ethereum’s regular hex; and the colour story is the same as the screen tokens.

## Production pipeline

Do not hand-place PNGs. From the repo root:

```bash
node scripts/generate-app-icons.mjs
```

The script reads the master SVG and writes:

- Android adaptive layers (`mipmap-anydpi-v26`, foreground at every density,
  monochrome vector, `hypercolor_icon_background`)
- Legacy `ic_launcher` / `ic_launcher_round` at mdpi–xxxhdpi
- iOS AppIcon (iPhone 20/29/40/60 pt at 2x/3x, 1024 marketing with no alpha,
  plus dark and tinted 1024)
- Masked previews on light and dark launcher fields under `previews/`

It fails if the silhouette leaves the Android 66% safe zone, if a launcher mask
clips mark pixels, if foreground/background contrast is below 3:1, if the 1024
marketing image has alpha, or if the monochrome layer is not a single white
silhouette.

Derived SVGs (`hypercolor-icon-foreground.svg`, `hypercolor-icon-monochrome.svg`)
are produced from the master so adaptive and tinted assets cannot drift.
