import React, { type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { color, iconSize } from '../../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export type IconProps = {
  name: IconName;
  size?: number;
  tone?: 'primary' | 'secondary' | 'muted' | 'brand' | 'danger' | 'warning' | 'success' | 'onBrand';
  testID?: string;
};

const toneColor: Record<NonNullable<IconProps['tone']>, string> = {
  primary: color.textPrimary,
  secondary: color.textSecondary,
  muted: color.textMuted,
  brand: color.brand,
  danger: color.danger,
  warning: color.warningStrong,
  success: color.success,
  onBrand: color.textOnBrand,
};

export function Icon({ name, size = iconSize.md, tone = 'secondary', testID }: IconProps) {
  return (
    <Ionicons {...(testID ? { testID } : {})} name={name} size={size} color={toneColor[tone]} />
  );
}
