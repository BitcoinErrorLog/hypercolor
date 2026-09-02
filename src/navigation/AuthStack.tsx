import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../types';
import WelcomeScreen from '../screens/auth/WelcomeScreen';
import AwaitingRingAuthScreen from '../screens/auth/AwaitingRingAuthScreen';
import { stackTransitionAnimation, useReduceMotion } from '../ui/reduceMotion';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  const reduceMotion = useReduceMotion();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: stackTransitionAnimation(reduceMotion, 'slide_from_right'),
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="AwaitingRingAuth" component={AwaitingRingAuthScreen} />
    </Stack.Navigator>
  );
}
