import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { color, space, radius, typeRole, measure } from '../theme';

export function EnableMessagingCta({ onPress, testID }: { onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={COPY.enableEncryptedMessaging}
      style={styles.cta}
      onPress={onPress}
    >
      <Text style={styles.title}>{COPY.messagingNotEnabled}</Text>
      <Text style={styles.hint}>{COPY.approveScopesBody}</Text>
      <Text style={styles.action}>{COPY.enableEncryptedMessaging}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cta: {
    marginHorizontal: space.lg,
    marginVertical: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    minHeight: measure.hitTarget,
    borderRadius: radius.md,
    backgroundColor: color.surfaceBrand,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.brand,
    gap: space.xs,
  },
  title: { fontSize: typeRole.callout.fontSize, fontWeight: '600', color: color.textPrimary },
  hint: { fontSize: typeRole.caption.fontSize, color: color.brandMuted },
  action: {
    fontSize: typeRole.callout.fontSize,
    fontWeight: '700',
    color: color.textOnBrand,
    marginTop: space.sm,
  },
});
