/**
 * Hypercolor semantic design tokens.
 *
 * Pure TypeScript — no react-native import — so the module is tree-shakeable
 * from tests, VRT, and native screens. Values are frozen at load.
 *
 * Identity: black canvas, violet brand, hairline surfaces, 12 px product
 * radius. Contrast follows docs/ux/a11y-motion-vrt-contract.md.
 */

import { WCAG_AA_BODY, WCAG_AA_UI_LARGE } from './contrast';

export type ContrastUsage = 'body' | 'ui-large';

export type TextOnSurfacePair = {
  readonly name: string;
  readonly fg: string;
  readonly bg: string;
  readonly usage: ContrastUsage;
};

export type TypeRoleName =
  | 'display'
  | 'title'
  | 'heading'
  | 'titleStack'
  | 'body'
  | 'bodyStrong'
  | 'numeric'
  | 'callout'
  | 'secondary'
  | 'caption'
  | 'mono'
  | 'label'
  | 'meta';

export type TypeRoleSpec = {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: '400' | '600';
  readonly fontFamily?: 'monospace';
};

export type HapticEventName = 'sendAccepted' | 'walletHandoff' | 'authCompleted';
export type HapticStyle = 'light' | 'medium' | 'success';
export type DurationName = 'instant' | 'sheet' | 'short' | 'navigation';

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeDeep(item);
    }
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) {
    freezeDeep((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

export const color = freezeDeep({
  canvas: '#0A0A0A',
  surface: '#111111',
  surfaceRaised: '#1A1A1A',
  surfaceBrand: '#1F1B2E',
  bubbleIncoming: '#1F1F1F',
  well: '#1F2937',
  hairline: '#1A1A1A',
  hairlineStrong: '#374151',
  brand: '#7C3AED',
  brandDeep: '#4C1D95',
  brandMuted: '#C4B5FD',
  brandSoft: '#A78BFA',
  brandText: '#8F57F0',
  brandHighlight: '#E9D5FF',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#808692',
  textOnBrand: '#FFFFFF',
  onBrandMuted: '#EFE6FD',
  textOnBrandMuted: 'rgba(255,255,255,0.843)',
  textOnBrandUi: 'rgba(255,255,255,0.6)',
  danger: '#FCA5A5',
  dangerStrong: '#EF4444',
  warning: '#F59E0B',
  warningStrong: '#FBBF24',
  success: '#86EFAC',
  overlay: 'rgba(0,0,0,0.6)',
  overlayDeep: 'rgba(0,0,0,0.72)',
  overlaySoft: 'rgba(0,0,0,0.25)',
  overlayOnBrand: 'rgba(255,255,255,0.18)',
  overlayOnBrandFaint: 'rgba(255,255,255,0.12)',
  chipWarning: 'rgba(250,204,21,0.2)',
  chipSuccess: 'rgba(74,222,128,0.2)',
  chipDanger: 'rgba(248,113,113,0.2)',
  qrQuietZone: '#FFFFFF',
  qrModules: '#000000',
  nativeSplash: '#FFFFFF',
} as const);

export const space = freezeDeep({
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const);

export const radius = freezeDeep({
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
  bubbleTail: 4,
} as const);

export const typeRole: Readonly<Record<TypeRoleName, TypeRoleSpec>> = freezeDeep({
  display: { fontSize: 32, lineHeight: 40, fontWeight: '600' },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '600' },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  titleStack: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  numeric: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  callout: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  secondary: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  mono: { fontSize: 13, lineHeight: 18, fontWeight: '400', fontFamily: 'monospace' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
});

export const fontFamily = freezeDeep({
  mono: 'monospace',
} as const);

/**
 * React Native `Text` already multiplies `fontSize` by the system font scale.
 * Do not apply `typeLayoutSize` to `Text` style.fontSize or sizes will double.
 * Use it only when measuring layout (composer height, header stacking) so
 * Dynamic Type can grow containers instead of clipping primary actions.
 */
export function typeLayoutSize(
  role: TypeRoleName,
  fontScale: number,
): { fontSize: number; lineHeight: number } {
  const spec = typeRole[role];
  const scale = fontScale > 0 ? fontScale : 1;
  return {
    fontSize: spec.fontSize * scale,
    lineHeight: spec.lineHeight * scale,
  };
}

export const fontScaling = freezeDeep({
  allowFontScaling: true as const,
});

export const iconSize = freezeDeep({
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const);

export const measure = freezeDeep({
  hitTarget: 44,
  authQr: 220,
  hairlineWidth: 1,
} as const);

export const durationMs = freezeDeep({
  instant: 0,
  sheet: 150,
  short: 200,
  navigation: 250,
} as const);

export const easing = freezeDeep({
  enter: [0.2, 0.8, 0.2, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
  platformEaseOut: 'ease-out',
} as const);

export const easingCss = freezeDeep({
  enter: 'cubic-bezier(.2,.8,.2,1)',
  exit: 'cubic-bezier(.4,0,1,1)',
} as const);

export function durationFor(name: DurationName, reducedMotion: boolean): number {
  return reducedMotion ? durationMs.instant : durationMs[name];
}

export function modalAnimationType(reducedMotion: boolean): 'none' | 'fade' {
  return reducedMotion ? 'none' : 'fade';
}

export function stackAnimation(reducedMotion: boolean): 'fade' | 'slide_from_right' {
  return reducedMotion ? 'fade' : 'slide_from_right';
}

export function scrollAnimated(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

export const hapticEvent = freezeDeep({
  sendAccepted: 'sendAccepted',
  walletHandoff: 'walletHandoff',
  authCompleted: 'authCompleted',
} as const satisfies Record<HapticEventName, HapticEventName>);

export const hapticStyle = freezeDeep({
  sendAccepted: 'light',
  walletHandoff: 'medium',
  authCompleted: 'success',
} as const satisfies Record<HapticEventName, HapticStyle>);

/**
 * Pairs that may be used as text (or essential UI chrome) on a surface.
 * Brand-on-canvas is ui-large only: icons, focus rings, large/bold labels.
 * Small brand text uses `brandText`. Decorative fills are not listed.
 */
export const textOnSurfacePairs: readonly TextOnSurfacePair[] = freezeDeep([
  { name: 'textPrimary/canvas', fg: color.textPrimary, bg: color.canvas, usage: 'body' },
  { name: 'textPrimary/surface', fg: color.textPrimary, bg: color.surface, usage: 'body' },
  {
    name: 'textPrimary/surfaceRaised',
    fg: color.textPrimary,
    bg: color.surfaceRaised,
    usage: 'body',
  },
  {
    name: 'textPrimary/surfaceBrand',
    fg: color.textPrimary,
    bg: color.surfaceBrand,
    usage: 'body',
  },
  {
    name: 'textPrimary/bubbleIncoming',
    fg: color.textPrimary,
    bg: color.bubbleIncoming,
    usage: 'body',
  },
  { name: 'textSecondary/canvas', fg: color.textSecondary, bg: color.canvas, usage: 'body' },
  { name: 'textSecondary/surface', fg: color.textSecondary, bg: color.surface, usage: 'body' },
  {
    name: 'textSecondary/surfaceRaised',
    fg: color.textSecondary,
    bg: color.surfaceRaised,
    usage: 'body',
  },
  {
    name: 'textSecondary/surfaceBrand',
    fg: color.textSecondary,
    bg: color.surfaceBrand,
    usage: 'body',
  },
  {
    name: 'textSecondary/bubbleIncoming',
    fg: color.textSecondary,
    bg: color.bubbleIncoming,
    usage: 'body',
  },
  { name: 'textMuted/canvas', fg: color.textMuted, bg: color.canvas, usage: 'body' },
  { name: 'textMuted/surface', fg: color.textMuted, bg: color.surface, usage: 'body' },
  { name: 'textMuted/surfaceRaised', fg: color.textMuted, bg: color.surfaceRaised, usage: 'body' },
  { name: 'textMuted/surfaceBrand', fg: color.textMuted, bg: color.surfaceBrand, usage: 'body' },
  {
    name: 'textMuted/bubbleIncoming',
    fg: color.textMuted,
    bg: color.bubbleIncoming,
    usage: 'body',
  },
  { name: 'textOnBrand/brand', fg: color.textOnBrand, bg: color.brand, usage: 'body' },
  { name: 'onBrandMuted/brand', fg: color.onBrandMuted, bg: color.brand, usage: 'body' },
  { name: 'textOnBrandMuted/brand', fg: color.textOnBrandMuted, bg: color.brand, usage: 'body' },
  { name: 'textOnBrandUi/brand', fg: color.textOnBrandUi, bg: color.brand, usage: 'ui-large' },
  { name: 'brandText/canvas', fg: color.brandText, bg: color.canvas, usage: 'body' },
  { name: 'brandMuted/canvas', fg: color.brandMuted, bg: color.canvas, usage: 'body' },
  { name: 'brandSoft/canvas', fg: color.brandSoft, bg: color.canvas, usage: 'body' },
  { name: 'brandHighlight/canvas', fg: color.brandHighlight, bg: color.canvas, usage: 'body' },
  { name: 'brand/canvas', fg: color.brand, bg: color.canvas, usage: 'ui-large' },
  { name: 'danger/canvas', fg: color.danger, bg: color.canvas, usage: 'body' },
  { name: 'danger/surface', fg: color.danger, bg: color.surface, usage: 'body' },
  { name: 'dangerStrong/canvas', fg: color.dangerStrong, bg: color.canvas, usage: 'body' },
  { name: 'warning/canvas', fg: color.warning, bg: color.canvas, usage: 'body' },
  { name: 'warningStrong/canvas', fg: color.warningStrong, bg: color.canvas, usage: 'body' },
  { name: 'success/canvas', fg: color.success, bg: color.canvas, usage: 'body' },
  { name: 'qrModules/qrQuietZone', fg: color.qrModules, bg: color.qrQuietZone, usage: 'body' },
]);

export const wcagThreshold: Readonly<Record<ContrastUsage, number>> = freezeDeep({
  body: WCAG_AA_BODY,
  'ui-large': WCAG_AA_UI_LARGE,
});

const FROZEN_ROOTS: readonly unknown[] = [
  color,
  space,
  radius,
  typeRole,
  fontFamily,
  fontScaling,
  iconSize,
  measure,
  durationMs,
  easing,
  easingCss,
  hapticEvent,
  hapticStyle,
  textOnSurfacePairs,
  wcagThreshold,
];

export function frozenTokenRoots(): readonly unknown[] {
  return FROZEN_ROOTS;
}

export function assertFrozen(value: unknown, path = 'root'): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (!Object.isFrozen(value)) {
    throw new Error(`Token is not frozen: ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertFrozen(item, `${path}[${index}]`);
    });
    return;
  }
  for (const key of Object.keys(value)) {
    assertFrozen((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
