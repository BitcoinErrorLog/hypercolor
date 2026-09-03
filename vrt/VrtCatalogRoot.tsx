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

/**
 * RN Modal + accessibilityViewIsModal hides sibling a11y nodes. Sheet scenes
 * (composer / payment / alerts) therefore hide the in-tree VRT marker from
 * Maestro. Host a transparent, non-modal marker Modal above the scene so the
 * exact `vrt-scene:<id>` id stays assertable without changing product sheets.
 */
function VrtMarkerHost({ markerId }: { markerId: string }): React.ReactElement | null {
  const [visibleMarkerId, setVisibleMarkerId] = useState(markerId);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisibleMarkerId(markerId));
    return () => cancelAnimationFrame(frame);
  }, [markerId]);

  if (Platform.OS !== 'android') return null;

  return (
    <Modal
      key={visibleMarkerId}
      visible
      transparent
      animationType="none"
      accessibilityViewIsModal={false}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        testID={visibleMarkerId}
        accessibilityLabel={visibleMarkerId}
        accessibilityHint="vrt-scene-marker"
        accessible
        collapsable={false}
        style={styles.markerHost}
      >
        <Text
          testID={visibleMarkerId}
          accessibilityLabel={visibleMarkerId}
          accessibilityHint="vrt-scene-marker"
          accessible
          style={styles.markerText}
        >
          {visibleMarkerId}
        </Text>
      </View>
    </Modal>
  );
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
            testID="vrt-scene-missing"
            accessibilityLabel={`vrt-scene-missing:${resolved.requested}`}
            style={styles.markerText}
          >
            {`vrt-scene-missing:${resolved.requested}`}
          </Text>
          <Text style={styles.meta}>Unknown VRT scene: {resolved.requested}</Text>
          <VrtMarkerHost markerId={`vrt-scene-missing:${resolved.requested}`} />
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
          testID={markerId}
          accessibilityLabel={markerId}
          accessibilityHint="vrt-scene-marker"
          accessible
          style={styles.markerText}
        >
          {markerId}
        </Text>
        <View style={styles.body} pointerEvents="box-none">
          {entry.render()}
        </View>
        <VrtMarkerHost markerId={markerId} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  markerHost: {
    ...StyleSheet.absoluteFillObject,
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
