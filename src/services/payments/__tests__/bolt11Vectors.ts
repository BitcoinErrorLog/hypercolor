/** light-bolt11-decoder fixture (mainnet, 20u = 0.00002 BTC). */
export const MAINNET_BOLT11_20U =
  'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';

export const MAINNET_BOLT11_20U_MSAT = '2000000';
export const MAINNET_BOLT11_20U_BTC = '0.00002';
export const MAINNET_BOLT11_20U_HASH =
  'f5636521e98000697a6700b979c288ddad56cb3995a2eb07550872c466ccc3e5';
export const MAINNET_BOLT11_20U_EXPIRY_SECONDS = 172800;
export const MAINNET_BOLT11_20U_TIMESTAMP = 1648859703;

/** bitcoinjs/bolt11 fixture — amountless mainnet. */
export const MAINNET_BOLT11_AMOUNTLESS =
  'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';

/** bitcoinjs/bolt11 fixture — testnet, must be rejected for btc-lightning-*. */
export const TESTNET_BOLT11 =
  'lntb20m1pvjluezhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqfpp3x9et2e20v6pu37c5d9vax37wxq72un98kmzzhznpurw9sgl2v0nklu2g4d0keph5t7tj9tcqd8rexnd07ux4uv2cjvcqwaxgj7v4uwn5wmypjd5n69z2xm3xgksg28nwht7f6zspwp3f9t';

export const TESTNET_BOLT11_HASH =
  '0001020304050607080900010203040506070809000102030405060708090102';

/** lnd zpay32 fixture — 24 BTC on regtest. */
export const REGTEST_BOLT11 =
  'lnbcrt241pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdqqnp4q0n326hr8v9zprg8gsvezcch06gfaqqhde2aj730yg0durunfhv66df5c8pqjjt4z4ymmuaxfx8eh5v7hmzs3wrfas8m2sz5qz56rw2lxy8mmgm4xln0ha26qkw6u3vhu22pss2udugr9g74c3x20slpcqjgq0el4h6';

export const REGTEST_BOLT11_HASH = TESTNET_BOLT11_HASH;

export const MAINNET_P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
export const MAINNET_P2TR = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
export const MAINNET_P2PKH = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

export function corruptBolt11Checksum(invoice: string): string {
  const last = invoice.slice(-1);
  return `${invoice.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
}
