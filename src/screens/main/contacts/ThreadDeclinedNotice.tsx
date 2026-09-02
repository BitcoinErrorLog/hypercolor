import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { CONTACTS_MUTED } from '../../../ui/contacts/tokens';

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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  text: { color: CONTACTS_MUTED, fontSize: 14, lineHeight: 20 },
});
