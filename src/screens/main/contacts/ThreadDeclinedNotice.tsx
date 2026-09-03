import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { CONTACTS_MUTED } from '../../../ui/contacts/tokens';
import { color, space, typeRole } from '../../../theme';

export function ThreadDeclinedNotice() {
  return (
    <View
      testID="threadDeclinedNotice"
      accessibilityLabel={CONTACTS_COPY.declinedSendNotice}
      style={styles.notice}
    >
      <Text style={styles.text}>{CONTACTS_COPY.declinedSendNotice}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  text: { color: CONTACTS_MUTED, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
});
