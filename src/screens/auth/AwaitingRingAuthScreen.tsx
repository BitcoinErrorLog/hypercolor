import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, BackHandler, AppState } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { AuthStackParamList } from '../../types';
import { copyText } from '../../utils/copyText';
import {
  PubkyRingAuthService,
  type PendingDelegationSnapshot,
} from '../../services/PubkyRingAuthService';
import { subscribeConnectAuthFeedback } from '../../ui/connectAuthFeedback';
import {
  AwaitingRingAuthScreenContent,
  type AwaitPhase,
} from './AwaitingRingAuthScreenContent';
import {
  finishConnectDelegation,
  tryBeginConnectDelegation,
} from '../../ui/connectDelegationStart';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'AwaitingRingAuth'>;
type Route = RouteProp<AuthStackParamList, 'AwaitingRingAuth'>;


function resolveHandoff(params: Route['params'] | undefined): PendingDelegationSnapshot | null {
  const pending = PubkyRingAuthService.getPendingDelegationSnapshot();
  const paramUrl = params?.ringAuthUrl;
  const paramExpires = params?.expiresAt;
  const paramGen = params?.generation;
  const paramsCoherent = Boolean(paramUrl) && typeof paramExpires === 'number';
  if (paramsCoherent && pending) {
    if (pending.generation > (paramGen ?? 0)) return pending;
    return {
      url: paramUrl as string,
      expiresAt: paramExpires as number,
      generation: paramGen ?? pending.generation,
    };
  }
  if (paramsCoherent) {
    return {
      url: paramUrl as string,
      expiresAt: paramExpires as number,
      generation: paramGen ?? 0,
    };
  }
  if (pending) return pending;
  return null;
}

/**
 * Shown after Welcome starts paykit-connect.
 * Completion still arrives via `hypercolor://ring-callback` in RootNavigator.
 */
export default function AwaitingRingAuthScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const initial = resolveHandoff(route.params);
  const [ringAuthUrl, setRingAuthUrl] = useState(initial?.url ?? '');
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? 0);
  const expiresAtRef = useRef(initial?.expiresAt ?? 0);
  const connectTokenRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [delegationBusy, setDelegationBusy] = useState(false);
  const [phase, setPhase] = useState<AwaitPhase>(() => {
    if (!initial) return 'expired';
    return Date.now() >= initial.expiresAt ? 'expired' : 'waiting';
  });

  function handleCopy() {
    if (!ringAuthUrl) return;
    copyText(ringAuthUrl);
    setCopied(true);
  }

  const handleCancel = useCallback(async () => {
    await PubkyRingAuthService.cancelPendingDelegation();
    nav.goBack();
  }, [nav]);

  const startNewDelegation = useCallback(async () => {
    const token = tryBeginConnectDelegation();
    if (token == null) return;
    connectTokenRef.current = token;
    setDelegationBusy(true);
    try {
      await PubkyRingAuthService.cancelPendingDelegation();
      const deviceId = `hypercolor-${Date.now().toString(16)}`;
      const next = await PubkyRingAuthService.requestDelegation(deviceId);
      nav.setParams({
        ringAuthUrl: next.url,
        expiresAt: next.expiresAt,
        generation: next.generation,
      });
      setRingAuthUrl(next.url);
      expiresAtRef.current = next.expiresAt;
      setExpiresAt(next.expiresAt);
      setCopied(false);
      setPhase(Date.now() >= next.expiresAt ? 'expired' : 'waiting');
    } catch (err) {
      if (!PubkyRingAuthService.isStaleDelegationRequestError(err)) {
        setPhase('offline');
      }
    } finally {
      finishConnectDelegation(token);
      if (connectTokenRef.current === token) {
        connectTokenRef.current = null;
      }
      setDelegationBusy(false);
    }
  }, [nav]);

  const handleGenerateNew = useCallback(async () => {
    await PubkyRingAuthService.cancelPendingDelegation();
    nav.goBack();
  }, [nav]);

  const handleTryAgain = useCallback(async () => {
    if (delegationBusy) return;
    if (phase === 'offline' || phase === 'denied' || phase === 'expired') {
      await startNewDelegation();
    }
  }, [delegationBusy, phase, startNewDelegation]);

  useEffect(() => {
    return () => {
      const token = connectTokenRef.current;
      if (token != null) {
        finishConnectDelegation(token);
        connectTokenRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void handleCancel();
      return true;
    });
    return () => sub.remove();
  }, [handleCancel]);

  useEffect(() => {
    return subscribeConnectAuthFeedback(next => {
      setPhase(next);
    });
  }, []);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const remaining = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
      setPhase('expired');
    }, remaining);
    return () => clearTimeout(timer);
  }, [phase, expiresAt]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      if (Date.now() >= expiresAtRef.current) {
        setPhase(current => (current === 'waiting' ? 'expired' : current));
      }
    });
    return () => {
      sub?.remove();
    };
  }, []);

  return (
    <AwaitingRingAuthScreenContent
      phase={phase}
      ringAuthUrl={ringAuthUrl}
      copied={copied}
      delegationBusy={delegationBusy}
      onCancel={() => {
        void handleCancel();
      }}
      onOpenRing={() => {
        void Linking.openURL(ringAuthUrl).catch(() => {
          setPhase('offline');
        });
      }}
      onCopy={handleCopy}
      onGenerateNew={() => {
        void handleGenerateNew();
      }}
      onTryAgain={() => {
        void handleTryAgain();
      }}
    />
  );
}
