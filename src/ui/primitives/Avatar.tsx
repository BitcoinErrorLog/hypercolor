import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, typeRole } from '../../theme';

export type AvatarProps = {
  name?: string | null;
  pubky?: string | null;
  size?: number;
  testID?: string;
};

function shortPubky(pubky: string): string {
  const cleaned = pubky.replace(/^pk:/i, '');
  if (cleaned.length <= 8) return cleaned;
  return `${cleaned.slice(0, 4)}…${cleaned.slice(-4)}`;
}

function initialsFrom(name: string | null | undefined, pubky: string | null | undefined): string {
  const trimmed = name?.trim();
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

export function Avatar({ name, pubky, size = 40, testID }: AvatarProps) {
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
          width: size,
          height: size,
          borderRadius: Math.min(size / 2, radius.xxl),
        },
      ]}
    >
      <Text style={[styles.initials, size < 36 ? styles.initialsSm : null]}>{initials}</Text>
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
    backgroundColor: color.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: color.brandMuted,
    fontSize: typeRole.heading.fontSize,
    lineHeight: typeRole.heading.lineHeight,
    fontWeight: typeRole.heading.fontWeight,
  },
  initialsSm: {
    fontSize: typeRole.secondary.fontSize,
    lineHeight: typeRole.secondary.lineHeight,
  },
});
