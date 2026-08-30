import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ChatsScreen = React.lazy(() => import('../screens/main/ChatsScreen'));
const ChannelsScreen = React.lazy(() => import('../screens/main/ChannelsScreen'));
const ContactsScreen = React.lazy(() => import('../screens/main/ContactsScreen'));
const ProfileScreen = React.lazy(() => import('../screens/main/ProfileScreen'));

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#1a1a1a',
        },
        tabBarActiveTintColor: '#7c3aed',
        tabBarInactiveTintColor: '#6b7280',
      }}
    >
      <Tab.Screen
        name="Chats"
        component={ChatsScreen as React.ComponentType}
        options={{ tabBarLabel: 'Chats', tabBarButtonTestID: 'tabChats' }}
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
  );
}
