import { Alert } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { copyText } from '../utils/copyText';

export const COPY_MESSAGE_A11Y_ACTION = { name: 'copy' as const, label: COPY.copyMessage };

export function presentMessageCopySheet(body: string): void {
  Alert.alert(COPY.copyMessage, undefined, [
    { text: COPY.cancel, style: 'cancel' },
    { text: COPY.copyMessage, onPress: () => copyText(body) },
  ]);
}

export function handleCopyAccessibilityAction(actionName: string, body: string): void {
  if (actionName === 'copy') copyText(body);
}
