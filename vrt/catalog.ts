/* eslint-disable @typescript-eslint/no-require-imports -- lazy catalog graph */
import { createElement } from 'react';
import { catalogMetaById, VRT_CATALOG_META } from './catalogMeta';
import { assertCatalogAllowed } from './catalogGuard';
import type { VrtCatalogEntry } from './types';

export { assertCatalogAllowed } from './catalogGuard';

function sceneRenderer(id: string) {
  const { SCENE_RENDERERS } =
    require('./scenes/JourneyScenes') as typeof import('./scenes/JourneyScenes');
  const scene = SCENE_RENDERERS[id];
  if (!scene) {
    throw new Error(`Catalog meta ${id} has no renderer`);
  }
  return scene;
}

export const VRT_CATALOG: readonly VrtCatalogEntry[] = Object.freeze(
  VRT_CATALOG_META.map(meta =>
    Object.freeze({
      ...meta,
      render: () => {
        assertCatalogAllowed();
        return createElement(sceneRenderer(meta.id));
      },
    }),
  ),
);

export function catalogById(id: string): VrtCatalogEntry {
  const meta = catalogMetaById(id);
  const entry = VRT_CATALOG.find(item => item.id === meta.id);
  if (!entry) {
    throw new Error(`Unknown VRT catalog id: ${id}`);
  }
  return entry;
}
