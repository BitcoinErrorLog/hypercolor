import { hapticEvent, hapticStyle, type HapticEventName } from '../theme';

type HapticDriver = {
  impactAsync?: (style: 'light' | 'medium' | 'heavy') => Promise<void>;
  notificationAsync?: (type: 'success' | 'warning' | 'error') => Promise<void>;
};

let driver: HapticDriver | null | undefined;

function loadDriver(): HapticDriver | null {
  if (driver !== undefined) return driver;
  try {
    // Optional peer. Components must not import a haptic API directly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    driver = require('expo-haptics') as HapticDriver;
  } catch {
    driver = null;
  }
  return driver;
}

/** Fire one of the three named product haptics. No-ops without the native module. */
export async function fireHaptic(event: HapticEventName): Promise<void> {
  const api = loadDriver();
  if (!api) return;
  void hapticEvent[event];
  const style = hapticStyle[event];
  if (style === 'success') {
    await api.notificationAsync?.('success');
    return;
  }
  await api.impactAsync?.(style);
}
