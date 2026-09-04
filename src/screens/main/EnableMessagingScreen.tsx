import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, AppState, BackHandler, type AppStateStatus } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types';
import { LinkService } from '../../services/link/LinkService';
import { copyText } from '../../utils/copyText';
import { ENABLE_AUTH_TTL_MS } from '../../copy/uxCopy';
import { subscribeEnableMessagingResume } from '../../ui/enableMessagingResume';
import {
  createEnableMessagingController,
  INITIAL_ENABLE_MESSAGING_STATE,
  type EnableMessagingController,
  type EnableMessagingState,
} from './enableMessagingController';
import {
  EnableMessagingScreenContent,
  enableStatusLabel,
  formatEnableRemaining,
} from './EnableMessagingScreenContent';

export { enableStatusLabel, formatEnableRemaining };

type Nav = NativeStackNavigationProp<RootStackParamList, 'EnableMessaging'>;

export default function EnableMessagingScreen() {
  const nav = useNavigation<Nav>();
  const controllerRef = useRef<EnableMessagingController | null>(null);
  const [state, setState] = useState<EnableMessagingState>(INITIAL_ENABLE_MESSAGING_STATE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const authorizingClock = state.phase === 'authorizing' && state.authorizingStartedAt != null;

  useEffect(() => {
    const controller = createEnableMessagingController({
      getEnableStatus: () => LinkService.getEnableStatus(),
      enable: () => LinkService.enable(),
      openUrl: url => Linking.openURL(url),
      copyText,
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setState);
    void controller.start();
    return () => {
      unsubscribe();
      controller.cancel();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!authorizingClock) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [authorizingClock, state.authorizingStartedAt]);

  const remainingLabel =
    authorizingClock && state.authorizingStartedAt != null
      ? formatEnableRemaining(
          Math.max(0, Math.ceil((state.authorizingStartedAt + ENABLE_AUTH_TTL_MS - nowMs) / 1000)),
        )
      : null;

  const handleDone = useCallback(() => {
    if (state.phase !== 'success') {
      controllerRef.current?.cancel();
    }
    nav.goBack();
  }, [nav, state.phase]);

  const handleOpenChats = useCallback(() => {
    nav.reset({
      index: 0,
      routes: [{ name: 'Main', params: { screen: 'Chats' } }],
    });
  }, [nav]);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') {
        void controllerRef.current?.onAppActive();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    const unsubResume = subscribeEnableMessagingResume(() => {
      void controllerRef.current?.onAppActive();
    });
    return () => {
      sub.remove();
      unsubResume();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleDone();
      return true;
    });
    return () => sub.remove();
  }, [handleDone]);

  const handlePrimary = useCallback(() => {
    if (state.phase === 'success') {
      handleOpenChats();
      return;
    }
    if (state.phase === 'authorizing') {
      void controllerRef.current?.openRing();
      return;
    }
    if (state.phase === 'denied' || state.phase === 'error' || state.phase === 'session-offline') {
      void controllerRef.current?.retry();
      return;
    }
    void controllerRef.current?.beginAuth();
  }, [handleOpenChats, state.phase]);

  return (
    <EnableMessagingScreenContent
      state={state}
      remainingLabel={remainingLabel}
      onBack={handleDone}
      onPrimary={handlePrimary}
      onSecondary={handleDone}
      onCopyAuth={() => {
        controllerRef.current?.copyAuthorizationUrl();
      }}
    />
  );
}
