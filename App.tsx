import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  AppState,
  Linking,
  LogBox,
  Text,
  TouchableOpacity,
  type AppStateStatus,
} from 'react-native';

if (__DEV__) {
  LogBox.ignoreAllLogs(true);
}
import { RootNavigator } from './src/navigation/RootNavigator';
import { startE2eClipboardChannel } from './src/navigation/e2eClipboardChannel';
import { handleE2eDeepLink } from './src/navigation/e2eDeepLinks';
import { loadMainTabIconFont } from './src/navigation/tabBarIcons';
import { KeyStore } from './src/services/KeyStore';
import { LinkService, startLinkRetryDrain } from './src/services/link/LinkService';
import { hydratePersistedAuth } from './src/stores/hydrateAuthSession';
import { ReduceMotionProvider } from './src/ui/reduceMotion';

if (__DEV__) {
  startE2eClipboardChannel();
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [allowContinue, setAllowContinue] = useState(false);
  const initEpochRef = useRef(0);

  useEffect(() => {
    // Dev-only, env-gated live-proof auto-runner. EXPO_PUBLIC_LIVEPROOF is
    // "<homeserverPubky>,<tokenA>,<tokenB>[,<tokenC>]". Expo inlines
    // EXPO_PUBLIC_* at bundle time. EXPO_PUBLIC_LIVEPROOF_ROWS selects P0–P6;
    // EXPO_PUBLIC_LIVEPROOF_NATIVE=1 also runs the native diagnostic. Logs
    // are redacted so tokens and identity secrets never hit the console.
    if (__DEV__ && process.env.EXPO_PUBLIC_LIVEPROOF) {
      const [homeserverPubky = '', signupTokenA = '', signupTokenB = '', signupTokenC = ''] =
        process.env.EXPO_PUBLIC_LIVEPROOF.split(',');
      const rowsRaw = process.env.EXPO_PUBLIC_LIVEPROOF_ROWS;
      const includeNative = process.env.EXPO_PUBLIC_LIVEPROOF_NATIVE === '1';
      void import('./src/services/link/liveProofRun').then(
        ({ parseNamedLiveProofRows, redactLiveProofForLog, runNamedLiveProofs }) => {
          const rows = parseNamedLiveProofRows(rowsRaw);
          if (includeNative && !rows.includes('native')) rows.unshift('native');
          const secrets = [signupTokenA, signupTokenB, signupTokenC].filter(
            token => token.length > 0,
          );
          return runNamedLiveProofs(
            {
              homeserverPubky,
              signupTokenA,
              signupTokenB,
              ...(signupTokenC.length > 0 ? { signupTokenC } : {}),
              rows,
            },
            {
              openWalletUri: uri => Linking.openURL(uri),
              canOpenWalletUri: uri => Linking.canOpenURL(uri),
              openAuthUrl: url => Linking.openURL(url),
            },
          ).then(result =>
            console.log(
              '[liveproof] REPORT',
              redactLiveProofForLog(JSON.stringify(result), secrets),
            ),
          );
        },
      );
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let stopDrain: (() => void) | undefined;
    const myEpoch = ++initEpochRef.current;

    // Foreground notification strategy: see docs/NOTIFICATIONS.md.
    // AppState 'active' restarts the retry drain and syncs the Encrypted-Link inbox.
    const recoverAndDrain = async () => {
      try {
        await LinkService.restorePersistedSession();
      } catch {
        // Alias is kept on network failure; auth failure is handled inside restore.
      }
      try {
        await LinkService.recoverPendingSends();
        await LinkService.drainRetries();
        if (LinkService.hasSession()) {
          await LinkService.syncInbox();
        }
      } catch (err) {
        console.warn('[App] link send recovery failed:', err);
      }
    };

    const onAppState = (state: AppStateStatus) => {
      if (disposed) return;
      if (state === 'active') {
        stopDrain?.();
        stopDrain = startLinkRetryDrain();
        void recoverAndDrain();
      } else {
        stopDrain?.();
        stopDrain = undefined;
      }
    };

    const markReady = () => {
      if (!disposed && myEpoch === initEpochRef.current) setReady(true);
    };
    const iconFontReady = loadMainTabIconFont().catch(err => {
      console.warn('[App] tab icon font failed to load:', err);
    });
    const afterIconFont = (next: () => void) => {
      void iconFontReady.finally(next);
    };
    // Keychain / keystore2 can hang forever on some emulators (never
    // resolve or reject). Fail-open to Welcome; do not invent a crypto path.
    const readyTimer = setTimeout(() => afterIconFont(markReady), 4000);
    const continueTimer = setTimeout(() => {
      if (!disposed) setAllowContinue(true);
    }, 4000);
    KeyStore.initKeyStore()
      .then(async () => {
        try {
          await LinkService.reconcileAdoptedSessionsAtBoot();
        } catch {
          // Boot reconcile is fail-closed; never log aliases or store contents.
        }
        if (disposed || myEpoch !== initEpochRef.current) return;
        try {
          await hydratePersistedAuth();
        } catch {
          // Auth hydrate is best-effort; Welcome is still the right screen.
        }
        if (disposed || myEpoch !== initEpochRef.current) return;
        void recoverAndDrain();
        stopDrain = startLinkRetryDrain();
        afterIconFont(markReady);
      })
      .catch(() => afterIconFont(markReady))
      .finally(() => clearTimeout(readyTimer));

    if (__DEV__) {
      startE2eClipboardChannel();
    }

    const sub = AppState.addEventListener('change', onAppState);
    const linkingSub = __DEV__
      ? Linking.addEventListener('url', ({ url }: { url: string }) => {
          void handleE2eDeepLink(url);
        })
      : null;
    if (__DEV__) {
      void Linking.getInitialURL().then((url: string | null) => {
        if (url) void handleE2eDeepLink(url);
      });
    }
    return () => {
      disposed = true;
      clearTimeout(readyTimer);
      clearTimeout(continueTimer);
      sub.remove();
      linkingSub?.remove();
      stopDrain?.();
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7c3aed" />
        {allowContinue ? (
          <TouchableOpacity
            testID="appSplashContinue"
            accessibilityRole="button"
            accessibilityLabel="Continue"
            onPress={() => {
              initEpochRef.current += 1;
              setReady(true);
            }}
            style={styles.splashContinue}
          >
            <Text style={styles.splashContinueText}>Continue</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <ReduceMotionProvider>
      <RootNavigator />
    </ReduceMotionProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  splashContinue: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  splashContinueText: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
});
