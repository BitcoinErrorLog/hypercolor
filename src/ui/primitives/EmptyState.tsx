import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, typeRole } from '../../theme';
import { Button } from './Button';

export type EmptyStateProps = {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  testID?: string;
};

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  testID,
}: EmptyStateProps) {
  return (
    <View {...(testID ? { testID } : {})} style={styles.wrap} accessibilityRole="summary">
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button
          {...(testID ? { testID: `${testID}Action` } : {})}
          label={actionLabel}
          onPress={onAction}
        />
      ) : null}
      {secondaryActionLabel && onSecondaryAction ? (
        <Button
          {...(testID ? { testID: `${testID}Secondary` } : {})}
          label={secondaryActionLabel}
          onPress={onSecondaryAction}
          variant="ghost"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxxl,
    backgroundColor: color.canvas,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.heading.fontSize,
    lineHeight: typeRole.heading.lineHeight,
    fontWeight: typeRole.heading.fontWeight,
    textAlign: 'center',
  },
  body: {
    color: color.textSecondary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    textAlign: 'center',
    marginBottom: space.sm,
  },
});
