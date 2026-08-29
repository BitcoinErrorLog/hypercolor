import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState, type AppStateStatus } from 'react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { KeyStore } from './src/services/KeyStore';
import { LinkService, startLinkRetryDrain } from './src/services/link/LinkService';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let stopDrain: (() => void) | undefined;

    const recoverAndDrain = async () => {
      try {
        await LinkService.restorePersistedSession();
      } catch {
        // Alias is kept on network failure; auth failure is handled inside restore.
      }
      try {
        await LinkService.recoverPendingSends();
        await LinkService.drainRetries();
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

    KeyStore.initKeyStore()
      .then(async () => {
        if (disposed) return;
        await recoverAndDrain();
        if (disposed) return;
        stopDrain = startLinkRetryDrain();
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setReady(true);
      });

    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      disposed = true;
      sub.remove();
      stopDrain?.();
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return <RootNavigator />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
