import { PNG } from 'pngjs';
import { diffPng } from '../pixel/diff';

describe('pixel diff', () => {
  it('passes identical images and fails a dimension mismatch', () => {
    const a = new PNG({ width: 4, height: 4 });
    a.data.fill(255);
    const same = diffPng(a, a);
    expect(same.pass).toBe(true);
    expect(same.mismatched).toBe(0);
    const b = new PNG({ width: 2, height: 2 });
    b.data.fill(255);
    const mismatch = diffPng(a, b);
    expect(mismatch.pass).toBe(false);
    expect(mismatch.dimensionMismatch).toBe(true);
  });
});
