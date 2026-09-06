import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BUNDLED_EMOJI } from '../lib/emoji/dataset';
import { HIT_SLOP_44 } from '../ui/hitTarget';
import { color, measure, radius, space, typeRole } from '../theme';
import { COPY } from '../copy/uxCopy';
import { SheetChrome } from '../ui/primitives/SheetChrome';

export function EmojiPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (glyph: string) => void;
}) {
  const [query, setQuery] = useState('');
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUNDLED_EMOJI;
    return BUNDLED_EMOJI.filter(entry => entry.names.some(name => name.includes(q)));
  }, [query]);

  return (
    <SheetChrome
      visible={visible}
      title={COPY.emojiPickerTitle}
      onClose={onClose}
      testID="emojiPicker"
    >
      <TextInput
        testID="emojiPickerSearch"
        accessibilityLabel={COPY.emojiSearch}
        value={query}
        onChangeText={setQuery}
        placeholder={COPY.emojiSearch}
        placeholderTextColor={color.textSecondary}
        style={styles.search}
      />
      <FlatList
        data={items}
        keyExtractor={item => item.glyph}
        numColumns={8}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity
            testID={`emojiCell-${item.names[0]}`}
            accessibilityRole="button"
            accessibilityLabel={item.names[0]}
            hitSlop={HIT_SLOP_44}
            onPress={() => onPick(item.glyph)}
            style={styles.cell}
          >
            <Text style={styles.glyph}>{item.glyph}</Text>
          </TouchableOpacity>
        )}
      />
    </SheetChrome>
  );
}

export function EmojiAutocomplete({
  suggestions,
  onPick,
}: {
  suggestions: { glyph: string; names: readonly string[] }[];
  onPick: (glyph: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <View testID="emojiAutocomplete" style={styles.auto}>
      {suggestions.map(item => (
        <TouchableOpacity
          key={item.names[0]}
          accessibilityRole="button"
          accessibilityLabel={item.names[0]}
          hitSlop={HIT_SLOP_44}
          onPress={() => onPick(item.glyph)}
          style={styles.autoRow}
        >
          <Text style={styles.glyph}>{item.glyph}</Text>
          <Text style={styles.autoName}>:{item.names[0]}:</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: measure.hitTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.textPrimary,
    marginBottom: space.md,
  },
  cell: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: typeRole.heading.fontSize },
  auto: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.xs,
  },
  autoRow: {
    minHeight: measure.hitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  autoName: { color: color.textSecondary, fontSize: typeRole.secondary.fontSize },
});
