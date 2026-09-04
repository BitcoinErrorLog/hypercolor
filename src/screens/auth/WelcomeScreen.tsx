import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types';
import { PubkyRingAuthService } from '../../services/PubkyRingAuthService';
import { DebugSignupPanel } from './DebugSignupPanel';
import { COPY } from '../../copy/uxCopy';
import { sanitizeError } from '../../ui/sanitizedError';
import { PubkyService } from '../../services/PubkyService';
import {
  finishConnectDelegation,
  subscribeConnectDelegationIdle,
  tryBeginConnectDelegation,
} from '../../ui/connectDelegationStart';
import { WelcomeScreenContent } from './WelcomeScreenContent';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;

export default function WelcomeScreen() {
  const nav = useNavigation<Nav>();
  const [loading, setLoading] = useState(false);
  const [connectPending, setConnectPending] = useState(false);
  const [error, setError] = useState<{ message: string; details: string | null } | null>(null);
  const [resetAvailable, setResetAvailable] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const connectTokenRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      setLoading(false);
      setConnectPending(false);
      let cancelled = false;
      void PubkyService.shouldOfferResetAfterFailedWipe().then(offer => {
        if (!cancelled) setResetAvailable(offer);
      });
      return () => {
        cancelled = true;
        const token = connectTokenRef.current;
        if (token != null) {
          finishConnectDelegation(token);
        }
      };
    }, []),
  );

  useEffect(() => {
    return subscribeConnectDelegationIdle(() => {
      setConnectPending(false);
    });
  }, []);

  async function handleConnect() {
    if (loading) return;
    const token = tryBeginConnectDelegation();
    if (token == null) {
      setConnectPending(true);
      return;
    }
    connectTokenRef.current = token;
    setConnectPending(false);
    setLoading(true);
    setError(null);
    try {
      try {
        await PubkyService.awaitSignOutWipe();
      } catch (wipeErr) {
        if (!PubkyService.isTypedSignInRestoreError(wipeErr)) {
          try {
            if (await PubkyService.shouldOfferResetAfterFailedWipe()) {
              setResetAvailable(true);
            }
          } catch {
            // Confirm still re-checks the gate; do not reveal on a failed read.
          }
        }
        throw wipeErr;
      }
      const deviceId = `hypercolor-${Date.now().toString(16)}`;
      const { url, expiresAt, generation } = await PubkyRingAuthService.requestDelegation(deviceId);
      nav.navigate('AwaitingRingAuth', { ringAuthUrl: url, expiresAt, generation });
    } catch (err) {
      if (!PubkyRingAuthService.isStaleDelegationRequestError(err)) {
        const sanitized = sanitizeError(err, COPY.couldNotStartAuthorization);
        setError({ message: sanitized.message, details: sanitized.details });
      }
    } finally {
      finishConnectDelegation(token);
      if (connectTokenRef.current === token) {
        connectTokenRef.current = null;
      }
      setLoading(false);
    }
  }

  async function handleResetConfirm() {
    if (resetBusy) return;
    setResetBusy(true);
    setError(null);
    try {
      await PubkyService.resetAppDataAfterFailedWipe();
      setResetOpen(false);
      setResetAvailable(false);
    } catch (err) {
      const sanitized = sanitizeError(err, COPY.resetAppDataFailed);
      setError({ message: sanitized.message, details: sanitized.details });
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <WelcomeScreenContent
      loading={loading}
      connectPending={connectPending}
      error={error}
      resetAvailable={resetAvailable}
      resetOpen={resetOpen}
      resetBusy={resetBusy}
      showDebugPanel={__DEV__}
      debugPanel={<DebugSignupPanel title="Debug signup" submitLabel="Debug signup" e2eSlot="a" />}
      onConnect={() => {
        void handleConnect();
      }}
      onOpenReset={() => setResetOpen(true)}
      onConfirmReset={() => {
        void handleResetConfirm();
      }}
      onDismissReset={() => {
        if (!resetBusy) setResetOpen(false);
      }}
    />
  );
}
