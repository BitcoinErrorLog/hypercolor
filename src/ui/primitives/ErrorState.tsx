import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, typeRole } from '../../theme';
import { Button } from './Button';

export type ErrorStateProps = {
  title: string;
  body?: string;
  details?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
};

export function ErrorState({
  title,
  body,
  details,
  actionLabel,
  onAction,
  testID,
}: ErrorStateProps) {
  return (
    <View
      {...(testID ? { testID } : {})}
      style={styles.wrap}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {details ? <Text style={styles.details}>{details}</Text> : null}
      {actionLabel && onAction ? (
        <Button
          {...(testID ? { testID: `${testID}Action` } : {})}
          label={actionLabel}
          onPress={onAction}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxxl,
    backgroundColor: color.canvas,
  },
  title: {
    color: color.danger,
    fontSize: typeRole.heading.fontSize,
    lineHeight: typeRole.heading.lineHeight,
    fontWeight: typeRole.heading.fontWeight,
    textAlign: 'center',
  },
  body: {
    color: color.textPrimary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    textAlign: 'center',
  },
  details: {
    color: color.textSecondary,
    fontSize: typeRole.caption.fontSize,
    lineHeight: typeRole.caption.lineHeight,
    textAlign: 'center',
  },
});
