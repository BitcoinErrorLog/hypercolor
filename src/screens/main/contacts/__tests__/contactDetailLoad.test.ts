import { loadContactDetail } from '../contactDetailLoad';
import type { Contact } from '../../../../types';

const OWNER_A = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const OWNER_B = 'gcumbhd7sqit6nn457jxmrwqx9pyymqwamnarekgo3xppqo6a19o';
const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';

const contactA: Contact = {
  pubky: ALICE,
  ownerPubky: OWNER_A,
  displayName: 'Alice-A',
  trustScore: 0.4,
  isFollowing: true,
  isFollower: false,
  isMutual: false,
  addedManually: true,
  firstSeenAt: 1,
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('loadContactDetail owner-change guard', () => {
  it('discards owner A storage results after switching to B', async () => {
    const storage = deferred<Contact | null>();
    const payment = deferred<Array<{ identifier: string }>>();
    let currentOwner: string = OWNER_A;

    const resultP = loadContactDetail({
      ownerPubky: OWNER_A,
      pubky: ALICE,
      stored: undefined,
      isCurrent: () => currentOwner === OWNER_A,
      getContact: async () => storage.promise,
      explainTrust: async () => ({
        score: 0.4,
        reasons: [{ code: 'following', contribution: 0.15, label: 'You follow them' }],
      }),
      getLink: async () => ({ status: 'established' }),
      getPeerTipEndpoints: async () => payment.promise,
    });

    currentOwner = OWNER_B;
    storage.resolve(contactA);
    payment.resolve([{ identifier: 'lnurl-alice-a' }]);

    await expect(resultP).resolves.toBe('cancelled');
  });

  it('discards owner A payment results after switching to B', async () => {
    const payment = deferred<Array<{ identifier: string }>>();
    let markPayment!: () => void;
    const paymentStarted = new Promise<void>(resolve => {
      markPayment = resolve;
    });
    let currentOwner: string = OWNER_A;

    const resultP = loadContactDetail({
      ownerPubky: OWNER_A,
      pubky: ALICE,
      stored: undefined,
      isCurrent: () => currentOwner === OWNER_A,
      getContact: async () => contactA,
      explainTrust: async () => ({ score: 0.4, reasons: [] }),
      getLink: async () => ({ status: 'established' }),
      getPeerTipEndpoints: async () => {
        markPayment();
        return payment.promise;
      },
    });

    await paymentStarted;
    currentOwner = OWNER_B;
    payment.resolve([{ identifier: 'lnurl-alice-a' }]);

    await expect(resultP).resolves.toBe('cancelled');
  });

  it('commits B data when the owner token still matches', async () => {
    const contactB: Contact = { ...contactA, ownerPubky: OWNER_B, displayName: 'Alice-B' };
    const result = await loadContactDetail({
      ownerPubky: OWNER_B,
      pubky: ALICE,
      stored: undefined,
      isCurrent: () => true,
      getContact: async () => contactB,
      explainTrust: async () => ({ score: 0.1, reasons: [] }),
      getLink: async () => null,
      getPeerTipEndpoints: async () => [{ identifier: 'lnurl-b' }],
    });
    expect(result).not.toBe('cancelled');
    if (result === 'cancelled') return;
    expect(result.contact?.displayName).toBe('Alice-B');
    expect(result.contact?.ownerPubky).toBe(OWNER_B);
    expect(result.paymentIdentifiers).toEqual(['lnurl-b']);
    expect(result.loadError).toBeNull();
  });
});
