import { COPY } from '../../copy/uxCopy';
import {
  formatGroupFanoutAggregate,
  groupDeliveryFromOutcomes,
  notDeliveredBlocked,
  sentToNofM,
} from '../groupFanoutStatus';

const ALICE = 'pxnu33x7jtpx9ar1ytsi4yxbp6a5o36gwhffs8zoxmbuptici1jy';
const BOB = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const CAROL = 'kyp7qac797z86bngq9g3ajqbrsgsb3tibayndqi6fe4cqi3gb6ry';

function outcome(
  recipientPubky: string,
  status: 'sent' | 'failed',
  reason: 'blocked' | null = null,
) {
  return { recipientPubky, status, reason };
}

describe('formatGroupFanoutAggregate', () => {
  it('is Sent when every recipient succeeded', () => {
    expect(
      formatGroupFanoutAggregate([
        outcome(ALICE, 'sent'),
        outcome(BOB, 'sent'),
        outcome(CAROL, 'sent'),
      ]),
    ).toBe(COPY.sent);
  });

  it('names a single blocked miss', () => {
    expect(formatGroupFanoutAggregate([outcome(ALICE, 'failed', 'blocked')])).toBe(
      notDeliveredBlocked('pxnu33…i1jy'),
    );
    expect(
      formatGroupFanoutAggregate(
        [outcome(ALICE, 'failed', 'blocked')],
        new Map([[ALICE, 'Alice']]),
      ),
    ).toBe(notDeliveredBlocked('Alice'));
  });

  it('does not depend on recipient order for a mixed outcome', () => {
    const mixed = [
      outcome(ALICE, 'failed', 'blocked'),
      outcome(BOB, 'sent'),
      outcome(CAROL, 'sent'),
    ];
    const reversed = [...mixed].reverse();
    expect(formatGroupFanoutAggregate(mixed)).toBe(sentToNofM(2, 3));
    expect(formatGroupFanoutAggregate(reversed)).toBe(sentToNofM(2, 3));
    expect(groupDeliveryFromOutcomes(mixed)).toBe(groupDeliveryFromOutcomes(reversed));
  });

  it('counts pending rows in the expected recipient total', () => {
    const mixed = [
      { recipientPubky: ALICE, status: 'sent' as const, reason: null },
      { recipientPubky: BOB, status: 'pending' as const, reason: null },
    ];
    expect(formatGroupFanoutAggregate(mixed)).toBe(sentToNofM(1, 2));
    expect(groupDeliveryFromOutcomes(mixed)).toBe('sent');
  });
});
