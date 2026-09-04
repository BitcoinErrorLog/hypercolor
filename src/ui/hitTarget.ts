import { measure, space } from '../theme';

/** Minimum interactive target from the a11y contract (`measure.hitTarget`). */
export const MIN_HIT_SIZE = measure.hitTarget;

export const HIT_SLOP_44 = {
  top: space.md,
  bottom: space.md,
  left: space.md,
  right: space.md,
} as const;

export const minHitStyle = {
  minWidth: measure.hitTarget,
  minHeight: measure.hitTarget,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
};
