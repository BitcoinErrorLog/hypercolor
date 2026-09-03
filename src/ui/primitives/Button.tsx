import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { color, measure, radius, space, typeRole } from '../../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const variantStyles: Record<
  ButtonVariant,
  { bg: string; border: string; label: string; disabledBg: string; disabledLabel: string }
> = {
  primary: {
    bg: color.brand,
    border: color.brand,
    label: color.textOnBrand,
    disabledBg: color.surfaceRaised,
    disabledLabel: color.textMuted,
  },
  secondary: {
    bg: color.surfaceRaised,
    border: color.hairlineStrong,
    label: color.textPrimary,
    disabledBg: color.surface,
    disabledLabel: color.textMuted,
  },
  destructive: {
    bg: color.dangerStrong,
    border: color.dangerStrong,
    label: color.textOnBrand,
    disabledBg: color.surfaceRaised,
    disabledLabel: color.textMuted,
  },
  ghost: {
    bg: 'transparent',
    border: 'transparent',
    label: color.brandText,
    disabledBg: 'transparent',
    disabledLabel: color.textMuted,
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  disabledReason,
  busy = false,
  testID,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const blocked = disabled || busy;
  const palette = variantStyles[variant];
  const reason = disabled && disabledReason ? disabledReason : undefined;
  const a11yState: AccessibilityState = {
    disabled: blocked,
    busy: busy || undefined,
  };

  return (
    <View style={style}>
      <Pressable
        {...(testID ? { testID } : {})}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={reason}
        accessibilityState={a11yState}
        disabled={blocked}
        onPress={onPress}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor: blocked ? palette.disabledBg : palette.bg,
            borderColor: blocked ? color.hairlineStrong : palette.border,
            opacity: pressed && !blocked ? 0.88 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={blocked ? palette.disabledLabel : palette.label} />
        ) : (
          <Text style={[styles.label, { color: blocked ? palette.disabledLabel : palette.label }]}>
            {label}
          </Text>
        )}
      </Pressable>
      {reason ? (
        <Text
          {...(testID ? { testID: `${testID}Reason` } : {})}
          accessibilityLiveRegion="polite"
          style={styles.reason}
        >
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: measure.hitTarget,
    minWidth: measure.hitTarget,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    fontWeight: typeRole.bodyStrong.fontWeight,
    textAlign: 'center',
  },
  reason: {
    marginTop: space.xs,
    color: color.textSecondary,
    fontSize: typeRole.caption.fontSize,
    lineHeight: typeRole.caption.lineHeight,
  },
});
