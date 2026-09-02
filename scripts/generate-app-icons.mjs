#!/usr/bin/env node
/**
 * Render Hypercolor launcher icons from design/app-icon/hypercolor-icon-master.svg.
 *
 * Usage (from repo root):
 *   node scripts/generate-app-icons.mjs
 *
 * Requires @resvg/resvg-js and pngjs (devDependencies). Does not hand-place PNGs.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_PATH = path.join(ROOT, 'design/app-icon/hypercolor-icon-master.svg');
const PREVIEW_DIR = path.join(ROOT, 'design/app-icon/previews');
const ANDROID_RES = path.join(ROOT, 'android/app/src/main/res');
const IOS_APPICON = path.join(ROOT, 'ios/hypercolor/Images.xcassets/AppIcon.appiconset');

const CANVAS = { r: 10, g: 10, b: 10, hex: '#0A0A0A' };
const BRAND = { r: 124, g: 58, b: 237, hex: '#7C3AED' };

const ANDROID_DENSITIES = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

const IOS_SLOTS = [
  { idiom: 'iphone', size: '20x20', scale: '2x', px: 40, filename: 'icon-20@2x.png' },
  { idiom: 'iphone', size: '20x20', scale: '3x', px: 60, filename: 'icon-20@3x.png' },
  { idiom: 'iphone', size: '29x29', scale: '2x', px: 58, filename: 'icon-29@2x.png' },
  { idiom: 'iphone', size: '29x29', scale: '3x', px: 87, filename: 'icon-29@3x.png' },
  { idiom: 'iphone', size: '40x40', scale: '2x', px: 80, filename: 'icon-40@2x.png' },
  { idiom: 'iphone', size: '40x40', scale: '3x', px: 120, filename: 'icon-40@3x.png' },
  { idiom: 'iphone', size: '60x60', scale: '2x', px: 120, filename: 'icon-60@2x.png' },
  { idiom: 'iphone', size: '60x60', scale: '3x', px: 180, filename: 'icon-60@3x.png' },
];

const LIGHT_LAUNCHER = { r: 242, g: 242, b: 247 };
const DARK_LAUNCHER = { r: 28, g: 28, b: 30 };

function srgbToLin(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(r, g, b) {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

function contrastRgb(a, b) {
  const l1 = luminance(a.r, a.g, a.b);
  const l2 = luminance(b.r, b.g, b.b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function renderSvg(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: undefined,
  });
  return PNG.sync.read(resvg.render().asPng());
}

function clonePng(src) {
  const out = new PNG({ width: src.width, height: src.height });
  src.data.copy(out.data);
  return out;
}

function flattenOnto(src, bg) {
  const out = clonePng(src);
  for (let i = 0; i < out.data.length; i += 4) {
    const a = out.data[i + 3] / 255;
    if (a === 1) continue;
    out.data[i] = Math.round(out.data[i] * a + bg.r * (1 - a));
    out.data[i + 1] = Math.round(out.data[i + 1] * a + bg.g * (1 - a));
    out.data[i + 2] = Math.round(out.data[i + 2] * a + bg.b * (1 - a));
    out.data[i + 3] = 255;
  }
  return out;
}

function assertOpaque(png, label) {
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] !== 255) {
      throw new Error(`${label} has alpha (byte ${i}=${png.data[i]})`);
    }
  }
}

function isCanvasPixel(r, g, b, a) {
  if (a < 8) return true;
  const dist = Math.abs(r - CANVAS.r) + Math.abs(g - CANVAS.g) + Math.abs(b - CANVAS.b);
  return dist < 12;
}

function markBounds(png) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      const a = png.data[i + 3];
      if (a < 12 || isCanvasPixel(r, g, b, a)) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) {
    throw new Error('Mark is empty — silhouette did not render');
  }
  return { minX, minY, maxX, maxY, count };
}

function uniqueOpaqueColors(png) {
  const colors = new Set();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 12) continue;
    colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
  }
  return colors;
}

function dominantNonCanvas(png) {
  const counts = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a < 12 || isCanvasPixel(r, g, b, a)) continue;
    const key = `${r},${g},${b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  if (!best) throw new Error('No foreground pixels');
  const [r, g, b] = best.split(',').map(Number);
  return { r, g, b };
}

function insideCircle(x, y, size) {
  const c = (size - 1) / 2;
  const r = size / 2;
  const dx = x - c;
  const dy = y - c;
  return dx * dx + dy * dy <= r * r;
}

function insideRoundedRect(x, y, size, radiusRatio) {
  const radius = size * radiusRatio;
  const nx = Math.min(x, size - 1 - x);
  const ny = Math.min(y, size - 1 - y);
  if (nx >= radius || ny >= radius) return true;
  const dx = radius - nx;
  const dy = radius - ny;
  return dx * dx + dy * dy <= radius * radius;
}

function insideSuperellipse(x, y, size, p) {
  const c = (size - 1) / 2;
  const rx = size / 2;
  const ry = size / 2;
  const dx = Math.abs(x - c) / rx;
  const dy = Math.abs(y - c) / ry;
  return dx ** p + dy ** p <= 1;
}

function applyMask(icon, size, pred, launcher) {
  const out = new PNG({ width: size, height: size });
  const scale = icon.width / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (size * y + x) << 2;
      if (!pred(x, y, size)) {
        out.data[i] = launcher.r;
        out.data[i + 1] = launcher.g;
        out.data[i + 2] = launcher.b;
        out.data[i + 3] = 255;
        continue;
      }
      const sx = Math.min(icon.width - 1, Math.round(x * scale));
      const sy = Math.min(icon.height - 1, Math.round(y * scale));
      const j = (icon.width * sy + sx) << 2;
      out.data[i] = icon.data[j];
      out.data[i + 1] = icon.data[j + 1];
      out.data[i + 2] = icon.data[j + 2];
      out.data[i + 3] = 255;
    }
  }
  return out;
}

function countClipped(fg, pred) {
  let clipped = 0;
  let mark = 0;
  for (let y = 0; y < fg.height; y += 1) {
    for (let x = 0; x < fg.width; x += 1) {
      const i = (fg.width * y + x) << 2;
      if (fg.data[i + 3] < 12) continue;
      mark += 1;
      if (!pred(x, y, fg.width)) clipped += 1;
    }
  }
  return { clipped, mark };
}

function circleCrop(icon) {
  const out = clonePng(icon);
  const c = (icon.width - 1) / 2;
  const r = icon.width / 2;
  for (let y = 0; y < icon.height; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const dx = x - c;
      const dy = y - c;
      if (dx * dx + dy * dy > r * r) {
        const i = (icon.width * y + x) << 2;
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 0;
      }
    }
  }
  return flattenOnto(out, CANVAS);
}

function deriveForegroundSvg(master) {
  return master.replace(/<rect id="icon-background"[^/]*\/>/, '');
}

function deriveMonochromeSvg(master) {
  const withoutBg = deriveForegroundSvg(master);
  const withoutMark = withoutBg.replace(
    /<g id="icon-mark">[\s\S]*?<\/g>/,
    '<use href="#icon-silhouette" fill="#FFFFFF"/>',
  );
  if (withoutMark === withoutBg) {
    throw new Error('Could not replace #icon-mark with silhouette');
  }
  return withoutMark;
}

async function writePng(filePath, png) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, PNG.sync.write(png));
}

async function removeWebpLaunchers() {
  for (const density of ANDROID_DENSITIES) {
    const dir = path.join(ANDROID_RES, `mipmap-${density.name}`);
    for (const name of ['ic_launcher.webp', 'ic_launcher_round.webp']) {
      await rm(path.join(dir, name), { force: true });
    }
  }
}

function iosContentsJson() {
  const images = IOS_SLOTS.map(slot => ({
    idiom: slot.idiom,
    size: slot.size,
    scale: slot.scale,
    filename: slot.filename,
  }));
  images.push(
    {
      idiom: 'ios-marketing',
      size: '1024x1024',
      scale: '1x',
      filename: 'icon-1024.png',
    },
    {
      idiom: 'ios-marketing',
      size: '1024x1024',
      scale: '1x',
      filename: 'icon-1024-dark.png',
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
    },
    {
      idiom: 'ios-marketing',
      size: '1024x1024',
      scale: '1x',
      filename: 'icon-1024-tinted.png',
      appearances: [{ appearance: 'luminosity', value: 'tinted' }],
    },
  );
  return `${JSON.stringify({ images, info: { version: 1, author: 'xcode' } }, null, 2)}\n`;
}

function androidAdaptiveXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/hypercolor_icon_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
`;
}

function androidMonochromeXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="1024"
    android:viewportHeight="1024">
    <group
        android:pivotX="512"
        android:pivotY="512"
        android:rotation="-8">
        <path
            android:fillColor="#FFFFFF"
            android:pathData="M512,244 L712,378 L712,646 L512,780 L312,646 L312,378 Z"/>
    </group>
</vector>
`;
}

function androidColorXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="hypercolor_icon_background">${CANVAS.hex}</color>
</resources>
`;
}

async function main() {
  const master = await readFile(MASTER_PATH, 'utf8');
  if (/<text[\s>]/i.test(master)) {
    throw new Error('Master SVG must not contain text');
  }

  const fgSvg = deriveForegroundSvg(master);
  const monoSvg = deriveMonochromeSvg(master);

  const master1024 = flattenOnto(renderSvg(master, 1024), CANVAS);
  assertOpaque(master1024, 'iOS 1024 marketing');

  const fg1024 = renderSvg(fgSvg, 1024);
  const mono1024 = renderSvg(monoSvg, 1024);
  const fgBounds = markBounds(fg1024);
  const adaptiveInset = Math.round(1024 * 0.18);
  if (
    fgBounds.minX < adaptiveInset ||
    fgBounds.minY < adaptiveInset ||
    fgBounds.maxX > 1024 - adaptiveInset ||
    fgBounds.maxY > 1024 - adaptiveInset
  ) {
    throw new Error(
      `Foreground silhouette leaves the Android 66% safe zone (${JSON.stringify(fgBounds)})`,
    );
  }

  const fgColor = dominantNonCanvas(master1024);
  const fgContrast = contrastRgb(fgColor, CANVAS);
  const brandContrast = contrastRgb(BRAND, CANVAS);
  if (fgContrast < 3 || brandContrast < 3) {
    throw new Error(
      `Foreground/background contrast ${fgContrast.toFixed(2)} (brand ${brandContrast.toFixed(2)}) is below 3:1`,
    );
  }

  const monoColors = uniqueOpaqueColors(mono1024);
  if (monoColors.size !== 1) {
    throw new Error(`Monochrome layer has ${monoColors.size} opaque colors; expected 1 (${[...monoColors]})`);
  }
  const monoRgb = [...monoColors][0]?.split(',').map(Number) ?? [];
  if (monoRgb[0] < 250 || monoRgb[1] < 250 || monoRgb[2] < 250) {
    throw new Error(`Monochrome silhouette must be white, got ${[...monoColors]}`);
  }

  const masks = [
    { id: 'android-circle', pred: (x, y, size) => insideCircle(x, y, size) },
    { id: 'android-squircle', pred: (x, y, size) => insideSuperellipse(x, y, size, 4) },
    { id: 'android-rounded-square', pred: (x, y, size) => insideRoundedRect(x, y, size, 0.18) },
    { id: 'ios-mask', pred: (x, y, size) => insideRoundedRect(x, y, size, 0.2237) },
  ];
  for (const mask of masks) {
    const { clipped, mark } = countClipped(fg1024, mask.pred);
    if (clipped > 0) {
      throw new Error(`${mask.id} clips ${clipped}/${mark} silhouette pixels`);
    }
  }

  await mkdir(PREVIEW_DIR, { recursive: true });
  const previewIcon = flattenOnto(renderSvg(master, 512), CANVAS);
  for (const mask of masks) {
    for (const [tone, bg] of [
      ['light', LIGHT_LAUNCHER],
      ['dark', DARK_LAUNCHER],
    ]) {
      const preview = applyMask(previewIcon, 512, mask.pred, bg);
      await writePng(path.join(PREVIEW_DIR, `preview-${mask.id}-${tone}.png`), preview);
    }
  }
  await writePng(path.join(PREVIEW_DIR, 'preview-unmasked.png'), previewIcon);

  await removeWebpLaunchers();
  await mkdir(path.join(ANDROID_RES, 'mipmap-anydpi-v26'), { recursive: true });
  await writeFile(path.join(ANDROID_RES, 'mipmap-anydpi-v26/ic_launcher.xml'), androidAdaptiveXml());
  await writeFile(
    path.join(ANDROID_RES, 'mipmap-anydpi-v26/ic_launcher_round.xml'),
    androidAdaptiveXml(),
  );
  await writeFile(path.join(ANDROID_RES, 'values/hypercolor_icon_colors.xml'), androidColorXml());
  await writeFile(path.join(ANDROID_RES, 'drawable/ic_launcher_monochrome.xml'), androidMonochromeXml());

  for (const density of ANDROID_DENSITIES) {
    const mipmap = path.join(ANDROID_RES, `mipmap-${density.name}`);
    await mkdir(mipmap, { recursive: true });
    const launcher = flattenOnto(renderSvg(master, Math.round(48 * density.scale)), CANVAS);
    await writePng(path.join(mipmap, 'ic_launcher.png'), launcher);
    await writePng(path.join(mipmap, 'ic_launcher_round.png'), circleCrop(launcher));
    const fg = renderSvg(fgSvg, Math.round(108 * density.scale));
    await writePng(path.join(mipmap, 'ic_launcher_foreground.png'), fg);
  }

  await mkdir(IOS_APPICON, { recursive: true });
  for (const slot of IOS_SLOTS) {
    const png = flattenOnto(renderSvg(master, slot.px), CANVAS);
    assertOpaque(png, slot.filename);
    await writePng(path.join(IOS_APPICON, slot.filename), png);
  }
  await writePng(path.join(IOS_APPICON, 'icon-1024.png'), master1024);
  await writePng(path.join(IOS_APPICON, 'icon-1024-dark.png'), master1024);
  const tinted = flattenOnto(mono1024, CANVAS);
  assertOpaque(tinted, 'icon-1024-tinted.png');
  await writePng(path.join(IOS_APPICON, 'icon-1024-tinted.png'), tinted);
  await writeFile(path.join(IOS_APPICON, 'Contents.json'), iosContentsJson());

  const derivedFgPath = path.join(ROOT, 'design/app-icon/hypercolor-icon-foreground.svg');
  const derivedMonoPath = path.join(ROOT, 'design/app-icon/hypercolor-icon-monochrome.svg');
  await writeFile(derivedFgPath, `${fgSvg.trim()}\n`);
  await writeFile(derivedMonoPath, `${monoSvg.trim()}\n`);

  const report = {
    master: path.relative(ROOT, MASTER_PATH),
    foregroundContrast: Number(fgContrast.toFixed(3)),
    brandOnCanvasContrast: Number(brandContrast.toFixed(3)),
    fgBounds,
    monochromeColors: [...monoColors],
    previews: (await import('node:fs')).readdirSync(PREVIEW_DIR).filter(name => name.endsWith('.png')),
  };
  await writeFile(
    path.join(ROOT, 'design/app-icon/generate-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log('Generated Hypercolor app icons.');
  console.log(`  foreground/background contrast: ${fgContrast.toFixed(2)}:1`);
  console.log(`  brand/canvas contrast: ${brandContrast.toFixed(2)}:1`);
  console.log(`  silhouette bounds: ${JSON.stringify(fgBounds)}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
