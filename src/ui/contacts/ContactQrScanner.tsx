import { CameraView } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../../copy/uxCopy';
import { parseContactQrPayload } from '../../utils/contactQrPayload';
import { color, measure, radius, space, typeRole } from '../../theme';
import { HIT_SLOP_44 } from '../hitTarget';
import { modalAnimationType, useReduceMotion } from '../reduceMotion';
import { requestScanCameraPermission, type ScanCameraPermission } from './scanCameraPermission';

function GrantedScanSurface({
  error,
  onBarcode,
}: {
  error: string | null;
  onBarcode: (raw: string) => void;
}): React.ReactElement {
  const [torch, setTorch] = useState(false);
  const [scanning, setScanning] = useState(true);
  const consumedRef = useRef(false);

  const handleBarcode = useCallback(
    (raw: string) => {
      if (consumedRef.current) return;
      const parsed = parseContactQrPayload(raw);
      if (!parsed.ok) {
        onBarcode(raw);
        return;
      }
      consumedRef.current = true;
      setScanning(false);
      onBarcode(raw);
    },
    [onBarcode],
  );

  const onBarcodeScanned = useCallback(
    (result: { data: string }) => {
      handleBarcode(result.data);
    },
    [handleBarcode],
  );

  return (
    <>
      <View style={styles.viewfinder} accessibilityLabel="Point the camera at a pubky QR">
        {scanning ? (
          <CameraView
            testID="contactScannerCamera"
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcodeScanned}
          />
        ) : null}
      </View>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Torch"
        hitSlop={HIT_SLOP_44}
        onPress={() => setTorch(on => !on)}
        style={styles.action}
      >
        <Text style={styles.actionLabel}>{torch ? 'Torch off' : 'Torch on'}</Text>
      </Pressable>
    </>
  );
}

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

  const testScanHook =
    typeof __DEV__ !== 'undefined' && __DEV__
      ? {
          onDeliverScan: (raw: string) => {
            onBarcode(raw);
          },
        }
      : {};

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
        {...testScanHook}
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
          ) : visible && permission === 'granted' ? (
            <GrantedScanSurface error={error} onBarcode={onBarcode} />
          ) : (
            <>
              <View style={styles.viewfinder} accessibilityLabel="Point the camera at a pubky QR" />
              <Text style={styles.hint}>Point this device at a pubky QR.</Text>
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
    overflow: 'hidden',
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
