import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { KeyStore } from '../../services/KeyStore';
import { LinkService } from '../../services/link/LinkService';
import { PaykitLinkNative } from '../../services/link/PaykitLinkNative';
import { useAuthStore } from '../../stores/authStore';
import type { PubkyKey } from '../../types';
import { defaultRandomBytes, identitySecretHex } from '../../services/link/liveProofShared';
import { completeDebugSignup, type DebugSignupResult } from './debugSignupController';

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return String(err);
}

export function DebugSignupPanel({ title, submitLabel }: { title: string; submitLabel: string }) {
  const setAuthenticated = useAuthStore(s => s.setAuthenticated);
  const [homeserverPubky, setHomeserverPubky] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [identitySecret, setIdentitySecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebugSignupResult | null>(null);

  async function handleSubmit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const next = await completeDebugSignup(
        {
          signupWithSecret: (secret, homeserver, token) =>
            PaykitLinkNative.signupWithSecret(secret, homeserver, token),
          signinWithSecret: secret => LinkService.signinWithSecret(secret),
          adoptHarnessSession: (alias, pubky) => LinkService.adoptHarnessSession(alias, pubky),
          provisionHarnessReceiver: () => LinkService.provisionHarnessReceiver(),
          generateSecret: () => identitySecretHex(defaultRandomBytes),
        },
        {
          homeserverPubky,
          signupToken,
          identitySecret,
        },
      );
      setIdentitySecret(next.secretHex);
      setResult(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleContinue() {
    if (!result) return;
    KeyStore.setHomeserver(result.homeserverPubky);
    setAuthenticated(result.pubky as PubkyKey, result.homeserverPubky);
  }

  return (
    <View style={styles.panel} testID="debugSignupPanel">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>
        Dev/e2e only. Uses secret import and provisions the Encrypted-Link receiver. Does not open
        Pubky Ring.
      </Text>
      <TextInput
        testID="debugSignupHomeserver"
        accessibilityLabel="Debug homeserver public key"
        style={styles.input}
        value={homeserverPubky}
        onChangeText={setHomeserverPubky}
        placeholder="Homeserver public key"
        placeholderTextColor="#4b5563"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <TextInput
        testID="debugSignupToken"
        accessibilityLabel="Debug signup token"
        style={styles.input}
        value={signupToken}
        onChangeText={setSignupToken}
        placeholder="Signup token (empty to sign in)"
        placeholderTextColor="#4b5563"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <TextInput
        testID="debugSignupSecret"
        accessibilityLabel="Debug identity secret"
        style={styles.input}
        value={identitySecret}
        onChangeText={setIdentitySecret}
        placeholder="Identity secret (64 hex, optional)"
        placeholderTextColor="#4b5563"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />
      <TouchableOpacity
        testID="debugSignupSubmit"
        accessibilityLabel={submitLabel}
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={() => {
          void handleSubmit();
        }}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{submitLabel}</Text>
        )}
      </TouchableOpacity>
      {error ? (
        <Text testID="debugSignupError" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {result ? (
        <View style={styles.result}>
          <Text style={styles.status}>Encrypted messaging enabled</Text>
          <Text style={styles.resultLabel}>Pubky</Text>
          <Text
            testID="debugSignupPubky"
            accessibilityLabel="Debug signup pubky"
            style={styles.mono}
            selectable
          >
            {result.pubky}
          </Text>
          <Text style={styles.resultLabel}>Identity secret</Text>
          <Text
            testID="debugSignupSecretValue"
            accessibilityLabel="Debug signup identity secret"
            style={styles.mono}
            selectable
          >
            {result.secretHex}
          </Text>
          <TouchableOpacity
            testID="debugSignupContinue"
            accessibilityLabel="Continue after debug signup"
            style={styles.button}
            onPress={handleContinue}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#374151',
    backgroundColor: '#111111',
  },
  title: { color: '#f9fafb', fontSize: 15, fontWeight: '700' },
  hint: { color: '#6b7280', fontSize: 12, lineHeight: 18 },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    color: '#f9fafb',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  error: { color: '#fca5a5', fontSize: 13 },
  result: { gap: 8 },
  status: { color: '#86efac', fontSize: 14, fontWeight: '600' },
  resultLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  mono: { color: '#c4b5fd', fontSize: 12, fontFamily: 'monospace' },
});
