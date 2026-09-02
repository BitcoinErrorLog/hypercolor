import {
  createEnableMessagingController,
  isAutoOpenableAuthUrl,
  type EnableMessagingDeps,
} from '../enableMessagingController';
import type { LinkEnableFlow } from '../../../services/link/LinkService';
import { COPY, ENABLE_AUTH_TTL_MS } from '../../../copy/uxCopy';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeps(overrides: Partial<EnableMessagingDeps> = {}): EnableMessagingDeps {
  return {
    getEnableStatus: jest.fn().mockResolvedValue('needs-enable'),
    enable: jest.fn(),
    openUrl: jest.fn().mockResolvedValue(undefined),
    copyText: jest.fn(),
    ...overrides,
  };
}

function authFlow(overrides: Partial<LinkEnableFlow> = {}): LinkEnableFlow {
  return {
    authorizationUrl: 'pubkyauth://grant',
    awaitEnabled: jest.fn().mockResolvedValue({
      pubky: 'a'.repeat(52),
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise',
    }),
    cancel: jest.fn(),
    releaseKeepalive: jest.fn(),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function beginAuthorizing(
  controller: ReturnType<typeof createEnableMessagingController>,
): Promise<{ started: Promise<void> }> {
  await controller.start();
  const started = controller.beginAuth();
  await flush();
  return { started };
}

describe('enableMessagingController', () => {
  it('surfaces native-missing without starting a Ring flow', async () => {
    const deps = makeDeps({ getEnableStatus: jest.fn().mockResolvedValue('native-missing') });
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState().phase).toBe('native-missing');
    expect(controller.getState().message).toBe(COPY.messagingUnavailable);
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it('surfaces already-enabled as success without starting a Ring flow', async () => {
    const deps = makeDeps({ getEnableStatus: jest.fn().mockResolvedValue('enabled') });
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState().phase).toBe('success');
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it('waits on needs-enable without auto-starting auth', async () => {
    const deps = makeDeps();
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState().phase).toBe('needs-enable');
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it('surfaces session-offline without auto-starting auth', async () => {
    const deps = makeDeps({ getEnableStatus: jest.fn().mockResolvedValue('session-offline') });
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState().phase).toBe('session-offline');
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it('presents the authorization URL, auto-opens Ring, and waits for awaitEnabled', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);

    const { started } = await beginAuthorizing(controller);

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        phase: 'authorizing',
        authorizationUrl: 'pubkyauth://grant',
      }),
    );
    expect(deps.openUrl).toHaveBeenCalledWith('pubkyauth://grant');

    pending.resolve({
      pubky: 'z'.repeat(52),
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise-pk',
    });
    await started;

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        phase: 'success',
        pubky: 'z'.repeat(52),
        receiverPath: 'hypercolor/wallet',
      }),
    );
  });

  it('records a declined grant as denied without the raw error string', async () => {
    const flow = authFlow({
      awaitEnabled: jest.fn().mockRejectedValue(new Error('ring denied')),
    });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);

    await controller.start();
    await controller.beginAuth();

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        phase: 'denied',
        message: COPY.authorizationDeclinedBody,
      }),
    );
    expect(controller.getState().message).not.toContain('ring denied');
  });

  it('stays authorizing when auto-open fails because Ring is already in the back stack', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const deps = makeDeps({
      enable: jest.fn().mockResolvedValue(flow),
      openUrl: jest.fn().mockRejectedValue(new Error('Activity already on stack')),
    });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);

    expect(controller.getState().phase).toBe('authorizing');
    expect(controller.getState().authorizationUrl).toBe('pubkyauth://grant');
    expect(controller.getState().message).toBe(COPY.waitingForRingBody);

    pending.resolve({
      pubky: 'z'.repeat(52),
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise-pk',
    });
    await started;
    expect(controller.getState().phase).toBe('success');
  });

  it('opens and copies the authorization URL', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);

    await controller.openRing();
    controller.copyAuthorizationUrl();

    expect(deps.openUrl).toHaveBeenCalledWith('pubkyauth://grant');
    expect(deps.copyText).toHaveBeenCalledWith('pubkyauth://grant');
    expect(controller.getState().copied).toBe(true);

    controller.cancel();
    expect(flow.cancel).toHaveBeenCalled();
    pending.reject(new Error('cancelled'));
    await started.catch(() => undefined);
  });

  it('does not apply a late success after cancel', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);

    controller.cancel();
    pending.resolve({
      pubky: 'z'.repeat(52),
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise-pk',
    });
    await started;

    expect(controller.getState().phase).toBe('authorizing');
    expect(flow.cancel).toHaveBeenCalled();
  });

  it('does not auto-open https authorization URLs and stays authorizing', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const httpsUrl = 'https://evil.example/auth?secret=leak';
    const flow = authFlow({
      authorizationUrl: httpsUrl,
      awaitEnabled: jest.fn(() => pending.promise),
    });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);

    expect(controller.getState().phase).toBe('authorizing');
    expect(controller.getState().authorizationUrl).toBe(httpsUrl);
    expect(deps.openUrl).not.toHaveBeenCalled();

    await controller.openRing();
    expect(deps.openUrl).not.toHaveBeenCalled();

    pending.resolve({
      pubky: 'z'.repeat(52),
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise-pk',
    });
    await started;
    expect(controller.getState().phase).toBe('success');
  });

  it('does not auto-open intent or mixed-case schemes', async () => {
    for (const authorizationUrl of [
      'intent://scan/#Intent;scheme=https;end',
      'Pubkyauth://grant',
      'PUBKYAUTH://grant',
      'pubkyauth:/grant',
    ]) {
      const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
      const flow = authFlow({
        authorizationUrl,
        awaitEnabled: jest.fn(() => pending.promise),
      });
      const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
      const controller = createEnableMessagingController(deps);
      const { started } = await beginAuthorizing(controller);

      expect(controller.getState().phase).toBe('authorizing');
      expect(deps.openUrl).not.toHaveBeenCalled();
      controller.cancel();
      pending.reject(new Error('cancelled'));
      await started.catch(() => undefined);
    }
  });

  it('beginAuth can re-run after an already-enabled status', async () => {
    const flow = authFlow();
    const deps = makeDeps({
      getEnableStatus: jest.fn().mockResolvedValue('enabled'),
      enable: jest.fn().mockResolvedValue(flow),
    });
    const controller = createEnableMessagingController(deps);
    await controller.start();
    await controller.beginAuth();

    expect(deps.enable).toHaveBeenCalledTimes(1);
    expect(controller.getState().phase).toBe('success');
  });

  it('onAppActive shows success when the grant landed while backgrounded', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const getEnableStatus = jest
      .fn()
      .mockResolvedValueOnce('needs-enable')
      .mockResolvedValue('enabled');
    const deps = makeDeps({
      getEnableStatus,
      enable: jest.fn().mockResolvedValue(flow),
    });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);
    expect(controller.getState().phase).toBe('authorizing');

    await controller.onAppActive();

    expect(controller.getState().phase).toBe('success');
    expect(flow.releaseKeepalive).toHaveBeenCalled();
    expect(flow.cancel).not.toHaveBeenCalled();
    pending.reject(new Error('cancelled after success'));
    await started.catch(() => undefined);
    expect(controller.getState().phase).toBe('success');
  });

  it('onAppActive expires an authorizing grant past the five-minute TTL', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    let now = 1_000;
    const deps = makeDeps({
      enable: jest.fn().mockResolvedValue(flow),
      now: () => now,
    });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);
    expect(controller.getState().phase).toBe('authorizing');

    now += ENABLE_AUTH_TTL_MS + 1;
    await controller.onAppActive();

    expect(controller.getState().phase).toBe('expired');
    expect(controller.getState().message).toBe(COPY.enableExpiredBody);
    expect(flow.cancel).toHaveBeenCalled();
    pending.reject(new Error('expired'));
    await started.catch(() => undefined);
    expect(controller.getState().phase).toBe('expired');
  });

  it('ignores a second tap while enable() is unresolved', async () => {
    const pendingEnable = deferred<LinkEnableFlow>();
    const pendingAwait = deferred<{
      pubky: string;
      receiverPath: string;
      noisePublicKey: string;
    }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pendingAwait.promise) });
    const deps = makeDeps({ enable: jest.fn(() => pendingEnable.promise) });
    const controller = createEnableMessagingController(deps);
    await controller.start();

    const first = controller.beginAuth();
    const second = controller.beginAuth();
    await flush();
    expect(deps.enable).toHaveBeenCalledTimes(1);

    pendingEnable.resolve(flow);
    await flush();
    pendingAwait.resolve({
      pubky: 'z'.repeat(52),
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise-pk',
    });
    await Promise.all([first, second]);
    expect(deps.enable).toHaveBeenCalledTimes(1);
    expect(controller.getState().phase).toBe('success');
  });

  it('cancels a stale enable() result after the attempt was superseded', async () => {
    const firstEnable = deferred<LinkEnableFlow>();
    const secondEnable = deferred<LinkEnableFlow>();
    const firstFlow = authFlow({
      authorizationUrl: 'pubkyauth://first',
      awaitEnabled: jest.fn(() => new Promise(() => undefined)),
    });
    const secondFlow = authFlow({
      authorizationUrl: 'pubkyauth://second',
      awaitEnabled: jest.fn().mockResolvedValue({
        pubky: 'z'.repeat(52),
        receiverPath: 'hypercolor/wallet',
        noisePublicKey: 'noise-pk',
      }),
    });
    const enable = jest
      .fn()
      .mockImplementationOnce(() => firstEnable.promise)
      .mockImplementationOnce(() => secondEnable.promise);
    const deps = makeDeps({ enable });
    const controller = createEnableMessagingController(deps);
    await controller.start();

    const stale = controller.beginAuth();
    await flush();
    controller.cancel();
    await controller.start();
    const fresh = controller.beginAuth();
    await flush();

    firstEnable.resolve(firstFlow);
    await stale;
    expect(firstFlow.cancel).toHaveBeenCalled();
    expect(controller.getState().authorizationUrl).not.toBe('pubkyauth://first');

    secondEnable.resolve(secondFlow);
    await fresh;
    expect(controller.getState().phase).toBe('success');
    expect(controller.getState().authorizationUrl).toBeNull();
  });

  it('cancels the native flow when cancel() races an unresolved enable()', async () => {
    const pendingEnable = deferred<LinkEnableFlow>();
    const flow = authFlow();
    const deps = makeDeps({ enable: jest.fn(() => pendingEnable.promise) });
    const controller = createEnableMessagingController(deps);
    await controller.start();
    const started = controller.beginAuth();
    await flush();
    controller.cancel();
    pendingEnable.resolve(flow);
    await started;
    expect(flow.cancel).toHaveBeenCalled();
    expect(flow.releaseKeepalive).not.toHaveBeenCalled();
    expect(controller.getState().phase).not.toBe('success');
  });

  it('does not start a second flow while already authorizing', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);
    expect(deps.enable).toHaveBeenCalledTimes(1);
    await controller.beginAuth();
    expect(deps.enable).toHaveBeenCalledTimes(1);
    controller.cancel();
    pending.reject(new Error('cancelled'));
    await started.catch(() => undefined);
  });

  it('does not sign out when a delayed awaitEnabled resolves after AppState enabled', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const getEnableStatus = jest
      .fn()
      .mockResolvedValueOnce('needs-enable')
      .mockResolvedValue('enabled');
    const deps = makeDeps({
      getEnableStatus,
      enable: jest.fn().mockResolvedValue(flow),
    });
    const controller = createEnableMessagingController(deps);
    const { started } = await beginAuthorizing(controller);
    await controller.onAppActive();
    expect(controller.getState().phase).toBe('success');
    expect(flow.cancel).not.toHaveBeenCalled();
    pending.resolve({
      pubky: 'z'.repeat(52),
      receiverPath: 'hypercolor/wallet',
      noisePublicKey: 'noise-pk',
    });
    await started;
    expect(flow.cancel).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe('success');
  });

  it('keeps the latest AppState status when polls overlap', async () => {
    const firstStatus = deferred<Awaited<ReturnType<EnableMessagingDeps['getEnableStatus']>>>();
    const secondStatus = deferred<Awaited<ReturnType<EnableMessagingDeps['getEnableStatus']>>>();
    let calls = 0;
    const getEnableStatus = jest.fn().mockImplementation(() => {
      calls += 1;
      return calls === 1 ? firstStatus.promise : secondStatus.promise;
    });
    const deps = makeDeps({ getEnableStatus });
    const controller = createEnableMessagingController(deps);
    const first = controller.start();
    await flush();
    const second = controller.onAppActive();
    secondStatus.resolve('session-offline');
    await second;
    expect(controller.getState().phase).toBe('session-offline');
    firstStatus.resolve('enabled');
    await first;
    expect(controller.getState().phase).toBe('session-offline');
    expect(controller.getState().phase).not.toBe('success');
  });
});

describe('isAutoOpenableAuthUrl', () => {
  it('accepts only the case-sensitive pubkyauth:// prefix', () => {
    expect(isAutoOpenableAuthUrl('pubkyauth://grant')).toBe(true);
    expect(isAutoOpenableAuthUrl('pubkyauth:///?caps=/pub/paykit/:rw&secret=abc')).toBe(true);
    expect(isAutoOpenableAuthUrl('https://relay.example/auth?secret=abc')).toBe(false);
    expect(isAutoOpenableAuthUrl('intent://scan/#Intent;scheme=https;end')).toBe(false);
    expect(isAutoOpenableAuthUrl('Pubkyauth://grant')).toBe(false);
    expect(isAutoOpenableAuthUrl('pubkyauth:/grant')).toBe(false);
    expect(isAutoOpenableAuthUrl(' pubkyauth://grant')).toBe(false);
  });
});
