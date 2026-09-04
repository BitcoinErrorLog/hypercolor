/** 2026-09-02T19:00:00.000Z — pinned for every catalog render. */
export const FIXED_NOW_MS = Date.UTC(2026, 8, 2, 19, 0, 0);
export const FIXED_TIME_ISO = '2026-09-02T19:00:00.000Z';
export const FIXED_TIME_ZONE = 'UTC';
export const FIXED_LOCALE = 'en-US';

let installed = false;
const originalNow = Date.now.bind(Date);

export function catalogNow(): number {
  return FIXED_NOW_MS;
}

export function installCatalogClock(): void {
  if (installed) return;
  Date.now = catalogNow;
  installed = true;
}

export function restoreCatalogClock(): void {
  if (!installed) return;
  Date.now = originalNow;
  installed = false;
}
