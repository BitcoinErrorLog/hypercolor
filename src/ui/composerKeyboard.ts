import { Keyboard, Platform, type KeyboardEvent, type KeyboardEventName } from 'react-native';
import { space } from '../theme';

/**
 * Thread and Channel are root-stack screens (`headerShown: false`), so they
 * sit above MainTabs / AppShell — do not add tab-bar height to the offset.
 * SafeAreaView already owns the top inset; keep KAV offset at 0.
 *
 * iOS: KeyboardAvoidingView `padding`. Android: `adjustResize` is set on the
 * activity but edge-to-edge often ignores it, so we lift with keyboard-event
 * height instead of KAV behavior.
 */
export const COMPOSER_KAV_BEHAVIOR = Platform.OS === 'ios' ? ('padding' as const) : undefined;
export const COMPOSER_KAV_OFFSET = 0;

export function composerKeyboardShowEvent(): KeyboardEventName {
  return Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
}

export function composerKeyboardHideEvent(): KeyboardEventName {
  return Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
}

export function subscribeComposerKeyboard(handlers: {
  onShow: (event: KeyboardEvent) => void;
  onHide: (event: KeyboardEvent) => void;
}): () => void {
  const shown = Keyboard.addListener(composerKeyboardShowEvent(), handlers.onShow);
  const hidden = Keyboard.addListener(composerKeyboardHideEvent(), handlers.onHide);
  return () => {
    shown.remove();
    hidden.remove();
  };
}

export function keyboardLiftHeight(event: KeyboardEvent | undefined, platform: string): number {
  if (platform === 'ios') return 0;
  const height = event?.endCoordinates.height ?? 0;
  return height > 0 ? height : 0;
}

export function composerDockPadding(bottomInset: number, keyboardVisible: boolean): number {
  if (keyboardVisible) return space.md;
  return space.lg + Math.max(bottomInset, 0);
}
