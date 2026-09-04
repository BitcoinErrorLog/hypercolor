import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, measure, radius, space, typeRole } from '../../theme';
import { modalAnimationType, useReduceMotion } from '../reduceMotion';

export type SheetChromeProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children: React.ReactNode;
  testID?: string;
};

export function SheetChrome({
  visible,
  title,
  onClose,
  closeLabel = 'Close',
  children,
  testID,
}: SheetChromeProps) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalAnimationType(reduceMotion, 'fade')}
      onRequestClose={onClose}
    >
      <View {...(testID ? { testID } : {})} style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              {...(testID ? { testID: `${testID}Close` } : {})}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              style={styles.close}
            >
              <Text style={styles.closeText}>{closeLabel}</Text>
            </Pressable>
          </View>
          {children}
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
    paddingBottom: space.xl,
    maxHeight: '92%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: color.hairlineStrong,
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: measure.hitTarget,
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  title: {
    flex: 1,
    color: color.textPrimary,
    fontSize: typeRole.titleStack.fontSize,
    lineHeight: typeRole.titleStack.lineHeight,
    fontWeight: typeRole.titleStack.fontWeight,
  },
  close: {
    minWidth: measure.hitTarget,
    minHeight: measure.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: color.brandText,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    fontWeight: typeRole.bodyStrong.fontWeight,
  },
});
