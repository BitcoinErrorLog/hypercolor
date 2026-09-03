import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, measure, space, typeRole } from '../../theme';
import { Icon } from './Icon';

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  trailing?: React.ReactNode;
  testID?: string;
};

export function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  trailing,
  testID,
}: PageHeaderProps) {
  return (
    <View {...(testID ? { testID } : {})} style={styles.wrap}>
      <View style={styles.row}>
        {onBack ? (
          <Pressable
            {...(testID ? { testID: `${testID}Back` } : {})}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            onPress={onBack}
            style={styles.back}
          >
            <Icon name="chevron-back" tone="brand" />
            <Text style={styles.backText}>{backLabel}</Text>
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
        <View style={styles.titleBlock}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>{trailing}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: color.canvas,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: measure.hitTarget,
  },
  back: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    justifyContent: 'center',
  },
  backSpacer: {
    width: measure.hitTarget,
  },
  backText: {
    color: color.brandText,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    fontWeight: typeRole.bodyStrong.fontWeight,
  },
  titleBlock: {
    flex: 1,
    gap: space.xs,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.titleStack.fontSize,
    lineHeight: typeRole.titleStack.lineHeight,
    fontWeight: typeRole.titleStack.fontWeight,
    textAlign: 'center',
  },
  subtitle: {
    color: color.textSecondary,
    fontSize: typeRole.caption.fontSize,
    lineHeight: typeRole.caption.lineHeight,
    textAlign: 'center',
  },
  trailing: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
