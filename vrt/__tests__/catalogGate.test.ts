import { assertCatalogAllowed } from '../catalogGuard';
import { isVrtCatalogEnabled } from '../VrtCatalogRoot';

describe('VRT catalog release gate', () => {
  it('assertCatalogAllowed permits the test runner', () => {
    expect(() => assertCatalogAllowed()).not.toThrow();
  });

  it('isVrtCatalogEnabled is false unless E2E_VRT is set', () => {
    const previous = process.env.E2E_VRT;
    delete process.env.E2E_VRT;
    delete process.env.EXPO_PUBLIC_E2E_VRT;
    expect(isVrtCatalogEnabled()).toBe(false);
    if (previous !== undefined) process.env.E2E_VRT = previous;
  });
});
