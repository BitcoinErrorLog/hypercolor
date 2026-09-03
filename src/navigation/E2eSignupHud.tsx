import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  applyE2eSignupContinue,
  getE2eSignupHud,
  subscribeE2eSignupHud,
} from './e2eSignupResult';
import { color, space, radius, typeRole } from '../theme';

/** DEV-only Maestro hooks after a deep-link / file-channel debug signup. */
export function E2eSignupHud() {
  const [state, setState] = useState(getE2eSignupHud);

  useEffect(() => subscribeE2eSignupHud(setState), []);

  if (!__DEV__ || !state) return null;

  if (state.error) {
    return (
      <View style={styles.wrap} testID="debugSignupErrorHud" pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.errorTitle}>Debug signup failed</Text>
          <Text testID="debugSignupError" style={styles.errorBody} numberOfLines={4}>
            {state.pubky}
          </Text>
          <TouchableOpacity
            testID="debugSignupErrorDismiss"
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={styles.button}
            onPress={() => applyE2eSignupContinue(state)}
          >
            <Text style={styles.buttonText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="debugSignupResultHud" pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.status}>Encrypted messaging enabled</Text>
        <Text
          testID="debugSignupPubky"
          accessibilityLabel="Debug signup pubky"
          style={styles.mono}
          selectable
          numberOfLines={1}
        >
          {state.pubky}
        </Text>
        <Text
          testID="debugSignupSecretValue"
          accessibilityLabel="Debug signup identity secret"
          style={styles.mono}
          selectable
          numberOfLines={1}
        >
          {state.secretHex}
        </Text>
        <TouchableOpacity
          testID="debugSignupContinue"
          accessibilityLabel="Continue after debug signup"
          style={styles.button}
          onPress={() => applyE2eSignupContinue(state)}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 88,
    zIndex: 50,
    elevation: Platform.OS === 'android' ? 24 : 0,
  },
  card: {
    margin: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    gap: space.sm,
    elevation: Platform.OS === 'android' ? 24 : 0,
  },
  status: {
    color: color.success,
    fontSize: typeRole.secondary.fontSize,
    fontWeight: '600',
  },
  mono: {
    color: color.brandMuted,
    fontSize: typeRole.mono.fontSize,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: color.brand,
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  buttonText: {
    color: color.textOnBrand,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
  errorTitle: {
    color: color.danger,
    fontSize: typeRole.secondary.fontSize,
    fontWeight: '600',
  },
  errorBody: {
    color: color.danger,
    fontSize: typeRole.mono.fontSize,
  },
});
