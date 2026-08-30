import {
  completeDebugSignup,
  isIdentitySecretHex,
  resolveDebugIdentitySecret,
  type DebugSignupDeps,
} from '../debugSignupController';

const SECRET = 'ab'.repeat(32);
const PUBKY = 'a'.repeat(52);
const HOMESERVER = 'homeserver-pubky';

function makeDeps(overrides: Partial<DebugSignupDeps> = {}): DebugSignupDeps {
  return {
    signupWithSecret: jest.fn().mockResolvedValue({ sessionAlias: 'alias-a', pubky: PUBKY }),
    signinWithSecret: jest.fn().mockResolvedValue({ pubky: PUBKY }),
    adoptHarnessSession: jest.fn().mockResolvedValue(undefined),
    provisionHarnessReceiver: jest.fn().mockResolvedValue({ receiverPath: '/pub/paykit.app/v0/' }),
    generateSecret: jest.fn().mockReturnValue(SECRET),
    ...overrides,
  };
}

describe('debugSignupController', () => {
  it('accepts a 64-character hex identity secret', () => {
    expect(isIdentitySecretHex(SECRET)).toBe(true);
    expect(isIdentitySecretHex('AB'.repeat(32))).toBe(true);
    expect(isIdentitySecretHex('ab'.repeat(31))).toBe(false);
    expect(isIdentitySecretHex('')).toBe(false);
  });

  it('generates a secret when the field is empty', () => {
    const generateSecret = jest.fn().mockReturnValue(SECRET);
    expect(resolveDebugIdentitySecret('  ', generateSecret)).toBe(SECRET);
    expect(generateSecret).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed identity secret', () => {
    expect(() => resolveDebugIdentitySecret('not-hex', () => SECRET)).toThrow(/64 hex characters/);
  });

  it('signs up, adopts the session, and provisions the receiver without Ring', async () => {
    const deps = makeDeps();
    const result = await completeDebugSignup(deps, {
      homeserverPubky: ` ${HOMESERVER} `,
      signupToken: ' token-a ',
      identitySecret: '',
    });

    expect(deps.generateSecret).toHaveBeenCalledTimes(1);
    expect(deps.signupWithSecret).toHaveBeenCalledWith(SECRET, HOMESERVER, 'token-a');
    expect(deps.adoptHarnessSession).toHaveBeenCalledWith('alias-a', PUBKY);
    expect(deps.signinWithSecret).not.toHaveBeenCalled();
    expect(deps.provisionHarnessReceiver).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      pubky: PUBKY,
      secretHex: SECRET,
      homeserverPubky: HOMESERVER,
      receiverPath: '/pub/paykit.app/v0/',
    });
  });

  it('uses a provided identity secret for signup', async () => {
    const deps = makeDeps();
    await completeDebugSignup(deps, {
      homeserverPubky: HOMESERVER,
      signupToken: 'token-a',
      identitySecret: ` ${SECRET.toUpperCase()} `,
    });

    expect(deps.generateSecret).not.toHaveBeenCalled();
    expect(deps.signupWithSecret).toHaveBeenCalledWith(SECRET, HOMESERVER, 'token-a');
  });

  it('signs in when no signup token is provided', async () => {
    const deps = makeDeps();
    await completeDebugSignup(deps, {
      homeserverPubky: HOMESERVER,
      signupToken: '',
      identitySecret: SECRET,
    });

    expect(deps.signupWithSecret).not.toHaveBeenCalled();
    expect(deps.signinWithSecret).toHaveBeenCalledWith(SECRET);
    expect(deps.adoptHarnessSession).not.toHaveBeenCalled();
    expect(deps.provisionHarnessReceiver).toHaveBeenCalledTimes(1);
  });

  it('falls back to sign-in when signup fails and a secret was provided', async () => {
    const deps = makeDeps({
      signupWithSecret: jest.fn().mockRejectedValue(new Error('already registered')),
    });
    const result = await completeDebugSignup(deps, {
      homeserverPubky: HOMESERVER,
      signupToken: 'token-a',
      identitySecret: SECRET,
    });

    expect(deps.signinWithSecret).toHaveBeenCalledWith(SECRET);
    expect(result.pubky).toBe(PUBKY);
  });

  it('does not fall back to sign-in when signup fails without a provided secret', async () => {
    const deps = makeDeps({
      signupWithSecret: jest.fn().mockRejectedValue(new Error('bad token')),
    });
    await expect(
      completeDebugSignup(deps, {
        homeserverPubky: HOMESERVER,
        signupToken: 'token-a',
        identitySecret: '',
      }),
    ).rejects.toThrow('bad token');
    expect(deps.signinWithSecret).not.toHaveBeenCalled();
  });

  it('rejects a missing homeserver public key', async () => {
    const deps = makeDeps();
    await expect(
      completeDebugSignup(deps, {
        homeserverPubky: '  ',
        signupToken: 'token-a',
        identitySecret: SECRET,
      }),
    ).rejects.toThrow('Homeserver public key is required.');
  });
});
