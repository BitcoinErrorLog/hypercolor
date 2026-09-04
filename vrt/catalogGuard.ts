export function assertCatalogAllowed(): void {
  if (
    process.env.E2E_VRT === '1' ||
    process.env.EXPO_PUBLIC_E2E_VRT === '1' ||
    process.env.NODE_ENV === 'test'
  ) {
    return;
  }
  throw new Error(
    'VRT catalog requires E2E_VRT=1 (or NODE_ENV=test). Production must not mount it.',
  );
}
