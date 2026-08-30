import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PaykitLinkNativeApi } from '../PaykitLinkNative';

const SOURCE = readFileSync(join(__dirname, '..', 'PaykitLinkNative.ts'), 'utf8');

function jsdocBefore(signature: string): string {
  const idx = SOURCE.indexOf(signature);
  expect(idx).toBeGreaterThan(-1);
  const before = SOURCE.slice(0, idx);
  const start = before.lastIndexOf('/**');
  expect(start).toBeGreaterThan(-1);
  return before.slice(start);
}

describe('PaykitLinkNative contract', () => {
  it('documents signinWithSecret and signupWithSecret as release-gated dev/e2e-only', () => {
    const fileDoc = SOURCE.slice(0, SOURCE.indexOf('export const LINK_NATIVE_ERROR_CODES'));
    expect(fileDoc).toMatch(/dev\/e2e-only/i);
    expect(fileDoc).toMatch(/BuildConfig\.DEBUG/);
    expect(fileDoc).toMatch(/#if DEBUG/);

    const signin = jsdocBefore(
      'signinWithSecret(identitySecretHex: string): Promise<AuthSessionResult>',
    );
    expect(signin).toMatch(/Dev\/e2e only/i);
    expect(signin).toMatch(/release native builds reject/);
    expect(signin).toMatch(/unavailable/);

    const signup = jsdocBefore('signupWithSecret(');
    expect(signup).toMatch(/Dev\/e2e only/i);
    expect(signup).toMatch(/release native builds reject/);
    expect(signup).toMatch(/unavailable/);
  });

  it('types clearAllNativeSecrets on the native API', () => {
    expect(SOURCE).toContain('clearAllNativeSecrets(): Promise<void>');
    const api: Pick<
      PaykitLinkNativeApi,
      'signinWithSecret' | 'signupWithSecret' | 'clearAllNativeSecrets'
    > = {
      signinWithSecret: async () => ({ sessionAlias: 'a', pubky: 'b' }),
      signupWithSecret: async () => ({ sessionAlias: 'a', pubky: 'b' }),
      clearAllNativeSecrets: async () => undefined,
    };
    expect(typeof api.signinWithSecret).toBe('function');
    expect(typeof api.signupWithSecret).toBe('function');
    expect(typeof api.clearAllNativeSecrets).toBe('function');
  });
});
