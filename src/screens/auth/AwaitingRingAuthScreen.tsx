import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, BackHandler, AppState } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { AuthStackParamList, PubkyKey } from '../../types';
import {
  PubkyRingAuthService,
  type PendingDelegationSnapshot,
} from '../../services/PubkyRingAuthService';
import { subscribeConnectAuthFeedback } from '../../ui/connectAuthFeedback';
import { AwaitingRingAuthScreenContent, type AwaitPhase } from './AwaitingRingAuthScreenContent';
import {
  finishConnectDelegation,
  tryBeginConnectDelegation,
} from '../../ui/connectDelegationStart';
import { useAuthStore } from '../../stores/authStore';
import { LinkService } from '../../services/link/LinkService';
import { COPY } from '../../copy/uxCopy';
import { sanitizeError } from '../../ui/sanitizedError';
import { Alert } from 'react-native';

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
 * Shown after Welcome starts a raw `pubkyauth://` flow. Completion arrives
 * from httprelay via `watchPendingApproval`, not a ring-callback deep link.
 */
export default function AwaitingRingAuthScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const setAuthenticated = useAuthStore(s => s.setAuthenticated);
  const initial = resolveHandoff(route.params);
  const [ringAuthUrl, setRingAuthUrl] = useState(initial?.url ?? '');
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? 0);
  const [confirmPubky, setConfirmPubky] = useState<string | null>(null);
  const [ringInstalled, setRingInstalled] = useState(true);
  const expiresAtRef = useRef(initial?.expiresAt ?? 0);
  const connectTokenRef = useRef<number | null>(null);
  const watchGenRef = useRef(initial?.generation ?? 0);
  const [delegationBusy, setDelegationBusy] = useState(false);
  const [phase, setPhase] = useState<AwaitPhase>(() => {
    if (!initial) return 'expired';
    return Date.now() >= initial.expiresAt ? 'expired' : 'waiting';
  });

  const handleCancel = useCallback(async () => {
    await PubkyRingAuthService.rejectFreshIdentity();
    await PubkyRingAuthService.cancelPendingDelegation();
    nav.goBack();
  }, [nav]);

  const applyAdopted = useCallback(
    (pubky: string, homeserver: string) => {
      setAuthenticated(pubky as PubkyKey, homeserver);
    },
    [setAuthenticated],
  );

  const handleProvisionFailure = useCallback(
    (err: unknown) => {
      if (!PubkyRingAuthService.isProvisionReceiverFailedError(err)) return false;
      applyAdopted(err.pubky, err.homeserver);
      Alert.alert(COPY.couldNotPublishReceiver, COPY.couldNotPublishReceiver, [
        { text: COPY.cancel, style: 'cancel' },
        {
          text: COPY.retryPublish,
          onPress: () => {
            void (async () => {
              try {
                await LinkService.provisionReceiverAfterConnect();
              } catch {
                Alert.alert(COPY.couldNotPublishReceiver, COPY.couldNotPublishReceiver);
              }
            })();
          },
        },
      ]);
      return true;
    },
    [applyAdopted],
  );

  const watchApproval = useCallback(
    async (generation: number) => {
      watchGenRef.current = generation;
      try {
        const result = await PubkyRingAuthService.watchPendingApproval();
        if (watchGenRef.current !== generation) return;
        if (result.kind === 'confirm') {
          setConfirmPubky(result.pubky);
          setPhase('confirm');
          return;
        }
        applyAdopted(result.pubky, result.homeserver);
      } catch (err) {
        if (watchGenRef.current !== generation) return;
        if (handleProvisionFailure(err)) return;
        if (PubkyRingAuthService.isStaleDelegationRequestError(err)) return;
        const sanitized = sanitizeError(err, COPY.couldNotCompleteAuthorization);
        if (
          PubkyRingAuthService.isExpiredDelegationError(err) ||
          sanitized.category === 'expired'
        ) {
          setPhase('expired');
        } else if (sanitized.category === 'denied') {
          setPhase('denied');
        } else if (sanitized.category === 'offline' || sanitized.category === 'network') {
          setPhase('offline');
        } else {
          setPhase('denied');
        }
      }
    },
    [applyAdopted, handleProvisionFailure],
  );

  const startNewDelegation = useCallback(async () => {
    const token = tryBeginConnectDelegation();
    if (token == null) return;
    connectTokenRef.current = token;
    setDelegationBusy(true);
    try {
      await PubkyRingAuthService.cancelPendingDelegation();
      const next = await PubkyRingAuthService.requestDelegation();
      nav.setParams({
        ringAuthUrl: next.url,
        expiresAt: next.expiresAt,
        generation: next.generation,
      });
      setRingAuthUrl(next.url);
      expiresAtRef.current = next.expiresAt;
      setExpiresAt(next.expiresAt);
      setConfirmPubky(null);
      setPhase(Date.now() >= next.expiresAt ? 'expired' : 'waiting');
      void watchApproval(next.generation);
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
  }, [nav, watchApproval]);

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

  const handleConfirmIdentity = useCallback(async () => {
    try {
      const result = await PubkyRingAuthService.confirmFreshIdentity();
      if (result.kind === 'adopted') {
        applyAdopted(result.pubky, result.homeserver);
      }
    } catch (err) {
      if (handleProvisionFailure(err)) return;
      setPhase('denied');
    }
  }, [applyAdopted, handleProvisionFailure]);

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

  useEffect(() => {
    void Linking.canOpenURL('pubkyauth://').then(canOpen => {
      setRingInstalled(canOpen);
    });
  }, [ringAuthUrl]);

  useEffect(() => {
    if (!initial || Date.now() >= initial.expiresAt) return;
    void watchApproval(initial.generation);
    // Mount-only: the in-memory await is already running from requestDelegation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AwaitingRingAuthScreenContent
      phase={phase}
      ringAuthUrl={ringAuthUrl}
      confirmPubky={confirmPubky}
      ringInstalled={ringInstalled}
      delegationBusy={delegationBusy}
      onCancel={() => {
        void handleCancel();
      }}
      onOpenRing={() => {
        void Linking.openURL(ringAuthUrl).catch(() => {
          setPhase('offline');
        });
      }}
      onInstallRing={() => {
        void Linking.openURL(COPY.pubkyRingPlayStoreUrl);
      }}
      onGenerateNew={() => {
        void handleGenerateNew();
      }}
      onTryAgain={() => {
        void handleTryAgain();
      }}
      onConfirmIdentity={() => {
        void handleConfirmIdentity();
      }}
    />
  );
}
