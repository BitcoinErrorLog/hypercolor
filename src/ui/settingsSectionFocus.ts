import { AccessibilityInfo, findNodeHandle } from 'react-native';

export function scrollSettingsToSection(
  scroll: { scrollTo: (opts: { y: number; animated: boolean }) => void } | null,
  y: number,
  reduceMotion: boolean,
): void {
  scroll?.scrollTo({ y, animated: !reduceMotion });
}

export function focusSettingsSection(
  node: Parameters<typeof findNodeHandle>[0],
  deps: {
    findTag?: typeof findNodeHandle;
    focus?: (tag: number) => void;
  } = {},
): void {
  const findTag = deps.findTag ?? findNodeHandle;
  const focus = deps.focus ?? (tag => AccessibilityInfo.setAccessibilityFocus(tag));
  const tag = findTag(node);
  if (tag != null) focus(tag);
}
