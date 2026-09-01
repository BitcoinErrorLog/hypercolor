import React, { type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MainTabParamList } from '../types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
export type MainTabName = keyof MainTabParamList;

export const MAIN_TAB_ICONS: Record<MainTabName, { focused: IoniconName; unfocused: IoniconName }> =
  {
    Chats: { focused: 'chatbubble', unfocused: 'chatbubble-outline' },
    Channels: { focused: 'radio', unfocused: 'radio-outline' },
    Contacts: { focused: 'people', unfocused: 'people-outline' },
    Profile: { focused: 'person-circle', unfocused: 'person-circle-outline' },
  };

export function loadMainTabIconFont(): Promise<void> {
  return Ionicons.loadFont();
}

export function MainTabBarIcon({
  routeName,
  focused,
  color,
  size,
}: {
  routeName: MainTabName;
  focused: boolean;
  color: string;
  size: number;
}) {
  const names = MAIN_TAB_ICONS[routeName];
  return <Ionicons name={focused ? names.focused : names.unfocused} size={size} color={color} />;
}
