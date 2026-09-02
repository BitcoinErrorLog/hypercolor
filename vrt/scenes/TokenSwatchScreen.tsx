import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  color,
  contrastRatio,
  space,
  textOnSurfacePairs,
  typeRole,
  wcagThreshold,
} from '../../src/theme';

export const TOKEN_SWATCH_READY_ID = 'vrtSceneReady';

export function TokenSwatchScreen(): ReactElement {
  return (
    <View testID={TOKEN_SWATCH_READY_ID} style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Token swatch
        </Text>
        <Text style={styles.body}>Hypercolor semantic tokens. Dark-violet identity.</Text>
        {textOnSurfacePairs.map(pair => {
          const ratio = contrastRatio(pair.fg, pair.bg);
          const pass = ratio >= wcagThreshold[pair.usage];
          return (
            <View key={pair.name} style={[styles.row, { backgroundColor: pair.bg }]}>
              <View style={[styles.chip, { backgroundColor: pair.fg }]} />
              <View style={styles.meta}>
                <Text style={[styles.name, { color: pair.fg }]}>{pair.name}</Text>
                <Text style={[styles.metaText, { color: pair.fg }]}>
                  {ratio.toFixed(2)}:1 {pair.usage} {pass ? 'pass' : 'fail'}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  scroll: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  content: {
    padding: space.xl,
    gap: space.sm,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.title.fontSize,
    lineHeight: typeRole.title.lineHeight,
    fontWeight: typeRole.title.fontWeight,
    marginBottom: space.sm,
  },
  body: {
    color: color.textSecondary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    marginBottom: space.md,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.sm,
    gap: space.sm,
  },
  chip: {
    width: 28,
    height: 28,
  },
  meta: {
    flex: 1,
  },
  name: {
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
    fontWeight: '600',
  },
  metaText: {
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
});
