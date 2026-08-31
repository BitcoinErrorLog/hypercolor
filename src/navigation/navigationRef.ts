import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateRoot<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  if (params === undefined) {
    navigationRef.navigate(name as never);
    return;
  }
  navigationRef.navigate({
    name,
    params,
  } as never);
}
