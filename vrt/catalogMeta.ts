import type { VrtMaskRule, VrtPlatform, VrtSceneRef, VrtTheme, VrtViewport } from './types';

export type VrtCatalogMeta = VrtSceneRef;

export const VRT_CATALOG_META: readonly VrtCatalogMeta[] = Object.freeze([
  Object.freeze({
    id: 'design-system.token-swatch.default',
    journey: 'design-system',
    screen: 'token-swatch',
    platform: 'all' as VrtPlatform | 'all',
    viewport: 'all' as VrtViewport | 'all',
    theme: 'dark' as VrtTheme,
    state: 'default',
    mask: Object.freeze([]) as readonly VrtMaskRule[],
  }),
]);

export function catalogMetaById(id: string): VrtCatalogMeta {
  const entry = VRT_CATALOG_META.find(item => item.id === id);
  if (!entry) {
    throw new Error(`Unknown VRT catalog id: ${id}`);
  }
  return entry;
}
