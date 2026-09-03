import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, measure, radius, space, typeRole } from '../../theme';
import { Button } from './Button';

export type AuthQrPanelProps = {
  title: string;
  body?: string;
  qr: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  countdownLabel?: string | null;
  footer?: string | null;
  testID?: string;
};

export function AuthQrPanel({
  title,
  body,
  qr,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  countdownLabel,
  footer,
  testID,
}: AuthQrPanelProps) {
  return (
    <View {...(testID ? { testID } : {})} style={styles.wrap}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      <View
        {...(testID ? { testID: `${testID}Qr` } : {})}
        style={styles.qrFrame}
        accessibilityLabel="Authorization QR code"
      >
        <View style={styles.qrMask} testID={testID ? `${testID}QrMask` : 'mask-qr'} />
        {qr}
      </View>
      {countdownLabel ? (
        <Text
          {...(testID ? { testID: `${testID}Countdown` } : {})}
          accessibilityLiveRegion="polite"
          style={styles.countdown}
        >
          {countdownLabel}
        </Text>
      ) : null}
      <Button
        {...(testID ? { testID: `${testID}Primary` } : {})}
        label={primaryLabel}
        onPress={onPrimary}
      />
      {secondaryLabel && onSecondary ? (
        <Button
          {...(testID ? { testID: `${testID}Secondary` } : {})}
          label={secondaryLabel}
          onPress={onSecondary}
          variant="secondary"
        />
      ) : null}
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    backgroundColor: color.canvas,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.heading.fontSize,
    lineHeight: typeRole.heading.lineHeight,
    fontWeight: typeRole.heading.fontWeight,
    textAlign: 'center',
  },
  body: {
    color: color.textSecondary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    textAlign: 'center',
  },
  qrFrame: {
    alignSelf: 'center',
    width: measure.authQr,
    height: measure.authQr,
    borderRadius: radius.md,
    backgroundColor: color.qrQuietZone,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  qrMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  countdown: {
    color: color.textPrimary,
    fontSize: typeRole.numeric.fontSize,
    lineHeight: typeRole.numeric.lineHeight,
    fontWeight: typeRole.numeric.fontWeight,
    textAlign: 'center',
  },
  footer: {
    color: color.textMuted,
    fontSize: typeRole.caption.fontSize,
    lineHeight: typeRole.caption.lineHeight,
    textAlign: 'center',
  },
});
