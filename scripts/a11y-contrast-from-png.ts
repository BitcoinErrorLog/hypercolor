#!/usr/bin/env npx tsx
import { PNG } from 'pngjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

const files = process.argv.slice(2);
const out: Record<string, number> = {};
for (const file of files) {
  const png = PNG.sync.read(readFileSync(file));
  const i = ((png.height >> 2) * png.width + (png.width >> 1)) << 2;
  const j = ((png.height >> 3) * png.width + 24) << 2;
  const r1 = png.data[i] ?? 0;
  const g1 = png.data[i + 1] ?? 0;
  const b1 = png.data[i + 2] ?? 0;
  const r2 = png.data[j] ?? 0;
  const g2 = png.data[j + 1] ?? 0;
  const b2 = png.data[j + 2] ?? 0;
  const fg = luminance(r1, g1, b1);
  const bg = luminance(r2, g2, b2);
  out[path.basename(file)] = Number(contrast(fg, bg).toFixed(2));
}
const dest = path.resolve('vrt/output/report/a11y-contrast.json');
mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(dest, Object.keys(out).length);
