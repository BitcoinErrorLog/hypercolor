import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, measure, radius, space, typeRole } from '../../theme';
import { shortPubky } from '../shortPubky';
import { Icon } from './Icon';

export type PubkyChipProps = {
  pubky: string;
  onCopy?: () => void;
  copyLabel?: string;
  testID?: string;
};

export function PubkyChip({ pubky, onCopy, copyLabel = 'Copy pubky', testID }: PubkyChipProps) {
  const chipProps = {
    ...(testID ? { testID } : {}),
    accessible: true,
    accessibilityRole: 'text' as const,
    accessibilityLabel: pubky,
    accessibilityValue: { text: pubky },
    style: styles.chip,
  };
  const chip = onCopy ? (
    <Pressable {...chipProps} onLongPress={onCopy}>
      <Text style={styles.text} numberOfLines={1} ellipsizeMode="clip">
        {shortPubky(pubky)}
      </Text>
    </Pressable>
  ) : (
    <View {...chipProps}>
      <Text style={styles.text} numberOfLines={1} ellipsizeMode="clip">
        {shortPubky(pubky)}
      </Text>
    </View>
  );

  if (!onCopy) return chip;

  return (
    <View style={styles.wrap}>
      {chip}
      <Pressable
        testID={testID ? `${testID}Copy` : undefined}
        accessibilityRole="button"
        accessibilityLabel={copyLabel}
        onPress={onCopy}
        style={styles.copy}
      >
        <Icon name="copy-outline" tone="secondary" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    maxWidth: '100%',
  },
  chip: {
    flexShrink: 1,
    minHeight: measure.hitTarget,
    minWidth: measure.hitTarget,
    justifyContent: 'center',
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  text: {
    color: color.textSecondary,
    fontSize: typeRole.mono.fontSize,
    lineHeight: typeRole.mono.lineHeight,
    fontFamily: typeRole.mono.fontFamily,
  },
  copy: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
