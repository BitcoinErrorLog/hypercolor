import { Alert } from 'react-native';
import { COPY } from '../copy/uxCopy';
import { copyText } from '../utils/copyText';

export const COPY_MESSAGE_A11Y_ACTION = { name: 'copy' as const, label: COPY.copyMessage };
export const TAG_MESSAGE_A11Y_ACTION = { name: 'tag' as const, label: COPY.tagMessage };

export function presentMessageCopySheet(body: string): void {
  presentMessageActionSheet(body);
}

export function presentMessageActionSheet(
  body: string | null,
  onTag?: () => void,
  onDelete?: () => void,
): void {
  const buttons: Array<{ text: string; style?: 'cancel'; onPress?: () => void }> = [
    { text: COPY.cancel, style: 'cancel' },
  ];
  if (onTag) {
    buttons.push({ text: COPY.tagMessage, onPress: onTag });
  }
  if (onDelete) {
    buttons.push({ text: COPY.unsendMessage, onPress: onDelete });
  }
  if (body) {
    buttons.push({ text: COPY.copyMessage, onPress: () => copyText(body) });
  }
  Alert.alert(COPY.copyMessage, undefined, buttons);
}

export function handleCopyAccessibilityAction(actionName: string, body: string): void {
  if (actionName === 'copy') copyText(body);
}
