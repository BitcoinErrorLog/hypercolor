import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { confirmReceiverTakeover } from './confirmReceiverTakeover';
import { useReceiverRoleStore } from '../stores/receiverRoleStore';
import { color, space, typeRole } from '../theme';
import { Button } from '../ui/primitives';

export function StandbyBanner(): React.ReactElement | null {
  const role = useReceiverRoleStore(s => s.role);
  const toast = useReceiverRoleStore(s => s.toast);
  const needsReenable = useReceiverRoleStore(s => s.needsReenable);
  const snoozedStandby = useReceiverRoleStore(s => s.snoozedStandby);
  const snoozedReenable = useReceiverRoleStore(s => s.snoozedReenable);
  const clearToast = useReceiverRoleStore(s => s.clearToast);
  const snoozeCurrentBanner = useReceiverRoleStore(s => s.snoozeCurrentBanner);
  const [busy, setBusy] = useState(false);

  const showStandby = role === 'standby' && !snoozedStandby;
  const showReenable = !showStandby && needsReenable && role === 'active' && !snoozedReenable;

  if (toast) {
    return (
      <View testID="takeoverToast" accessibilityRole="alert" style={styles.banner}>
        <Text style={styles.body}>{toast}</Text>
        <Button
          testID="takeoverToastDismiss"
          label={COPY.done}
          variant="secondary"
          onPress={clearToast}
        />
      </View>
    );
  }

  if (!showStandby && !showReenable) return null;

  const title = showReenable ? COPY.reenableBannerTitle : COPY.standbyBannerTitle;
  const body = showReenable ? COPY.reenableBannerBody : COPY.standbyBannerBody;
  const primary = showReenable ? COPY.reenablePrimary : COPY.standbyPrimary;
  const secondary = showReenable ? COPY.reenableSecondary : COPY.standbySecondary;
  const testID = showReenable ? 'reenableBanner' : 'standbyBanner';

  const onTakeover = () => {
    confirmReceiverTakeover({
      mode: showReenable ? 'reenable' : 'takeover',
      onBusy: setBusy,
    });
  };

  return (
    <View testID={testID} accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.actions}>
        <Button
          testID={showReenable ? 'reenableTakeover' : 'standbyTakeover'}
          label={busy ? 'Taking over…' : primary}
          busy={busy}
          disabled={busy}
          onPress={onTakeover}
        />
        <Button
          testID="standbyKeepExisting"
          label={secondary}
          variant="secondary"
          onPress={snoozeCurrentBanner}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.lg,
    backgroundColor: color.surfaceBrand,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.brand,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.bodyStrong.fontSize,
    fontWeight: '700',
  },
  body: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: 20,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
