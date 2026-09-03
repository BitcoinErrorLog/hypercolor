import React from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityState } from 'react-native';
import { color, measure, space, typeRole } from '../../theme';

export type ListRowProps = {
  title: string;
  subtitle?: string;
  meta?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

export function ListRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  disabled = false,
  selected = false,
  testID,
  accessibilityLabel,
}: ListRowProps) {
  const label = accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(', ');
  const state: AccessibilityState = {
    disabled: disabled || !onPress,
    selected: selected || undefined,
  };

  const body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );

  if (!onPress) {
    return (
      <View {...(testID ? { testID } : {})} style={styles.row} accessibilityLabel={label}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      {...(testID ? { testID } : {})}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={state}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.selected : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: measure.hitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
    backgroundColor: color.canvas,
  },
  selected: {
    backgroundColor: color.surfaceBrand,
  },
  pressed: {
    backgroundColor: color.surface,
  },
  disabled: {
    opacity: 0.55,
  },
  leading: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailing: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: space.xs,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    fontWeight: typeRole.bodyStrong.fontWeight,
  },
  subtitle: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: typeRole.secondary.lineHeight,
  },
  meta: {
    color: color.textMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
});
