import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../../copy/uxCopy';
import { color, measure, radius, space, typeRole } from '../../theme';
import { HIT_SLOP_44 } from '../hitTarget';
import { modalAnimationType, useReduceMotion } from '../reduceMotion';
import { requestScanCameraPermission, type ScanCameraPermission } from './scanCameraPermission';

export function ContactQrScanner({
  visible,
  permission: permissionOverride,
  error,
  onClose,
  onBarcode,
  onManualFallback,
}: {
  visible: boolean;
  permission?: ScanCameraPermission;
  error: string | null;
  onClose: () => void;
  onBarcode: (raw: string) => void;
  onManualFallback: () => void;
}): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const [resolved, setResolved] = useState<ScanCameraPermission | 'checking'>('checking');

  useEffect(() => {
    if (permissionOverride || !visible) return;
    let cancelled = false;
    void requestScanCameraPermission().then(next => {
      if (!cancelled) setResolved(next);
    });
    return () => {
      cancelled = true;
    };
  }, [permissionOverride, visible]);

  const permission = permissionOverride ?? resolved;

  const denied = permission === 'denied';

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion, 'fade')}
      onRequestClose={onClose}
    >
      <View
        style={styles.backdrop}
        testID="contactScanner"
        accessibilityViewIsModal
        accessibilityLabel="Contact QR scanner"
        {...{ onDeliverScan: onBarcode }}
      >
        <View style={styles.sheet}>
          <Text style={styles.title} accessibilityRole="header">
            {COPY.scanQr}
          </Text>
          {denied ? (
            <>
              <Text
                testID="contactScanError"
                accessibilityRole="alert"
                accessibilityLabel={COPY.cameraPermissionDenied}
                style={styles.error}
              >
                {COPY.cameraPermissionDenied}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={COPY.enterPubkyManually}
                hitSlop={HIT_SLOP_44}
                onPress={onManualFallback}
                style={styles.action}
              >
                <Text style={styles.actionLabel}>{COPY.enterPubkyManually}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.viewfinder} accessibilityLabel="Point the camera at a pubky QR" />
              {error ? (
                <Text
                  testID="contactScanError"
                  accessibilityRole="alert"
                  accessibilityLabel={error}
                  style={styles.error}
                >
                  {error}
                </Text>
              ) : (
                <Text style={styles.hint}>Point this device at a pubky QR.</Text>
              )}
            </>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.cancel}
            hitSlop={HIT_SLOP_44}
            onPress={onClose}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{COPY.cancel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: color.overlay,
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    paddingTop: space.lg,
    gap: space.lg,
  },
  title: {
    color: color.textPrimary,
    fontSize: typeRole.titleStack.fontSize,
    lineHeight: typeRole.titleStack.lineHeight,
    fontWeight: typeRole.titleStack.fontWeight,
  },
  viewfinder: {
    alignSelf: 'center',
    width: measure.authQr,
    height: measure.authQr,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.brand,
    backgroundColor: color.canvas,
  },
  hint: {
    color: color.textSecondary,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: typeRole.secondary.lineHeight,
  },
  error: {
    color: color.dangerStrong,
    fontSize: typeRole.secondary.fontSize,
    lineHeight: typeRole.secondary.lineHeight,
  },
  action: {
    minHeight: measure.hitTarget,
    justifyContent: 'center',
  },
  actionLabel: {
    color: color.brandText,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
