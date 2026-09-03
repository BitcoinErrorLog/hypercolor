import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { color, space, typeRole } from '../src/theme';
import { catalogById, VRT_CATALOG } from './catalog';
import { VRT_SCENE_READY_ID } from './sceneReady';

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

export function VrtCatalogRoot(): React.ReactElement {
  const initial = externalSceneId ?? VRT_CATALOG[0]?.id ?? 'design-system.token-swatch.default';
  const [sceneId, setSceneId] = useState(initial);

  useEffect(() => {
    const onChange = (id: string) => setSceneId(id);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const entry = useMemo(() => {
    try {
      return catalogById(sceneId);
    } catch {
      return catalogById('design-system.token-swatch.default');
    }
  }, [sceneId]);

  return (
    <SafeAreaView style={styles.root} testID={VRT_SCENE_READY_ID}>
      <View style={styles.chrome}>
        <Text style={styles.meta} accessibilityRole="header">
          {entry.id}
        </Text>
      </View>
      <View style={styles.body}>{entry.render()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  chrome: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  meta: {
    color: color.textMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
  body: { flex: 1 },
});
