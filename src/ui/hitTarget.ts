/** Minimum interactive target from the a11y contract (≥44×44). */
export const MIN_HIT_SIZE = 44;

export const HIT_SLOP_44 = { top: 12, bottom: 12, left: 12, right: 12 } as const;

export const minHitStyle = {
  minWidth: MIN_HIT_SIZE,
  minHeight: MIN_HIT_SIZE,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
};
