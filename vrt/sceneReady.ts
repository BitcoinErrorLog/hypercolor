/** Stable testID Maestro waits on before takeScreenshot (any catalog mount). */
export const VRT_SCENE_READY_ID = 'vrtSceneReady';

/** Exact catalog-id marker. Maestro must assertVisible this before takeScreenshot. */
export function vrtSceneMarkerId(catalogId: string): string {
  return `vrt-scene:${catalogId}`;
}
