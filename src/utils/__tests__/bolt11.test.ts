import { decodeBolt11Invoice, isMainnetBolt11, msatToBtcDecimal } from '../bolt11';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_EXPIRY_SECONDS,
  MAINNET_BOLT11_20U_HASH,
  MAINNET_BOLT11_20U_MSAT,
  MAINNET_BOLT11_20U_TIMESTAMP,
  MAINNET_BOLT11_AMOUNTLESS,
  TESTNET_BOLT11,
  corruptBolt11Checksum,
} from '../../services/payments/__tests__/bolt11Vectors';

describe('decodeBolt11Invoice', () => {
  it('extracts amount, payment_hash, expiry, and mainnet prefix from the decoder fixture', () => {
    const decoded = decodeBolt11Invoice(MAINNET_BOLT11_20U);
    expect(decoded.network).toBe('bitcoin');
    expect(decoded.amountMsat).toBe(MAINNET_BOLT11_20U_MSAT);
    expect(decoded.amountBtc).toBe(MAINNET_BOLT11_20U_BTC);
    expect(decoded.paymentHash).toBe(MAINNET_BOLT11_20U_HASH);
    expect(decoded.timestampSeconds).toBe(MAINNET_BOLT11_20U_TIMESTAMP);
    expect(decoded.expirySeconds).toBe(MAINNET_BOLT11_20U_EXPIRY_SECONDS);
    expect(decoded.expiresAtMs).toBe(
      (MAINNET_BOLT11_20U_TIMESTAMP + MAINNET_BOLT11_20U_EXPIRY_SECONDS) * 1000,
    );
    expect(msatToBtcDecimal(MAINNET_BOLT11_20U_MSAT)).toBe(MAINNET_BOLT11_20U_BTC);
    expect(isMainnetBolt11(MAINNET_BOLT11_20U)).toBe(true);
  });

  it('rejects a checksum-corrupted invoice', () => {
    expect(() => decodeBolt11Invoice(corruptBolt11Checksum(MAINNET_BOLT11_20U))).toThrow(
      /checksum|Invalid/i,
    );
    expect(isMainnetBolt11(corruptBolt11Checksum(MAINNET_BOLT11_20U))).toBe(false);
  });

  it('decodes an amountless mainnet invoice and rejects testnet', () => {
    const amountless = decodeBolt11Invoice(MAINNET_BOLT11_AMOUNTLESS);
    expect(amountless.network).toBe('bitcoin');
    expect(amountless.amountMsat).toBeNull();
    expect(amountless.amountBtc).toBeNull();
    expect(isMainnetBolt11(MAINNET_BOLT11_AMOUNTLESS)).toBe(true);

    const testnet = decodeBolt11Invoice(TESTNET_BOLT11);
    expect(testnet.network).toBe('testnet');
    expect(isMainnetBolt11(TESTNET_BOLT11)).toBe(false);
  });
});
