import React, { Suspense, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert, Linking } from 'react-native';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { useAuthStore } from '../stores/authStore';
import ThreadScreen from '../screens/main/ThreadScreen';
import ChannelScreen from '../screens/main/ChannelScreen';
import { PubkyRingAuthService } from '../services/PubkyRingAuthService';
import { PubkyService } from '../services/PubkyService';
import { MessageRouter } from '../services/MessageRouter';

const Stack = createNativeStackNavigator<RootStackParamList>();

const ContactSearchScreen = React.lazy(() => import('../screens/main/ContactSearchScreen'));
const MessageRequestsScreen = React.lazy(() => import('../screens/main/MessageRequestsScreen'));
const SettingsScreen = React.lazy(() => import('../screens/main/SettingsScreen'));
const EnableMessagingScreen = React.lazy(() => import('../screens/main/EnableMessagingScreen'));

/**
 * Deep link config for React Navigation.
 * The `hypercolor://ring-callback` URL is handled by the Linking event listener
 * below rather than mapped to a screen, because it triggers an async auth flow
 * and then conditionally navigates based on success/failure.
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
      if (!url.startsWith('hypercolor://ring-callback')) return;

      try {
        const { pubky, homeserver } = await PubkyRingAuthService.handleRingCallback(url);
        setAuthenticated(pubky as import('../types').PubkyKey, homeserver);

        // Publish KeyBinding + legacy inbox key so contacts can discover us
        await PubkyService.publishKeyBinding(pubky as import('../types').PubkyKey);
        await PubkyService.publishInboxKey(pubky as import('../types').PubkyKey);

        await MessageRouter.start();
      } catch (err) {
        Alert.alert(
          'Authorization Failed',
          (err as Error).message ?? 'Could not complete pubky-ring authorization.',
        );
      }
    },
    [setAuthenticated],
  );

  useEffect(() => {
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
    <NavigationContainer linking={linking} fallback={<LoadingFallback />}>
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
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
