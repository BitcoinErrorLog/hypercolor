import { Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { space } from '../../theme';
import {
  COMPOSER_KAV_BEHAVIOR,
  COMPOSER_KAV_OFFSET,
  composerDockPadding,
  composerKeyboardHideEvent,
  composerKeyboardShowEvent,
  keyboardLiftHeight,
  subscribeComposerKeyboard,
} from '../composerKeyboard';

describe('composerKeyboard', () => {
  it('uses iOS padding behavior with no tab-bar offset', () => {
    expect(COMPOSER_KAV_OFFSET).toBe(0);
    if (Platform.OS === 'ios') {
      expect(COMPOSER_KAV_BEHAVIOR).toBe('padding');
    }
  });

  it('lifts by keyboard height on Android only', () => {
    const event = { endCoordinates: { height: 320 } } as KeyboardEvent;
    expect(keyboardLiftHeight(event, 'android')).toBe(320);
    expect(keyboardLiftHeight(event, 'ios')).toBe(0);
    expect(keyboardLiftHeight(undefined, 'android')).toBe(0);
  });

  it('drops the home-indicator inset while the keyboard is open', () => {
    expect(composerDockPadding(34, false)).toBe(space.lg + 34);
    expect(composerDockPadding(34, true)).toBe(space.md);
  });

  it('subscribes to platform keyboard show/hide events', () => {
    const remove = jest.fn();
    const addListener = jest.spyOn(Keyboard, 'addListener').mockReturnValue({ remove } as never);
    const onShow = jest.fn();
    const onHide = jest.fn();
    const unsubscribe = subscribeComposerKeyboard({ onShow, onHide });
    expect(addListener).toHaveBeenCalledWith(composerKeyboardShowEvent(), onShow);
    expect(addListener).toHaveBeenCalledWith(composerKeyboardHideEvent(), onHide);
    expect(composerKeyboardShowEvent()).toBe(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
    );
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(2);
    addListener.mockRestore();
  });
});
