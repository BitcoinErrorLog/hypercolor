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
import { STAGING_HOMESERVER_PUBKY } from '../../services/homeserverOrigin';
import { saveE2eIdentity } from '../../navigation/e2eSignupResult';
import { completeDebugSignup, type DebugSignupResult } from './debugSignupController';
import { INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE, PubkyService } from '../../services/PubkyService';
import { COPY } from '../../copy/uxCopy';
import { isWipeWaitTimeoutError } from '../../services/paintedOwner';
import { sanitizeError } from '../../ui/sanitizedError';
import { color, space, radius, typeRole } from '../../theme';

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return String(err);
}

export function DebugSignupPanel({
  title,
  submitLabel,
  e2eSlot,
}: {
  title: string;
  submitLabel: string;
  e2eSlot?: string;
}) {
  const setAuthenticated = useAuthStore(s => s.setAuthenticated);
  const [homeserverPubky, setHomeserverPubky] = useState(STAGING_HOMESERVER_PUBKY);
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
      await PubkyService.awaitSignOutWipe();
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
      if (__DEV__ && e2eSlot) {
        saveE2eIdentity(e2eSlot, {
          pubky: next.pubky,
          secretHex: next.secretHex,
          homeserverPubky: next.homeserverPubky,
        });
      }
    } catch (err) {
      if (
        isWipeWaitTimeoutError(err) ||
        (err instanceof Error && err.message === INTERRUPTED_SIGN_OUT_MARKER_UNREADABLE)
      ) {
        setError(sanitizeError(err, COPY.signOutIncompleteTryAgain).message);
      } else {
        setError(errorMessage(err));
      }
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
        placeholderTextColor={color.textSecondary}
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
        placeholderTextColor={color.textSecondary}
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
        placeholderTextColor={color.textSecondary}
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
          <ActivityIndicator color={color.textOnBrand} />
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
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    backgroundColor: color.surface,
  },
  title: { color: color.textPrimary, fontSize: typeRole.callout.fontSize, fontWeight: '700' },
  hint: { color: color.textSecondary, fontSize: typeRole.meta.fontSize, lineHeight: 18 },
  input: {
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    color: color.textPrimary,
    fontSize: typeRole.caption.fontSize,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: color.brand,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: color.textOnBrand, fontSize: typeRole.callout.fontSize, fontWeight: '600' },
  error: { color: color.danger, fontSize: typeRole.caption.fontSize },
  result: { gap: space.sm },
  status: { color: color.success, fontSize: typeRole.secondary.fontSize, fontWeight: '600' },
  resultLabel: {
    color: color.textSecondary,
    fontSize: typeRole.meta.fontSize,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  mono: { color: color.brandMuted, fontSize: typeRole.meta.fontSize, fontFamily: 'monospace' },
});
