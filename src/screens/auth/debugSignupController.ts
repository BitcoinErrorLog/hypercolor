export type DebugSignupSession = {
  sessionAlias: string;
  pubky: string;
};

export type DebugSignupDeps = {
  signupWithSecret: (
    identitySecretHex: string,
    homeserverPublicKey: string,
    signupToken?: string,
  ) => Promise<DebugSignupSession>;
  signinWithSecret: (identitySecretHex: string) => Promise<{ pubky: string }>;
  adoptHarnessSession: (sessionAlias: string, pubky: string) => Promise<void>;
  provisionHarnessReceiver: () => Promise<{ receiverPath: string }>;
  generateSecret: () => string;
};

export type DebugSignupInput = {
  homeserverPubky: string;
  signupToken: string;
  identitySecret: string;
};

export type DebugSignupResult = {
  pubky: string;
  secretHex: string;
  homeserverPubky: string;
  receiverPath: string;
};

const IDENTITY_SECRET_HEX = /^[0-9a-f]{64}$/;

export function normalizeIdentitySecret(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isIdentitySecretHex(raw: string): boolean {
  return IDENTITY_SECRET_HEX.test(normalizeIdentitySecret(raw));
}

export function resolveDebugIdentitySecret(raw: string, generateSecret: () => string): string {
  const provided = normalizeIdentitySecret(raw);
  if (provided.length === 0) return generateSecret();
  if (!isIdentitySecretHex(provided)) {
    throw new Error('Identity secret must be 64 hex characters.');
  }
  return provided;
}

/**
 * Dev/e2e path: `signupWithSecret` / `signinWithSecret` plus receiver
 * provision. Does not open Ring. Does not persist the identity secret.
 * Caller applies `setAuthenticated` after the UI has shown pubky + secret.
 */
export async function completeDebugSignup(
  deps: DebugSignupDeps,
  input: DebugSignupInput,
): Promise<DebugSignupResult> {
  const homeserverPubky = input.homeserverPubky.trim();
  if (homeserverPubky.length === 0) {
    throw new Error('Homeserver public key is required.');
  }
  const signupToken = input.signupToken.trim();
  const secretHex = resolveDebugIdentitySecret(input.identitySecret, deps.generateSecret);
  const providedSecret = normalizeIdentitySecret(input.identitySecret).length > 0;

  let pubky: string;
  if (signupToken.length > 0) {
    try {
      const created = await deps.signupWithSecret(secretHex, homeserverPubky, signupToken);
      await deps.adoptHarnessSession(created.sessionAlias, created.pubky);
      pubky = created.pubky;
    } catch (err) {
      if (!providedSecret) throw err;
      const restored = await deps.signinWithSecret(secretHex);
      pubky = restored.pubky;
    }
  } else {
    const restored = await deps.signinWithSecret(secretHex);
    pubky = restored.pubky;
  }

  const provisioned = await deps.provisionHarnessReceiver();
  return {
    pubky,
    secretHex,
    homeserverPubky,
    receiverPath: provisioned.receiverPath,
  };
}
