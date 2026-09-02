import React, { Suspense, useEffect, useCallback, useState } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Linking,
  Text,
  TouchableOpacity,
} from 'react-native';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { E2eSignupHud } from './E2eSignupHud';
import { navigationRef, navigateRoot } from './navigationRef';
import { startE2eClipboardChannel } from './e2eClipboardChannel';
import { handleE2eDeepLink, isE2eDeepLinkUrl, linkingUrlForReactNavigation } from './e2eDeepLinks';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { useAuthStore } from '../stores/authStore';
import ThreadScreen from '../screens/main/ThreadScreen';
import ChannelScreen from '../screens/main/ChannelScreen';
import { PubkyRingAuthService } from '../services/PubkyRingAuthService';
import { setPendingPublicJoin } from '../services/group/GroupService';
import { parsePublicChannelRef } from '../types/group';
import { sanitizeError } from '../ui/sanitizedError';
import { COPY } from '../copy/uxCopy';
import { notifyEnableMessagingResume } from '../ui/enableMessagingResume';
import { notifyConnectAuthFeedback } from '../ui/connectAuthFeedback';
import { stackTransitionAnimation, useReduceMotion } from '../ui/reduceMotion';
import { PUBLIC_CHANNELS_ROUTE } from '../ui/exposurePaths';

const Stack = createNativeStackNavigator<RootStackParamList>();

const ContactSearchScreen = React.lazy(() => import('../screens/main/ContactSearchScreen'));
const MessageRequestsScreen = React.lazy(() => import('../screens/main/MessageRequestsScreen'));
const SettingsScreen = React.lazy(() => import('../screens/main/SettingsScreen'));
const EnableMessagingScreen = React.lazy(() => import('../screens/main/EnableMessagingScreen'));

/**
 * Deep link config for React Navigation.
 * `hypercolor://ring-callback` and __DEV__ `hypercolor://e2e/*` are handled in
 * `subscribe` / `getInitialURL` rather than mapped to a screen.
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['hypercolor://'],
  config: {
    screens: {
      Auth: {
        screens: {
          Welcome: 'welcome',
          AwaitingRingAuth: 'awaiting-auth',
        },
      },
    },
  },
  getInitialURL: async () => {
    const url = await Linking.getInitialURL();
    if (url && __DEV__ && isE2eDeepLinkUrl(url)) {
      void handleE2eDeepLink(url);
    }
    return linkingUrlForReactNavigation(url);
  },
  subscribe(listener) {
    const sub = Linking.addEventListener('url', ({ url }: { url: string }) => {
      if (__DEV__ && isE2eDeepLinkUrl(url)) {
        void handleE2eDeepLink(url);
        return;
      }
      listener(url);
    });
    return () => sub.remove();
  },
};

function LoadingFallback() {
  const [showExit, setShowExit] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowExit(true), 8_000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#7c3aed" />
      {showExit ? (
        <TouchableOpacity
          testID="navigationLoadingContinue"
          accessibilityRole="button"
          accessibilityLabel="Continue"
          onPress={() => {
            if (!navigationRef.isReady()) return;
            const authed = useAuthStore.getState().isAuthenticated;
            navigationRef.reset({
              index: 0,
              routes: [{ name: authed ? 'Main' : 'Auth' }],
            });
          }}
          style={styles.loadingContinue}
        >
          <Text style={styles.loadingContinueText}>{COPY.stillLoading}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function RootNavigator() {
  const { isAuthenticated, setAuthenticated } = useAuthStore();
  const reduceMotion = useReduceMotion();
  const stackAnimation = (kind: 'slide_from_right' | 'slide_from_bottom') =>
    stackTransitionAnimation(reduceMotion, kind);

  const handleDeepLink = useCallback(
    async (url: string) => {
      if (url.startsWith('hypercolor://e2e/')) return;
      if (url.startsWith('hypercolor://join-public')) {
        if (!parsePublicChannelRef(url)) return;
        setPendingPublicJoin(url);
        if (isAuthenticated) {
          navigateRoot(PUBLIC_CHANNELS_ROUTE.name, PUBLIC_CHANNELS_ROUTE.params);
        }
        return;
      }
      if (!url.startsWith('hypercolor://ring-callback')) return;

      try {
        const { pubky, homeserver } = await PubkyRingAuthService.handleRingCallback(url);
        setAuthenticated(pubky as import('../types').PubkyKey, homeserver);
        notifyEnableMessagingResume();
      } catch (err) {
        const sanitized = sanitizeError(err, COPY.couldNotCompleteAuthorization);
        if (sanitized.category === 'denied') {
          notifyConnectAuthFeedback('denied');
        } else if (sanitized.category === 'offline' || sanitized.category === 'network') {
          notifyConnectAuthFeedback('offline');
        }
        Alert.alert(COPY.couldNotCompleteAuthorization, sanitized.message);
      }
    },
    [isAuthenticated, setAuthenticated],
  );

  useEffect(() => {
    if (__DEV__) {
      startE2eClipboardChannel();
    }
    // Handle deep link if app was opened via one
    Linking.getInitialURL().then((url: string | null) => {
      if (url) handleDeepLink(url);
    });

    // Handle deep link while app is in foreground/background
    const sub = Linking.addEventListener('url', ({ url }: { url: string }) => {
      handleDeepLink(url);
    });

    return () => sub.remove();
  }, [handleDeepLink]);

  return (
    <NavigationContainer ref={navigationRef} linking={linking} fallback={<LoadingFallback />}>
      <View style={styles.root}>
        <Suspense fallback={<LoadingFallback />}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {isAuthenticated ? (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen
                  name="Thread"
                  component={ThreadScreen}
                  options={{ animation: stackAnimation('slide_from_right'), headerShown: false }}
                />
                <Stack.Screen
                  name="ChannelScreen"
                  component={ChannelScreen}
                  options={{ animation: stackAnimation('slide_from_right'), headerShown: false }}
                />
                <Stack.Screen
                  name="ContactSearch"
                  component={ContactSearchScreen}
                  options={{ animation: stackAnimation('slide_from_bottom'), headerShown: false }}
                />
                <Stack.Screen
                  name="MessageRequests"
                  component={MessageRequestsScreen}
                  options={{ animation: stackAnimation('slide_from_right'), headerShown: false }}
                />
                <Stack.Screen
                  name="Settings"
                  component={SettingsScreen}
                  options={{ animation: stackAnimation('slide_from_bottom'), headerShown: false }}
                />
                <Stack.Screen
                  name="EnableMessaging"
                  component={EnableMessagingScreen}
                  options={{ animation: stackAnimation('slide_from_right'), headerShown: false }}
                />
              </>
            ) : (
              <Stack.Screen name="Auth" component={AuthStack} />
            )}
          </Stack.Navigator>
        </Suspense>
        {__DEV__ ? <E2eSignupHud /> : null}
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  loadingContinue: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  loadingContinueText: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
});
