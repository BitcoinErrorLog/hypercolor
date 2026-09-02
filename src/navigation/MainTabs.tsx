import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../types';
import { MainTabBarIcon, type MainTabName } from './tabBarIcons';
import { useAuthStore } from '../stores/authStore';
import { sessionBannerVisible, useSessionStatusStore } from '../stores/sessionStatusStore';
import { StatusBanner } from '../ui/StatusBanner';
import { COPY } from '../copy/uxCopy';
import { sessionUiModel } from '../ui/sessionUi';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ChatsScreen = React.lazy(() => import('../screens/main/ChatsScreen'));
const ChannelsScreen = React.lazy(() => import('../screens/main/ChannelsScreen'));
const ContactsScreen = React.lazy(() => import('../screens/main/ContactsScreen'));
const ProfileScreen = React.lazy(() => import('../screens/main/ProfileScreen'));

function isMainTabName(name: string): name is MainTabName {
  return name === 'Chats' || name === 'Channels' || name === 'Contacts' || name === 'Profile';
}

function SessionBannerHost() {
  const kind = useSessionStatusStore(s => s.kind);
  const retryOffline = useSessionStatusStore(s => s.retryOffline);
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (!sessionBannerVisible(kind)) return null;
  const model = sessionUiModel(kind);
  return (
    <StatusBanner
      testID="appSessionBanner"
      label={model.label}
      actionLabel={kind === 'offline' ? COPY.tryAgain : COPY.enableEncryptedMessaging}
      onAction={() => {
        if (kind === 'offline') {
          void retryOffline();
          return;
        }
        nav.navigate('EnableMessaging');
      }}
    />
  );
}

export function MainTabs() {
  const pending = useSessionStatusStore(s => s.pendingRequestCount);
  const refresh = useSessionStatusStore(s => s.refresh);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) void refresh();
  }, [isAuthenticated, refresh]);

  return (
    <View style={styles.shell}>
      <SessionBannerHost />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#0a0a0a',
            borderTopColor: '#1a1a1a',
          },
          tabBarActiveTintColor: '#7c3aed',
          tabBarInactiveTintColor: '#6b7280',
          tabBarIcon: ({ focused, color, size }) =>
            isMainTabName(route.name) ? (
              <MainTabBarIcon routeName={route.name} focused={focused} color={color} size={size} />
            ) : null,
        })}
      >
        <Tab.Screen
          name="Chats"
          component={ChatsScreen as React.ComponentType}
          options={{
            tabBarLabel: 'Chats',
            tabBarButtonTestID: 'tabChats',
            ...(pending > 0 ? { tabBarBadge: pending } : {}),
            tabBarAccessibilityLabel: pending > 0 ? `Chats, ${pending} message requests` : 'Chats',
          }}
        />
        <Tab.Screen
          name="Channels"
          component={ChannelsScreen as React.ComponentType}
          options={{ tabBarLabel: 'Channels', tabBarButtonTestID: 'tabChannels' }}
        />
        <Tab.Screen
          name="Contacts"
          component={ContactsScreen as React.ComponentType}
          options={{ tabBarLabel: 'Contacts', tabBarButtonTestID: 'tabContacts' }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen as React.ComponentType}
          options={{ tabBarLabel: 'Profile', tabBarButtonTestID: 'tabProfile' }}
        />
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#0a0a0a' },
});
