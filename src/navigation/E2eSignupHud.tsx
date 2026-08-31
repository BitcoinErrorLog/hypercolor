import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getE2eSignupHud, setE2eSignupHud, subscribeE2eSignupHud } from './e2eSignupResult';

/** DEV-only Maestro hooks after a deep-link / file-channel debug signup. */
export function E2eSignupHud() {
  const [state, setState] = useState(getE2eSignupHud);

  useEffect(() => subscribeE2eSignupHud(setState), []);

  if (!__DEV__ || !state) return null;

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
          onPress={() => setE2eSignupHud(null)}
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
  },
  card: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#111111',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#374151',
    gap: 8,
  },
  status: { color: '#86efac', fontSize: 14, fontWeight: '600' },
  mono: { color: '#c4b5fd', fontSize: 12, fontFamily: 'monospace' },
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
