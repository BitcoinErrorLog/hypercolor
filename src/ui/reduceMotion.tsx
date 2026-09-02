import React, { createContext, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

const ReduceMotionContext = createContext(false);

/**
 * App-level reduced-motion policy. Decorative slide/fade/stack animations
 * must read this; semantic timers (auth TTL, debounce, protocol timeouts)
 * stay on real clocks and never use Reanimated `ReduceMotion.Never`.
 */
export function useReduceMotionEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive) setEnabled(Boolean(value));
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', next => {
      setEnabled(Boolean(next));
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return enabled;
}

export function ReduceMotionProvider({ children }: { children: React.ReactNode }) {
  const enabled = useReduceMotionEnabled();
  return <ReduceMotionContext.Provider value={enabled}>{children}</ReduceMotionContext.Provider>;
}

export function useReduceMotion(): boolean {
  return useContext(ReduceMotionContext);
}

export function stackTransitionAnimation(
  reduceMotion: boolean,
  animated: 'slide_from_right' | 'slide_from_bottom',
): 'none' | 'fade' | 'slide_from_right' | 'slide_from_bottom' {
  return reduceMotion ? 'fade' : animated;
}

export function modalAnimationType(
  reduceMotion: boolean,
  animated: 'slide' | 'fade',
): 'none' | 'slide' | 'fade' {
  return reduceMotion ? 'none' : animated;
}
