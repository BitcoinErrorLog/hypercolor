const mockAwaiting = new Map<string, { resolve: (value: unknown) => void }>();

jest.mock('react-native', () => ({
  NativeModules: {
    PaykitLinkModule: {
      startAuthFlow: jest.fn(async () => ({
        flowId: 'flow-1',
        authorizationUrl: 'pubkyauth:///?caps=x&secret=y&relay=https://httprelay.pubky.app/link/',
      })),
      awaitAuthApproval: jest.fn((flowId: string) => {
        if (mockAwaiting.has(flowId)) {
          return Promise.reject({ code: 'validation', message: 'already awaiting' });
        }
        return new Promise(resolve => {
          mockAwaiting.set(flowId, {
            resolve: (value: unknown) => {
              mockAwaiting.delete(flowId);
              resolve(value);
            },
          });
        });
      }),
      cancelAuthFlow: jest.fn(async () => undefined),
      stopAuthKeepalive: jest.fn(async () => undefined),
      signOutSession: jest.fn(async () => undefined),
      adoptAuthSession: jest.fn(async () => undefined),
    },
  },
}));

import { PaykitLinkNative } from '../PaykitLinkNative';

describe('awaitAuthApproval native owner admission', () => {
  it('rejects a second await as validation while the first owner is still pending', async () => {
    const first = PaykitLinkNative.awaitAuthApproval('flow-1');
    await expect(PaykitLinkNative.awaitAuthApproval('flow-1')).rejects.toMatchObject({
      code: 'validation',
    });
    mockAwaiting.get('flow-1')?.resolve({
      sessionAlias: 'alias-1',
      pubky: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await expect(first).resolves.toEqual({
      sessionAlias: 'alias-1',
      pubky: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });
});
