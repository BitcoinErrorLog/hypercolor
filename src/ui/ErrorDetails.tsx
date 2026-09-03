import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { HIT_SLOP_44 } from './hitTarget';
import { color, space, typeRole, measure } from '../theme';

export function ErrorDetails({ details, testID }: { details: string | null; testID?: string }) {
  const [open, setOpen] = useState(false);
  if (!details) return null;
  return (
    <View testID={testID ?? 'errorDetails'}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide details' : 'Show details'}
        hitSlop={HIT_SLOP_44}
        onPress={() => setOpen(value => !value)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>{open ? 'Hide details' : 'Details'}</Text>
      </TouchableOpacity>
      {open ? (
        <Text testID="errorDetailsBody" style={styles.body} selectable>
          {details}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { minHeight: measure.hitTarget, justifyContent: 'center' },
  toggleText: { color: color.brandText, fontSize: typeRole.secondary.fontSize, fontWeight: '600' },
  body: { color: color.textSecondary, fontSize: typeRole.caption.fontSize, lineHeight: 18, marginTop: space.xs, fontFamily: 'monospace' },
});
