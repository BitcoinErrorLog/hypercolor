import React, { Suspense, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert, Linking } from 'react-native';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { E2eSignupHud } from './E2eSignupHud';
import { navigationRef } from './navigationRef';
import { startE2eClipboardChannel } from './e2eClipboardChannel';
import { handleE2eDeepLink, isE2eDeepLinkUrl, linkingUrlForReactNavigation } from './e2eDeepLinks';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { useAuthStore } from '../stores/authStore';
import ThreadScreen from '../screens/main/ThreadScreen';
import ChannelScreen from '../screens/main/ChannelScreen';
import { PubkyRingAuthService } from '../services/PubkyRingAuthService';
import { GroupService, setPendingPublicJoin } from '../services/group/GroupService';
import { parsePublicChannelRef } from '../types/group';

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
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#7c3aed" />
    </View>
  );
}

export function RootNavigator() {
  const { isAuthenticated, setAuthenticated } = useAuthStore();

  const handleDeepLink = useCallback(
    async (url: string) => {
      if (url.startsWith('hypercolor://e2e/')) return;
      if (url.startsWith('hypercolor://join-public')) {
        if (!parsePublicChannelRef(url)) return;
        if (!isAuthenticated) {
          setPendingPublicJoin(url);
          return;
        }
        try {
          await GroupService.joinPublicChannel(url);
        } catch (err) {
          Alert.alert(
            'Join failed',
            err instanceof Error ? err.message : 'Could not join that public channel.',
          );
        }
        return;
      }
      if (!url.startsWith('hypercolor://ring-callback')) return;

      try {
        const { pubky, homeserver } = await PubkyRingAuthService.handleRingCallback(url);
        setAuthenticated(pubky as import('../types').PubkyKey, homeserver);
      } catch (err) {
        Alert.alert(
          'Authorization Failed',
          (err as Error).message ?? 'Could not complete pubky-ring authorization.',
        );
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
                  options={{ animation: 'slide_from_right', headerShown: false }}
                />
                <Stack.Screen
                  name="ChannelScreen"
                  component={ChannelScreen}
                  options={{ animation: 'slide_from_right', headerShown: false }}
                />
                <Stack.Screen
                  name="ContactSearch"
                  component={ContactSearchScreen}
                  options={{ animation: 'slide_from_bottom', headerShown: false }}
                />
                <Stack.Screen
                  name="MessageRequests"
                  component={MessageRequestsScreen}
                  options={{ animation: 'slide_from_right', headerShown: false }}
                />
                <Stack.Screen
                  name="Settings"
                  component={SettingsScreen}
                  options={{ animation: 'slide_from_bottom', headerShown: false }}
                />
                <Stack.Screen
                  name="EnableMessaging"
                  component={EnableMessagingScreen}
                  options={{ animation: 'slide_from_right', headerShown: false }}
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
  },
});
