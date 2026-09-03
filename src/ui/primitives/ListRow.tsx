import React from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityState } from 'react-native';
import { color, measure, space, typeRole } from '../../theme';
import { Badge } from './Badge';
import { Icon } from './Icon';

export type ListRowProps = {
  title: string;
  subtitle?: string | undefined;
  meta?: string | undefined;
  leading?: React.ReactNode | undefined;
  trailing?: React.ReactNode | undefined;
  badge?: number | undefined;
  showChevron?: boolean | undefined;
  hideDivider?: boolean | undefined;
  unread?: boolean | undefined;
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
  badge,
  showChevron,
  hideDivider = false,
  unread = false,
  onPress,
  disabled = false,
  selected = false,
  testID,
  accessibilityLabel,
}: ListRowProps) {
  const label = accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(', ');
  const navigates = showChevron ?? Boolean(onPress);
  const state: AccessibilityState = {
    disabled: disabled || !onPress,
    selected: selected || undefined,
  };

  const body = (
    <>
      <View style={styles.leading}>{leading}</View>
      <View style={styles.copy}>
        <Text style={[styles.title, unread ? styles.unreadTitle : null]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, unread ? styles.unreadSubtitle : null]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta || badge !== undefined || navigates || trailing ? (
        <View style={styles.trailingColumn}>
          {meta ? (
            <Text style={[styles.meta, unread ? styles.unreadMeta : null]}>{meta}</Text>
          ) : (
            <View style={styles.metaSlot} />
          )}
          {badge !== undefined && badge > 0 ? (
            <Badge label={badge > 99 ? '99+' : String(badge)} tone="brand" />
          ) : (
            <View style={styles.badgeSlot} />
          )}
        </View>
      ) : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {navigates ? <Icon name="chevron-forward" tone="muted" /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        {...(testID ? { testID } : {})}
        style={[styles.row, hideDivider ? styles.last : null]}
        accessibilityLabel={label}
      >
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
        hideDivider ? styles.last : null,
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
  last: {
    borderBottomWidth: 0,
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
    width: measure.hitTarget,
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
  trailingColumn: {
    width: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.xs,
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
  unreadTitle: {
    fontWeight: typeRole.bodyStrong.fontWeight,
  },
  subtitle: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: typeRole.secondary.lineHeight,
  },
  unreadSubtitle: {
    color: color.textPrimary,
  },
  meta: {
    color: color.textMuted,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
  },
  unreadMeta: {
    color: color.brand,
  },
  metaSlot: {
    height: typeRole.meta.lineHeight,
  },
  badgeSlot: {
    height: typeRole.meta.lineHeight,
  },
});
