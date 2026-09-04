import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { color, space, typeRole } from '../src/theme';
import { catalogById, VRT_CATALOG } from './catalog';
import { VRT_SCENE_READY_ID, vrtSceneMarkerId } from './sceneReady';

export function isVrtCatalogEnabled(): boolean {
  if (!__DEV__) return false;
  return process.env.E2E_VRT === '1' || process.env.EXPO_PUBLIC_E2E_VRT === '1';
}

let externalSceneId: string | null = null;
const listeners = new Set<(id: string) => void>();

export function setVrtScene(id: string): void {
  externalSceneId = id;
  for (const listener of listeners) listener(id);
}

export function getVrtScene(): string | null {
  return externalSceneId;
}

function sceneFromVrtUrl(url: string): string | null {
  if (!url.toLowerCase().includes('e2e/vrt')) return null;
  try {
    const q = url.indexOf('?');
    const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
    const scene = (params.get('scene') ?? '').trim();
    return scene.length > 0 ? scene : null;
  } catch {
    return null;
  }
}

function markerNeedsModal(sceneId: string): boolean {
  return (
    sceneId.startsWith('overlay.') ||
    sceneId === 'stack.composer.sheet' ||
    sceneId.startsWith('stack.payment.')
  );
}

function VrtMarkerHost({
  markerId,
  modal,
}: {
  markerId: string;
  modal: boolean;
}): React.ReactElement | null {
  const [visibleMarkerId, setVisibleMarkerId] = useState(markerId);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisibleMarkerId(markerId));
    return () => cancelAnimationFrame(frame);
  }, [markerId]);

  if (Platform.OS !== 'android') return null;
  const marker = (
    <View
      key={visibleMarkerId}
      testID={visibleMarkerId}
      accessibilityLabel={visibleMarkerId}
      accessibilityHint="vrt-scene-marker"
      accessible
      collapsable={false}
      importantForAccessibility="yes"
      style={styles.markerHost}
    >
      <Text
        testID={visibleMarkerId}
        accessibilityLabel={visibleMarkerId}
        accessibilityHint="vrt-scene-marker"
        accessible
        style={styles.markerReadableText}
      >
        {visibleMarkerId}
      </Text>
    </View>
  );

  if (modal) {
    return (
      <Modal visible transparent animationType="none" accessibilityViewIsModal={false}>
        {marker}
      </Modal>
    );
  }

  return marker;
}

export function VrtCatalogRoot(): React.ReactElement {
  const initial = externalSceneId ?? VRT_CATALOG[0]?.id ?? 'design-system.token-swatch.default';
  const [sceneId, setSceneId] = useState(initial);

  useEffect(() => {
    StatusBar.setHidden(true, 'none');
    const onChange = (id: string) => setSceneId(id);
    listeners.add(onChange);
    if (externalSceneId && externalSceneId !== sceneId) {
      setSceneId(externalSceneId);
    }
    const sub = Linking.addEventListener('url', ({ url }) => {
      const scene = sceneFromVrtUrl(url);
      if (scene) setVrtScene(scene);
    });
    void Linking.getInitialURL().then(url => {
      if (!url) return;
      const scene = sceneFromVrtUrl(url);
      if (scene) setVrtScene(scene);
    });
    return () => {
      listeners.delete(onChange);
      sub.remove();
      StatusBar.setHidden(false, 'none');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount sync only
  }, []);

  const resolved = useMemo(() => {
    try {
      return { ok: true as const, entry: catalogById(sceneId) };
    } catch {
      return { ok: false as const, requested: sceneId };
    }
  }, [sceneId]);

  if (!resolved.ok) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root} testID={VRT_SCENE_READY_ID}>
          <Text
            {...(Platform.OS === 'android'
              ? {
                  accessibilityElementsHidden: true,
                  importantForAccessibility: 'no-hide-descendants' as const,
                }
              : {
                  testID: 'vrt-scene-missing',
                  accessibilityLabel: `vrt-scene-missing:${resolved.requested}`,
                })}
            style={styles.markerText}
          >
            {`vrt-scene-missing:${resolved.requested}`}
          </Text>
          <Text style={styles.meta}>Unknown VRT scene: {resolved.requested}</Text>
          <VrtMarkerHost markerId={`vrt-scene-missing:${resolved.requested}`} modal={false} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const { entry } = resolved;
  const markerId = vrtSceneMarkerId(entry.id);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} testID={VRT_SCENE_READY_ID}>
        <Text
          {...(Platform.OS === 'android'
            ? {
                accessibilityElementsHidden: true,
                importantForAccessibility: 'no-hide-descendants' as const,
              }
            : {
                testID: markerId,
                accessibilityLabel: markerId,
                accessibilityHint: 'vrt-scene-marker',
                accessible: true,
              })}
          style={styles.markerText}
        >
          {markerId}
        </Text>
        <View style={styles.body} pointerEvents="box-none">
          {entry.render()}
        </View>
        <VrtMarkerHost markerId={markerId} modal={markerNeedsModal(entry.id)} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  markerHost: {
    position: 'absolute',
    zIndex: 9999,
    top: 0,
    left: 0,
    right: 0,
    height: 18,
    overflow: 'hidden',
    backgroundColor: color.canvas,
  },
  markerReadableText: {
    color: color.brand,
    fontSize: 10,
    lineHeight: 12,
  },
  markerText: {
    position: 'absolute',
    zIndex: 9999,
    left: 0,
    top: 0,
    width: 8,
    height: 8,
    overflow: 'hidden',
    fontSize: 1,
    lineHeight: 1,
    color: color.brand,
    backgroundColor: color.brand,
    opacity: 1,
  },
  meta: {
    color: color.textMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  body: { flex: 1 },
});
