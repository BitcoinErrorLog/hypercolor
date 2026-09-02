import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Subscribe to OS Reduce Motion. Decorative animation must respect this. */
export function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setEnabled(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return enabled;
}

export function modalAnimationType(reduceMotion: boolean): 'none' | 'slide' | 'fade' {
  return reduceMotion ? 'none' : 'slide';
}
