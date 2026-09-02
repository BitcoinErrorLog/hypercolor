import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ConfirmSheet } from '../../../ui/contacts/ConfirmSheet';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { CONTACTS_ERROR, MIN_TARGET } from '../../../ui/contacts/tokens';

export function ThreadDeniedBanner({ onUnblock }: { onUnblock: () => void | Promise<void> }) {
  const [unblockOpen, setUnblockOpen] = useState(false);

  return (
    <>
      <View
        testID="threadBlockedBanner"
        accessibilityRole="alert"
        accessibilityLabel={CONTACTS_COPY.deniedSendMessage}
        style={styles.blockedBanner}
      >
        <Text style={styles.blockedBannerText}>{CONTACTS_COPY.deniedSendMessage}</Text>
        <TouchableOpacity
          testID="threadUnblock"
          accessibilityRole="button"
          accessibilityLabel={CONTACTS_COPY.unblockConfirm}
          onPress={() => setUnblockOpen(true)}
          style={styles.unblockBtn}
        >
          <Text style={styles.unblockLabel}>{CONTACTS_COPY.unblockConfirm}</Text>
        </TouchableOpacity>
      </View>
      <ConfirmSheet
        visible={unblockOpen}
        title={CONTACTS_COPY.unblockTitle}
        body={CONTACTS_COPY.unblockBody}
        confirmLabel={CONTACTS_COPY.unblockConfirm}
        onDismiss={() => setUnblockOpen(false)}
        onConfirm={() => {
          setUnblockOpen(false);
          void Promise.resolve(onUnblock()).catch(() => {
            // Fail-closed: the deny stays. Banner remains until a later Unblock succeeds.
          });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  blockedBanner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  blockedBannerText: { color: CONTACTS_ERROR, fontSize: 15, fontWeight: '600' },
  unblockBtn: { minHeight: MIN_TARGET, justifyContent: 'center' },
  unblockLabel: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
});
