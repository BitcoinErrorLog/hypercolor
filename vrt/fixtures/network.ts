function forbidden(kind: string): never {
  throw new Error(`VRT catalog forbids ${kind}. Fixtures are local and synthetic.`);
}

let installed = false;
const originalFetch = globalThis.fetch;

export function installCatalogNetworkGuard(): void {
  if (installed) return;
  globalThis.fetch = (async () => forbidden('fetch')) as typeof fetch;
  installed = true;
}

export function restoreCatalogNetworkGuard(): void {
  if (!installed) return;
  globalThis.fetch = originalFetch;
  installed = false;
}
