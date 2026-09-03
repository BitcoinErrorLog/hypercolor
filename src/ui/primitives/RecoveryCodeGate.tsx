import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space, typeRole } from '../../theme';
import { Button } from './Button';
import { SheetChrome } from './SheetChrome';

export type RecoveryCodeGateProps = {
  visible: boolean;
  code: string;
  onConfirmSaved: () => void;
  onCancel: () => void;
  testID?: string;
};

export function RecoveryCodeGate({
  visible,
  code,
  onConfirmSaved,
  onCancel,
  testID,
}: RecoveryCodeGateProps) {
  return (
    <SheetChrome
      visible={visible}
      title="Save your recovery code"
      onClose={onCancel}
      closeLabel="Cancel"
      {...(testID ? { testID } : {})}
    >
      <View style={styles.body}>
        <Text style={styles.copy}>
          This code unlocks your local backup. It is not your identity key — Pubky Ring still holds
          that. You cannot casually leave until you confirm you saved it.
        </Text>
        <View style={styles.codeBox} testID={testID ? `${testID}CodeMask` : 'mask-recovery'}>
          <Text style={styles.code} accessibilityLabel="Recovery code">
            {code}
          </Text>
        </View>
        <Button
          {...(testID ? { testID: `${testID}Confirm` } : {})}
          label="I saved this code"
          onPress={onConfirmSaved}
        />
        <Button
          {...(testID ? { testID: `${testID}Cancel` } : {})}
          label="Cancel and discard"
          onPress={onCancel}
          variant="ghost"
        />
      </View>
    </SheetChrome>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  copy: {
    color: color.textSecondary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
  },
  codeBox: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    padding: space.lg,
  },
  code: {
    color: color.textPrimary,
    fontSize: typeRole.mono.fontSize,
    lineHeight: typeRole.mono.lineHeight,
    fontFamily: typeRole.mono.fontFamily,
    textAlign: 'center',
  },
});
