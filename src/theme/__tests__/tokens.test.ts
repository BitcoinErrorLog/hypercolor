import * as fs from 'fs';
import * as path from 'path';
import { contrastRatio, WCAG_AA_BODY, WCAG_AA_UI_LARGE } from '../contrast';
import {
  assertFrozen,
  color,
  durationFor,
  durationMs,
  frozenTokenRoots,
  hapticEvent,
  hapticStyle,
  modalAnimationType,
  radius,
  scrollAnimated,
  space,
  stackAnimation,
  textOnSurfacePairs,
  typeLayoutSize,
  typeRole,
  wcagThreshold,
} from '../tokens';

const CURRENT_DOC = path.resolve(__dirname, '../../../docs/ux/design-tokens-current.md');
const CONTRACT_DOC = path.resolve(__dirname, '../../../docs/ux/design-tokens-contract.md');

describe('design tokens', () => {
  it('freezes every exported token root and nested object', () => {
    for (const root of frozenTokenRoots()) {
      assertFrozen(root);
    }
    const canvas = color.canvas;
    try {
      (color as { canvas: string }).canvas = '#ffffff';
    } catch {
      // Frozen objects throw in strict mode and ignore in sloppy mode.
    }
    expect(color.canvas).toBe(canvas);
    expect(Object.isFrozen(color)).toBe(true);
    expect(Object.isFrozen(textOnSurfacePairs)).toBe(true);
    expect(textOnSurfacePairs.length).toBeGreaterThan(0);
  });

  it('meets WCAG 2.2 AA for every text-on-surface pair', () => {
    for (const pair of textOnSurfacePairs) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      const need = wcagThreshold[pair.usage];
      expect(ratio).toBeGreaterThanOrEqual(need);
    }
    expect(wcagThreshold.body).toBe(WCAG_AA_BODY);
    expect(wcagThreshold['ui-large']).toBe(WCAG_AA_UI_LARGE);
  });

  it('keeps brand-on-canvas as ui-large and small brand text as body-safe', () => {
    const brand = textOnSurfacePairs.find(pair => pair.name === 'brand/canvas');
    const brandText = textOnSurfacePairs.find(pair => pair.name === 'brandText/canvas');
    expect(brand?.usage).toBe('ui-large');
    expect(brandText?.usage).toBe('body');
    expect(contrastRatio(color.brand, color.canvas)).toBeGreaterThanOrEqual(WCAG_AA_UI_LARGE);
    expect(contrastRatio(color.brandText, color.canvas)).toBeGreaterThanOrEqual(WCAG_AA_BODY);
    expect(contrastRatio(color.brand, color.canvas)).toBeLessThan(WCAG_AA_BODY);
  });

  it('keeps the text ladder ordered and outgoing bubble metadata body-safe', () => {
    expect(color.textSecondary).toBe('#9CA3AF');
    expect(color.textMuted).toBe('#808692');
    expect(contrastRatio(color.textSecondary, color.canvas)).toBeGreaterThan(
      contrastRatio(color.textMuted, color.canvas),
    );
    expect(contrastRatio(color.onBrandMuted, color.brand)).toBeGreaterThanOrEqual(WCAG_AA_BODY);
    expect(textOnSurfacePairs.find(pair => pair.name === 'onBrandMuted/brand')).toMatchObject({
      usage: 'body',
    });
  });

  it('scales type layout with fontScale without mutating the 100% role', () => {
    const base = typeRole.body.fontSize;
    const layout = typeLayoutSize('body', 2);
    expect(layout.fontSize).toBe(base * 2);
    expect(layout.lineHeight).toBe(typeRole.body.lineHeight * 2);
    expect(typeRole.body.fontSize).toBe(16);
    expect(typeLayoutSize('meta', 1).fontSize).toBe(12);
    expect(typeLayoutSize('display', 0).fontSize).toBe(typeRole.display.fontSize);
  });

  it('maps reduced motion to zero duration and non-sliding chrome', () => {
    expect(durationFor('short', false)).toBe(durationMs.short);
    expect(durationFor('navigation', true)).toBe(0);
    expect(durationFor('sheet', true)).toBe(0);
    expect(modalAnimationType(true)).toBe('none');
    expect(modalAnimationType(false)).toBe('fade');
    expect(stackAnimation(true)).toBe('fade');
    expect(stackAnimation(false)).toBe('slide_from_right');
    expect(scrollAnimated(true)).toBe(false);
    expect(scrollAnimated(false)).toBe(true);
  });

  it('names only the three allowed haptic events', () => {
    expect(Object.keys(hapticEvent).sort()).toEqual(
      ['authCompleted', 'sendAccepted', 'walletHandoff'].sort(),
    );
    expect(hapticStyle.sendAccepted).toBe('light');
    expect(hapticStyle.walletHandoff).toBe('medium');
    expect(hapticStyle.authCompleted).toBe('success');
  });

  it('keeps the 12 px product radius and 4 pt spacing grid', () => {
    expect(radius.md).toBe(12);
    expect(space.xs).toBe(4);
    expect(space.sm).toBe(8);
    expect(space.md).toBe(12);
    expect(space.lg).toBe(16);
    expect(space.xl).toBe(20);
    expect(space.xxl).toBe(24);
    expect(space.xxxl).toBe(32);
  });

  it('maps or deletes every raw hex and rgba from design-tokens-current.md', () => {
    const current = fs.readFileSync(CURRENT_DOC, 'utf8');
    const contract = fs.readFileSync(CONTRACT_DOC, 'utf8');
    const hexes = uniqueColors(current, /#(?:[0-9A-Fa-f]{3,8})/g);
    const rgbas = uniqueColors(current, /rgba?\([^)]+\)/g);
    expect(hexes.length).toBeGreaterThan(10);
    const haystack = contract.toLowerCase();
    for (const value of [...hexes, ...rgbas]) {
      const normalized = normalizeColorToken(value);
      const present = haystack.includes(value.toLowerCase()) || haystack.includes(normalized);
      expect(present).toBe(true);
    }
  });
});

function uniqueColors(source: string, pattern: RegExp): string[] {
  const found = source.match(pattern) ?? [];
  const set = new Set(found.map(value => value.replace(/\s+/g, '')));
  return [...set];
}

function normalizeColorToken(value: string): string {
  if (value.startsWith('#')) {
    const body = value.slice(1);
    if (body.length === 3 || body.length === 4) {
      const expanded = body
        .split('')
        .map(ch => ch + ch)
        .join('');
      return `#${expanded}`.toLowerCase();
    }
    return value.toLowerCase();
  }
  return value.replace(/\s+/g, '').toLowerCase();
}
