import { Clipboard } from 'react-native';

export function copyText(text: string): void {
  Clipboard.setString(text);
}
