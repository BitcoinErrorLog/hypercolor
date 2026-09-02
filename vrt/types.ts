import type { ReactElement } from 'react';

export type VrtPlatform = 'android' | 'ios' | 'headless';
export type VrtViewport =
  | 'android-small'
  | 'android-large'
  | 'ios-small'
  | 'ios-large'
  | 'headless';
export type VrtTheme = 'dark';

export type VrtMaskReason =
  | 'qr'
  | 'recovery'
  | 'pubky'
  | 'timestamp'
  | 'unread'
  | 'payment'
  | 'status-bar'
  | 'secret';

export type VrtMaskRule = {
  readonly testID: string;
  readonly reason: VrtMaskReason;
};

/**
 * Catalog row. `id` is `{journey}.{screen}.{state}` in lower-kebab.
 * Capture path: `journey/screen/state/platform/device.png`.
 */
export type VrtCatalogEntry = {
  readonly id: string;
  readonly journey: string;
  readonly screen: string;
  readonly platform: VrtPlatform | 'all';
  readonly viewport: VrtViewport | 'all';
  readonly theme: VrtTheme;
  readonly state: string;
  readonly render: () => ReactElement;
  readonly mask: readonly VrtMaskRule[];
};

export type VrtSceneRef = Omit<VrtCatalogEntry, 'render'>;

export const VRT_VIEWPORTS = Object.freeze({
  'android-small': { platform: 'android', device: 'pixel-4a', width: 360, height: 800 },
  'android-large': { platform: 'android', device: 'pixel-8-pro', width: 448, height: 998 },
  'ios-small': { platform: 'ios', device: 'iphone-se-3', width: 375, height: 667 },
  'ios-large': { platform: 'ios', device: 'iphone-15-pro-max', width: 430, height: 932 },
  headless: { platform: 'headless', device: 'catalog', width: 390, height: 844 },
} as const);

export type CaptureTarget = {
  readonly entry: VrtSceneRef;
  readonly platform: VrtPlatform;
  readonly viewport: VrtViewport;
  readonly device: string;
  readonly captureName: string;
};

export function captureNameFor(entry: VrtSceneRef, platform: VrtPlatform, device: string): string {
  return `${entry.journey}/${entry.screen}/${entry.state}/${platform}/${device}.png`;
}

export function expandEntry(entry: VrtSceneRef): CaptureTarget[] {
  const viewports: VrtViewport[] =
    entry.viewport === 'all'
      ? ['android-small', 'android-large', 'ios-small', 'ios-large']
      : [entry.viewport];
  const out: CaptureTarget[] = [];
  for (const viewport of viewports) {
    const spec = VRT_VIEWPORTS[viewport];
    if (entry.platform !== 'all' && entry.platform !== spec.platform) {
      continue;
    }
    out.push({
      entry,
      platform: spec.platform,
      viewport,
      device: spec.device,
      captureName: captureNameFor(entry, spec.platform, spec.device),
    });
  }
  return out;
}
