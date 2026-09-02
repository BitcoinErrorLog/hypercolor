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
      | 'adoptAuthSession'
      | 'reconcileAdoptedSessions'
    > = {
      signinWithSecret: async () => ({ sessionAlias: 'a', pubky: 'b' }),
      signupWithSecret: async () => ({ sessionAlias: 'a', pubky: 'b' }),
      clearAllNativeSecrets: async () => undefined,
      stopAuthKeepalive: async () => undefined,
      cancelAuthFlow: async () => undefined,
      adoptAuthSession: async () => undefined,
      reconcileAdoptedSessions: async () => undefined,
    };
    expect(typeof api.signinWithSecret).toBe('function');
    expect(typeof api.signupWithSecret).toBe('function');
    expect(typeof api.clearAllNativeSecrets).toBe('function');
    expect(typeof api.stopAuthKeepalive).toBe('function');
    expect(typeof api.cancelAuthFlow).toBe('function');
    expect(typeof api.adoptAuthSession).toBe('function');
    expect(typeof api.reconcileAdoptedSessions).toBe('function');
  });

  it('requires KeyStore to persist the alias before adoptAuthSession', () => {
    expect(SOURCE).toContain('adoptAuthSession(sessionAlias: string): Promise<void>');
    expect(SOURCE).toMatch(/JS already persisted `sessionAlias` in KeyStore/);
    expect(SOURCE).toMatch(/pending → adopted/);
    const adopt = jsdocBefore('adoptAuthSession(sessionAlias: string): Promise<void>');
    expect(adopt).toMatch(/unavailable/);
    expect(adopt).toMatch(/refuses/);
  });

  it('does not treat a missing adoptAuthSession native method as a no-op', () => {
    expect(SOURCE).toContain("return invoke('adoptAuthSession', sessionAlias)");
    expect(SOURCE).not.toMatch(
      /typeof PaykitLinkModule\.adoptAuthSession !== 'function'[\s\S]*return Promise\.resolve\(\)/,
    );
  });

  it('does not treat a missing reconcileAdoptedSessions native method as a no-op', () => {
    expect(SOURCE).toContain(
      "return invoke('reconcileAdoptedSessions', knownSessionAlias ?? null)",
    );
    expect(SOURCE).not.toMatch(
      /typeof PaykitLinkModule\.reconcileAdoptedSessions !== 'function'[\s\S]*return Promise\.resolve\(\)/,
    );
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

  it('does not run boot reconcile from AppState active', () => {
    const app = readFileSync(join(__dirname, '../../../../App.tsx'), 'utf8');
    expect(app).toContain('reconcileAdoptedSessionsAtBoot');
    expect(app).toMatch(/initKeyStore\(\)[\s\S]*reconcileAdoptedSessionsAtBoot/);
    expect(app).toMatch(/initKeyStore\(\)[\s\S]*addEventListener\('change', onAppState\)/);
    expect(app).toContain("console.warn('[App] keystore unavailable')");
    expect(app).toMatch(/state === 'active'[\s\S]*recoverAndDrain\(\)/);
    const recoverStart = app.indexOf('const recoverAndDrain');
    const recoverEnd = app.indexOf('const onAppState');
    expect(recoverStart).toBeGreaterThan(-1);
    expect(recoverEnd).toBeGreaterThan(recoverStart);
    const recover = app.slice(recoverStart, recoverEnd);
    expect(recover).toContain('restorePersistedSession');
    expect(recover).not.toContain('reconcileAdoptedSessionsAtBoot');
    expect(recover).not.toContain('reconcileAdoptedSessions');
  });

  it('gates the unavailable restore fallback and adoptHarnessSession on __DEV__', () => {
    const link = readFileSync(join(__dirname, '../LinkService.ts'), 'utf8');
    expect(link).toMatch(
      /if \(__DEV__ && isLinkNativeError\(err\) && err\.code === 'unavailable'\)/,
    );
    expect(link).toMatch(
      /if \(!__DEV__\) \{[\s\S]*adoptHarnessSession is disabled in release builds/,
    );
    expect(link).toContain('deleteLinkSessionIfAlias');
    const restoreStart = link.indexOf('async restorePersistedSession');
    const bootStart = link.indexOf('async reconcileAdoptedSessionsAtBoot');
    expect(restoreStart).toBeGreaterThan(-1);
    expect(bootStart).toBeGreaterThan(restoreStart);
    const restoreFn = link.slice(restoreStart, bootStart);
    expect(restoreFn).not.toContain('reconcileNativeSessions');
    expect(restoreFn).not.toContain('reconcileAdoptedSessions');
  });
});
