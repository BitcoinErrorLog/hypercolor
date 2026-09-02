import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { HIT_SLOP_44 } from './hitTarget';

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
  toggle: { minHeight: 44, justifyContent: 'center' },
  toggleText: { color: '#8f57f0', fontSize: 14, fontWeight: '600' },
  body: { color: '#808692', fontSize: 13, lineHeight: 18, marginTop: 4, fontFamily: 'monospace' },
});
