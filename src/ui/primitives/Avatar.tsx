import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { sanitizeDisplayName } from '../../lib/sanitizeDisplayName';
import { color, typeRole } from '../../theme';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export type AvatarProps = {
  name?: string | null;
  pubky?: string | null;
  size?: AvatarSize | number;
  testID?: string;
};

const avatarSize: Record<AvatarSize, number> = {
  sm: 32,
  md: 44,
  lg: 76,
  xl: 96,
};

function shortPubky(pubky: string): string {
  const cleaned = pubky.replace(/^pk:/i, '');
  if (cleaned.length <= 8) return cleaned;
  return `${cleaned.slice(0, 4)}…${cleaned.slice(-4)}`;
}

function initialsFrom(name: string | null | undefined, pubky: string | null | undefined): string {
  const trimmed = sanitizeDisplayName(name ?? '');
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }
  if (pubky) {
    const short = shortPubky(pubky).replace('…', '');
    return short.slice(0, 2).toUpperCase();
  }
  return '?';
}

function resolveSize(size: AvatarProps['size']): number {
  if (typeof size === 'number') return size;
  return avatarSize[size ?? 'md'];
}

function brandFamilyFill(pubky: string | null | undefined): string {
  if (!pubky) return color.surfaceBrand;
  let hash = 0;
  for (let i = 0; i < pubky.length; i += 1) {
    hash = (hash + pubky.charCodeAt(i) * (i + 1)) % 3;
  }
  return [color.surfaceBrand, color.brandDeep, color.brand][hash] ?? color.surfaceBrand;
}

export function Avatar({ name, pubky, size = 'md', testID }: AvatarProps) {
  const resolvedSize = resolveSize(size);
  const initials = initialsFrom(name, pubky);
  const a11y = name?.trim() || (pubky ? shortPubky(pubky) : 'Unknown contact');
  return (
    <View
      {...(testID ? { testID } : {})}
      accessibilityRole="image"
      accessibilityLabel={a11y}
      style={[
        styles.avatar,
        {
          width: resolvedSize,
          height: resolvedSize,
          borderRadius: resolvedSize / 2,
          backgroundColor: brandFamilyFill(pubky),
        },
      ]}
    >
      <Text style={[styles.initials, resolvedSize < avatarSize.md ? styles.initialsSm : null]}>
        {initials}
      </Text>
    </View>
  );
}

export function avatarFallbackLabel(
  name: string | null | undefined,
  pubky: string | null | undefined,
): string {
  return name?.trim() || (pubky ? shortPubky(pubky) : 'Unknown');
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: color.textPrimary,
    fontSize: typeRole.heading.fontSize,
    lineHeight: typeRole.heading.lineHeight,
    fontWeight: typeRole.heading.fontWeight,
  },
  initialsSm: {
    fontSize: typeRole.secondary.fontSize,
    lineHeight: typeRole.secondary.lineHeight,
  },
});
