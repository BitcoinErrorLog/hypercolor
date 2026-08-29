import {
  createEnableMessagingController,
  type EnableMessagingDeps,
} from '../enableMessagingController';
import type { LinkEnableFlow } from '../../../services/link/LinkService';

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
    ...overrides,
  };
}

describe('enableMessagingController', () => {
  it('surfaces native-missing without starting a Ring flow', async () => {
    const deps = makeDeps({ getEnableStatus: jest.fn().mockResolvedValue('native-missing') });
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState().phase).toBe('native-missing');
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it('surfaces already-enabled without starting a Ring flow', async () => {
    const deps = makeDeps({ getEnableStatus: jest.fn().mockResolvedValue('enabled') });
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState().phase).toBe('enabled');
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it('surfaces session-offline without auto-starting auth', async () => {
    const deps = makeDeps({ getEnableStatus: jest.fn().mockResolvedValue('session-offline') });
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState().phase).toBe('session-offline');
    expect(deps.enable).not.toHaveBeenCalled();
  });

  it('presents the authorization URL and waits for awaitEnabled', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);

    const started = controller.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        phase: 'authorizing',
        authorizationUrl: 'pubkyauth://grant',
      }),
    );

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

  it('records enable errors after awaitEnabled rejects', async () => {
    const flow = authFlow({
      awaitEnabled: jest.fn().mockRejectedValue(new Error('ring denied')),
    });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);

    await controller.start();

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        phase: 'error',
        message: 'ring denied',
      }),
    );
  });

  it('opens and copies the authorization URL', async () => {
    const pending = deferred<{ pubky: string; receiverPath: string; noisePublicKey: string }>();
    const flow = authFlow({ awaitEnabled: jest.fn(() => pending.promise) });
    const deps = makeDeps({ enable: jest.fn().mockResolvedValue(flow) });
    const controller = createEnableMessagingController(deps);
    const started = controller.start();
    await Promise.resolve();
    await Promise.resolve();

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
    const started = controller.start();
    await Promise.resolve();
    await Promise.resolve();

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
});
