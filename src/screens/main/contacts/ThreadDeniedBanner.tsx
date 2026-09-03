import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ConfirmSheet } from '../../../ui/contacts/ConfirmSheet';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { CONTACTS_ERROR, MIN_TARGET } from '../../../ui/contacts/tokens';
import { color, space, typeRole } from '../../../theme';

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
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.surfaceRaised,
  },
  blockedBannerText: { color: CONTACTS_ERROR, fontSize: typeRole.callout.fontSize, fontWeight: '600' },
  unblockBtn: { minHeight: MIN_TARGET, justifyContent: 'center' },
  unblockLabel: { color: color.brandText, fontSize: typeRole.body.fontSize, fontWeight: '600' },
});
