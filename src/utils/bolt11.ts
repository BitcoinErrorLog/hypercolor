import { decode as decodeBolt11Raw } from 'light-bolt11-decoder';
import { COPY } from '../copy/uxCopy';

const MSAT_PER_BTC = 100_000_000_000n;
const DEFAULT_EXPIRY_SECONDS = 3600;
const HEX64 = /^[0-9a-f]{64}$/i;

export type Bolt11Network = 'bitcoin' | 'testnet' | 'regtest' | 'unknown';

export type DecodedBolt11Invoice = {
  paymentRequest: string;
  network: Bolt11Network;
  amountMsat: string | null;
  amountBtc: string | null;
  paymentHash: string | null;
  timestampSeconds: number | null;
  expirySeconds: number;
  expiresAtMs: number | null;
};

export class Bolt11DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Bolt11DecodeError';
  }
}

function networkFromPrefix(invoice: string): Bolt11Network {
  const lower = invoice.toLowerCase();
  if (lower.startsWith('lnbcrt')) return 'regtest';
  if (lower.startsWith('lntb')) return 'testnet';
  if (lower.startsWith('lnbc')) return 'bitcoin';
  return 'unknown';
}

function networkFromSection(value: unknown): Bolt11Network | null {
  if (typeof value !== 'object' || value === null) return null;
  const bech32 = (value as { bech32?: unknown }).bech32;
  if (bech32 === 'bc') return 'bitcoin';
  if (bech32 === 'tb' || bech32 === 'tbs') return 'testnet';
  if (bech32 === 'bcrt') return 'regtest';
  return null;
}

function sectionValue(
  sections: readonly { name: string; value?: unknown }[],
  name: string,
): unknown {
  return sections.find(section => section.name === name)?.value;
}

export function msatToBtcDecimal(msat: string | bigint): string {
  const value = typeof msat === 'bigint' ? msat : BigInt(msat);
  const whole = value / MSAT_PER_BTC;
  const rem = value % MSAT_PER_BTC;
  if (rem === 0n) return whole.toString();
  return `${whole}.${rem.toString().padStart(11, '0').replace(/0+$/, '')}`;
}

export function btcDecimalToMsat(value: string): bigint | null {
  if (
    !/^[0-9]+(\.[0-9]+)?$/.test(value) &&
    !/^\.[0-9]+$/.test(value) &&
    !/^[0-9]+\.$/.test(value)
  ) {
    return null;
  }
  const [wholeRaw, fracRaw = ''] = value.split('.');
  const wholeSource = wholeRaw ?? '';
  const whole = wholeSource === '' ? '0' : wholeSource.replace(/^0+(?=\d)/, '') || '0';
  if (fracRaw.length > 11 && /[1-9]/.test(fracRaw.slice(11))) return null;
  const frac = (fracRaw + '00000000000').slice(0, 11);
  return BigInt(whole) * MSAT_PER_BTC + BigInt(frac || '0');
}

export function amountsMatchExactly(requestBtc: string, invoiceMsat: string): boolean {
  const requestMsat = btcDecimalToMsat(requestBtc);
  if (requestMsat === null) return false;
  try {
    return requestMsat === BigInt(invoiceMsat);
  } catch {
    return false;
  }
}

export function decodeBolt11Invoice(invoice: string): DecodedBolt11Invoice {
  if (invoice.length === 0) {
    throw new Bolt11DecodeError('invoice is empty');
  }
  for (const ch of invoice) {
    const code = ch.charCodeAt(0);
    if (code <= 32 || code === 127) {
      throw new Bolt11DecodeError('invoice contains control or whitespace characters');
    }
  }
  let decoded: ReturnType<typeof decodeBolt11Raw>;
  try {
    decoded = decodeBolt11Raw(invoice.toLowerCase());
  } catch {
    throw new Bolt11DecodeError(COPY.invoiceInvalid);
  }

  const amountValue = sectionValue(decoded.sections, 'amount');
  const amountMsat = typeof amountValue === 'string' && amountValue.length > 0 ? amountValue : null;
  const timestampValue = sectionValue(decoded.sections, 'timestamp');
  const timestampSeconds = typeof timestampValue === 'number' ? timestampValue : null;
  const expiryValue = sectionValue(decoded.sections, 'expiry');
  const expirySeconds = typeof expiryValue === 'number' ? expiryValue : DEFAULT_EXPIRY_SECONDS;
  const paymentHashValue = sectionValue(decoded.sections, 'payment_hash');
  const paymentHash =
    typeof paymentHashValue === 'string' && HEX64.test(paymentHashValue)
      ? paymentHashValue.toLowerCase()
      : null;
  const network =
    networkFromSection(sectionValue(decoded.sections, 'coin_network')) ??
    networkFromPrefix(invoice);
  const expiresAtMs = timestampSeconds === null ? null : (timestampSeconds + expirySeconds) * 1000;

  return {
    paymentRequest: decoded.paymentRequest,
    network,
    amountMsat,
    amountBtc: amountMsat === null ? null : msatToBtcDecimal(amountMsat),
    paymentHash,
    timestampSeconds,
    expirySeconds,
    expiresAtMs,
  };
}

export function tryDecodeBolt11Invoice(invoice: string): DecodedBolt11Invoice | null {
  try {
    return decodeBolt11Invoice(invoice);
  } catch {
    return null;
  }
}

export function isMainnetBolt11(invoice: string): boolean {
  const decoded = tryDecodeBolt11Invoice(invoice);
  return decoded !== null && decoded.network === 'bitcoin';
}
