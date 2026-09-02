/**
 * WCAG 2.2 relative-luminance contrast. Used by token tests and the VRT
 * swatch. CSS sRGB, then linearization, then (L1 + 0.05) / (L2 + 0.05).
 */

export type Rgba = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

const HEX_SHORT = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4})$/;
const HEX_LONG = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const RGB = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/;

function expandShortHex(hex: string): string {
  return hex
    .split('')
    .map(ch => ch + ch)
    .join('');
}

export function parseCssColor(input: string): Rgba {
  const trimmed = input.trim();
  if (HEX_SHORT.test(trimmed)) {
    const body = expandShortHex(trimmed.slice(1));
    return parseHexBody(body);
  }
  if (HEX_LONG.test(trimmed)) {
    return parseHexBody(trimmed.slice(1));
  }
  const rgb = trimmed.match(RGB);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if (![r, g, b, a].every(n => Number.isFinite(n))) {
      throw new Error(`Invalid color: ${input}`);
    }
    return { r, g, b, a };
  }
  throw new Error(`Unsupported color: ${input}`);
}

function parseHexBody(body: string): Rgba {
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  const a = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

function srgbChannelToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: Rgba): number {
  const opaque = color.a === 1 ? color : compositeOver(color, { r: 0, g: 0, b: 0, a: 1 });
  return (
    0.2126 * srgbChannelToLinear(opaque.r) +
    0.7152 * srgbChannelToLinear(opaque.g) +
    0.0722 * srgbChannelToLinear(opaque.b)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const bg = parseCssColor(background);
  if (bg.a !== 1) {
    throw new Error(`Background must be opaque, got ${background}`);
  }
  const fg = compositeOver(parseCssColor(foreground), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export const WCAG_AA_BODY = 4.5;
export const WCAG_AA_UI_LARGE = 3;
