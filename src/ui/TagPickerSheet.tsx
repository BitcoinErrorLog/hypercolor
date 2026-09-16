import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { EmojiPickerSheet } from '../components/EmojiPickerSheet';
import { COPY } from '../copy/uxCopy';
import { color, measure, radius, space, typeRole } from '../theme';
import { HIT_SLOP_44, minHitStyle } from './hitTarget';
import { SheetChrome } from './primitives/SheetChrome';
import { normalizeChatTagLabel } from '../types/chatKindValidation';

export function TagPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (label: string) => void;
}) {
  const [word, setWord] = useState('');
  const normalizedWord = normalizeChatTagLabel(word);
  const wordError =
    word.length > 0 && normalizedWord === null
      ? 'Use 1–32 lowercase letters, numbers, or underscores.'
      : null;
  const [emojiOpen, setEmojiOpen] = useState(false);
  if (!visible) return null;
  return (
    <>
      <SheetChrome
        visible={visible && !emojiOpen}
        title={COPY.tagMessage}
        onClose={onClose}
        testID="tagPicker"
      >
        <TouchableOpacity
          testID="tagPickerEmoji"
          accessibilityRole="button"
          accessibilityLabel={COPY.tagWithEmoji}
          hitSlop={HIT_SLOP_44}
          onPress={() => setEmojiOpen(true)}
          style={[styles.row, minHitStyle]}
        >
          <Text style={styles.rowLabel}>{COPY.tagWithEmoji}</Text>
        </TouchableOpacity>
        <TextInput
          testID="tagPickerWord"
          accessibilityLabel={COPY.tagWithWord}
          value={word}
          onChangeText={setWord}
          placeholder={COPY.tagWithWord}
          placeholderTextColor={color.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityHint={wordError ?? undefined}
          style={styles.input}
        />
        <TouchableOpacity
          testID="tagPickerSubmitWord"
          accessibilityRole="button"
          accessibilityLabel={COPY.addTag}
          accessibilityState={{ disabled: !normalizedWord }}
          hitSlop={HIT_SLOP_44}
          onPress={() => {
            if (!normalizedWord) return;
            setWord('');
            onPick(normalizedWord);
          }}
          disabled={!normalizedWord}
          style={[styles.submit, !normalizedWord ? styles.submitDisabled : null, minHitStyle]}
        >
          <Text style={styles.submitText}>{COPY.addTag}</Text>
        </TouchableOpacity>
        {wordError ? <Text style={styles.error}>{wordError}</Text> : null}
      </SheetChrome>
      <EmojiPickerSheet
        visible={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onPick={glyph => {
          const normalizedGlyph = normalizeChatTagLabel(glyph);
          if (!normalizedGlyph) {
            setWord(glyph);
            setEmojiOpen(false);
            return;
          }
          setEmojiOpen(false);
          onPick(normalizedGlyph);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: measure.hitTarget,
    justifyContent: 'center',
    marginBottom: space.md,
  },
  rowLabel: { color: color.textPrimary, fontSize: typeRole.body.fontSize },
  input: {
    minHeight: measure.hitTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: color.textPrimary,
    marginBottom: space.md,
  },
  submit: {
    minHeight: measure.hitTarget,
    backgroundColor: color.brand,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: color.textOnBrand, fontSize: typeRole.body.fontSize },
  submitDisabled: { opacity: 0.5 },
  error: { color: color.danger, fontSize: typeRole.caption.fontSize, marginBottom: space.md },
});
