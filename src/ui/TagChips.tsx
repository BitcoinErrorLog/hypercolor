import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, typeRole } from '../theme';
import { HIT_SLOP_44, minHitStyle } from './hitTarget';
import type { ChatTagRow } from '../services/StorageService';

const WORD = /^[a-z0-9_]{1,32}$/;

export type TagAggregate = {
  label: string;
  count: number;
  mine: boolean;
};

export function aggregateTags(
  tags: readonly ChatTagRow[],
  targetAuthorPubky: string,
  targetEventId: string,
  localPubky: string | null,
): TagAggregate[] {
  const map = new Map<string, TagAggregate>();
  for (const tag of tags) {
    if (tag.targetAuthorPubky !== targetAuthorPubky || tag.targetEventId !== targetEventId) {
      continue;
    }
    const current = map.get(tag.label) ?? { label: tag.label, count: 0, mine: false };
    current.count += 1;
    if (localPubky && tag.taggerPubky === localPubky) current.mine = true;
    map.set(tag.label, current);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function TagChips({
  tags,
  onToggle,
  testID,
}: {
  tags: readonly TagAggregate[];
  onToggle?: (label: string, mine: boolean) => void;
  testID?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <View style={styles.row} testID={testID ?? 'tagChips'} nativeID="tagChips">
      {tags.map(tag => (
        <Pressable
          key={tag.label}
          testID={`tagChip-${tag.label}`}
          accessibilityRole="button"
          accessibilityLabel={
            tag.mine
              ? `Remove tag ${tag.label}, ${tag.count}`
              : `Add tag ${tag.label}, ${tag.count}`
          }
          hitSlop={HIT_SLOP_44}
          onPress={() => onToggle?.(tag.label, tag.mine)}
          style={[styles.chip, tag.mine ? styles.mine : null, minHitStyle]}
        >
          <Text style={[styles.text, tag.mine ? styles.mineText : null]}>
            {WORD.test(tag.label) ? tag.label : tag.label} {tag.count}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
  },
  chip: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    paddingHorizontal: space.sm,
    backgroundColor: color.surface,
  },
  mine: {
    backgroundColor: color.brand,
    borderColor: color.brand,
  },
  text: {
    color: color.textPrimary,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
  mineText: {
    color: color.textOnBrand,
  },
});
