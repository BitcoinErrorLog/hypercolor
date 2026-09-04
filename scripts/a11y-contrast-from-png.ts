#!/usr/bin/env npx tsx
import { PNG } from 'pngjs';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Region = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type Sample = {
  readonly file: string;
  readonly platform: string;
  readonly profile: string;
  readonly scene: string;
  readonly region: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
};

function luminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: number, b: number): number {
  const L1 = Math.max(a, b);
  const L2 = Math.min(a, b);
  return (L1 + 0.05) / (L2 + 0.05);
}

function rgbToHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseCapture(file: string): { scene: string; platform: string; profile: string } | null {
  const m = path
    .basename(file)
    .match(/^(.+)_(android|ios)_(pixel-4a|pixel-8-pro|iphone-se-3|iphone-16-pro-max)\.png$/);
  if (!m) return null;
  return { scene: m[1]!, platform: m[2]!, profile: m[3]! };
}

function colorAt(png: PNG, x: number, y: number): [number, number, number] {
  const i = (png.width * y + x) << 2;
  return [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
}

function boundsForRegion(png: PNG, region: Region): [number, number, number, number] {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(png.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(png.height, Math.ceil(region.y + region.height));
  return [x0, y0, x1, y1];
}

function androidDumpPath(parsed: {
  scene: string;
  platform: string;
  profile: string;
}): string | null {
  if (parsed.platform !== 'android') return null;
  const dir = process.env.A11Y_DUMP_DIR ?? 'vrt/output/report/a11y-dumps';
  const candidates = [
    path.join(dir, `${parsed.scene}_${parsed.platform}_${parsed.profile}.xml`),
    path.join(dir, `${parsed.scene}_${parsed.profile}.xml`),
    path.join(dir, `${parsed.scene}.xml`),
  ];
  return candidates.find(existsSync) ?? null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function androidTextRegions(parsed: {
  scene: string;
  platform: string;
  profile: string;
}): readonly Region[] {
  const dumpPath = androidDumpPath(parsed);
  if (!dumpPath) return [];
  const xml = readFileSync(dumpPath, 'utf8');
  const regions: Region[] = [];
  for (const node of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = node[0];
    const text = tag.match(/\btext="([^"]*)"/)?.[1] ?? '';
    const desc = tag.match(/\bcontent-desc="([^"]*)"/)?.[1] ?? '';
    const label = decodeXml(text || desc).trim();
    if (label.length === 0) continue;
    const bounds = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds) continue;
    const [, x0, y0, x1, y1] = bounds.map(Number) as [number, number, number, number, number];
    const width = x1 - x0;
    const height = y1 - y0;
    if (width < 4 || height < 4) continue;
    regions.push({ name: label.slice(0, 48), x: x0, y: y0, width, height });
  }
  return regions;
}

function discoveredTextRegions(png: PNG): readonly Region[] {
  const visited = new Uint8Array(png.width * png.height);
  const regions: Region[] = [];
  const isTextPixel = (x: number, y: number): boolean => {
    const rgb = colorAt(png, x, y);
    const lum = luminance(...rgb);
    return lum > 0.2 && Math.max(...rgb) - Math.min(...rgb) < 70;
  };
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const start = y * png.width + x;
      if (visited[start] || !isTextPixel(x, y)) continue;
      const queue: [number, number][] = [[x, y]];
      visited[start] = 1;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;
      while (queue.length) {
        const [cx, cy] = queue.pop()!;
        count += 1;
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
        for (const [nx, ny] of [
          [cx + 2, cy],
          [cx - 2, cy],
          [cx, cy + 2],
          [cx, cy - 2],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= png.width || ny >= png.height) continue;
          const key = ny * png.width + nx;
          if (visited[key] || !isTextPixel(nx, ny)) continue;
          visited[key] = 1;
          queue.push([nx, ny]);
        }
      }
      const width = maxX - minX + 3;
      const height = maxY - minY + 3;
      if (count < 8 || width < 8 || height < 8) continue;
      regions.push({
        name: `glyph-cluster-${regions.length + 1}`,
        x: minX,
        y: minY,
        width,
        height,
      });
    }
  }
  return regions
    .filter(region => region.y > 8 && region.y < png.height - 8)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 24);
}

function modeDarkBackground(png: PNG, region: Region): [number, number, number] {
  const counts = new Map<string, { count: number; rgb: [number, number, number] }>();
  const [rx0, ry0, rx1, ry1] = boundsForRegion(png, region);
  const x0 = Math.max(0, rx0 - 8);
  const y0 = Math.max(0, ry0 - 8);
  const x1 = Math.min(png.width, rx1 + 8);
  const y1 = Math.min(png.height, ry1 + 8);
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const rgb = colorAt(png, x, y);
      if (luminance(...rgb) > 0.12) continue;
      const key = rgb.map(v => Math.round(v / 8) * 8).join(',');
      const current = counts.get(key);
      counts.set(key, { count: (current?.count ?? 0) + 1, rgb });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.rgb ?? [10, 10, 10];
}

function foregroundFromTextPixels(
  png: PNG,
  region: Region,
  bgLum: number,
): [number, number, number] {
  const pixels: { lum: number; rgb: [number, number, number] }[] = [];
  const [x0, y0, x1, y1] = boundsForRegion(png, region);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const rgb = colorAt(png, x, y);
      const lum = luminance(...rgb);
      if (lum - bgLum < 0.08) continue;
      if (lum < 0.18) continue;
      pixels.push({ lum, rgb });
    }
  }
  pixels.sort((a, b) => a.lum - b.lum);
  return pixels[Math.floor(pixels.length * 0.2)]?.rgb ?? pixels[0]?.rgb ?? [249, 250, 251];
}

function sampleFile(file: string): readonly Sample[] {
  const parsed = parseCapture(file);
  if (!parsed) return [];
  const png = PNG.sync.read(readFileSync(file));
  const regions = androidTextRegions(parsed);
  const sampleRegions = regions.length > 0 ? regions : discoveredTextRegions(png);
  if (sampleRegions.length === 0) return [];
  return sampleRegions.map(region => {
    const bg = modeDarkBackground(png, region);
    const fg = foregroundFromTextPixels(png, region, luminance(...bg));
    return {
      file: path.basename(file),
      ...parsed,
      region: region.name,
      foreground: rgbToHex(fg),
      background: rgbToHex(bg),
      ratio: Number(contrast(luminance(...fg), luminance(...bg)).toFixed(2)),
    };
  });
}

const files = process.argv.slice(2);
const samples = files.flatMap(sampleFile);
const byProfile = new Map<string, number[]>();
for (const sample of samples) {
  const key = `${sample.platform}/${sample.profile}`;
  const list = byProfile.get(key) ?? [];
  list.push(sample.ratio);
  byProfile.set(key, list);
}
const summary = Object.fromEntries(
  [...byProfile.entries()].map(([profile, values]) => [
    profile,
    {
      samples: values.length,
      min: Number(Math.min(...values).toFixed(2)),
      max: Number(Math.max(...values).toFixed(2)),
      average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    },
  ]),
);
const out = {
  method:
    'Text-bound PNG contrast: Android uses uiautomator text/content-desc node bounds when available; iOS and missing-dump captures discover bright glyph clusters inside marker-asserted screenshots. Each text bound samples actual bright text pixels against the adjacent local dark background.',
  summary,
  samples,
  dumpDir: process.env.A11Y_DUMP_DIR ?? 'vrt/output/report/a11y-dumps',
  dumpFiles: existsSync(process.env.A11Y_DUMP_DIR ?? 'vrt/output/report/a11y-dumps')
    ? readdirSync(process.env.A11Y_DUMP_DIR ?? 'vrt/output/report/a11y-dumps').length
    : 0,
};
const dest = path.resolve('vrt/output/report/a11y-contrast.json');
mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(dest, samples.length);
