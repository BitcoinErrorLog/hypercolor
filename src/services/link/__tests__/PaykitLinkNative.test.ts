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

  it('canonicalizes startAuthFlow capabilities before the native invoke', () => {
    expect(SOURCE).toContain("import { formatAuthFlowCapabilities } from '../../types/link'");
    expect(SOURCE).toMatch(/startAuthFlow\([\s\S]*formatAuthFlowCapabilities\(capabilities\)/);
    expect(SOURCE).not.toMatch(/invoke\('startAuthFlow', capabilities,/);
  });

  it('types clearAllNativeSecrets on the native API', () => {
    expect(SOURCE).toContain('clearAllNativeSecrets(): Promise<void>');
    const api: Pick<
      PaykitLinkNativeApi,
      | 'signinWithSecret'
      | 'signupWithSecret'
      | 'clearAllNativeSecrets'
      | 'stopAuthKeepalive'
      | 'cancelAuthFlow'
    > = {
      signinWithSecret: async () => ({ sessionAlias: 'a', pubky: 'b' }),
      signupWithSecret: async () => ({ sessionAlias: 'a', pubky: 'b' }),
      clearAllNativeSecrets: async () => undefined,
      stopAuthKeepalive: async () => undefined,
      cancelAuthFlow: async () => undefined,
    };
    expect(typeof api.signinWithSecret).toBe('function');
    expect(typeof api.signupWithSecret).toBe('function');
    expect(typeof api.clearAllNativeSecrets).toBe('function');
    expect(typeof api.stopAuthKeepalive).toBe('function');
    expect(typeof api.cancelAuthFlow).toBe('function');
  });

  it('treats a missing stopAuthKeepalive native method as a no-op', () => {
    expect(SOURCE).toContain('stopAuthKeepalive(flowId: string): Promise<void>');
    expect(SOURCE).toMatch(
      /typeof PaykitLinkModule\.stopAuthKeepalive !== 'function'[\s\S]*return Promise\.resolve\(\)/,
    );
  });

  it('treats a missing cancelAuthFlow native method as a no-op', () => {
    expect(SOURCE).toContain('cancelAuthFlow(flowId: string): Promise<void>');
    expect(SOURCE).toMatch(
      /typeof PaykitLinkModule\.cancelAuthFlow !== 'function'[\s\S]*return Promise\.resolve\(\)/,
    );
  });
});
