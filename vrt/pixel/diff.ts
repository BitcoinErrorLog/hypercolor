import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const DIFF_THRESHOLD = 0.1;
export const MAX_CHANGED_PERCENT = 0.1;

export type DiffResult = {
  readonly width: number;
  readonly height: number;
  readonly mismatched: number;
  readonly changedPercent: number;
  readonly dimensionMismatch: boolean;
  readonly pass: boolean;
  readonly diff: PNG | null;
};

export function diffPng(baseline: PNG, candidate: PNG): DiffResult {
  if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
    return {
      width: candidate.width,
      height: candidate.height,
      mismatched: Number.POSITIVE_INFINITY,
      changedPercent: 100,
      dimensionMismatch: true,
      pass: false,
      diff: null,
    };
  }
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const mismatched = pixelmatch(
    baseline.data,
    candidate.data,
    diff.data,
    baseline.width,
    baseline.height,
    {
      threshold: DIFF_THRESHOLD,
      includeAA: false,
    },
  );
  const changedPercent = (mismatched / (baseline.width * baseline.height)) * 100;
  return {
    width: baseline.width,
    height: baseline.height,
    mismatched,
    changedPercent,
    dimensionMismatch: false,
    pass: changedPercent <= MAX_CHANGED_PERCENT,
    diff,
  };
}
