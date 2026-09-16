/** LDK test fixture (mainnet, 100u = 0.0001 BTC). */
export const MAINNET_BOLT11_20U =
  'lnbc100u1p38tg4pdqlf9h8vmmfvdjjqer9wd3hy6tsw35k7msnp4qvwaqdzmlur2m5hea2da3c4zhwhyxrgxe49yrq854vqw4kckrtvygpp58qkwaky9l09g332372qnr8kcdafvrf7re9z0l5vw9xa2kvdhglfqsp5axgjhklwf08jg7w57wvlk8yksgttcxkl7rjmjy8zqzpxslme5xcs9qyysgqcqpcrzjqve0ahnleay8csatqrugw062f43cyxhxq4gj6c4a2fgr5alr84a3wp66yqqqslcqqqqqqqlgqqqqqqqqfqfjudghme9fqk4mrqmw9n2g44navk3dnvn4en8yxxf7fcwhk7wp884j43etfyc5vzp2ss6g2dgrr285kd0lmsa5mjtnzd4d583rfjl3gpprr8ru';

export const MAINNET_BOLT11_20U_MSAT = '10000000';
export const MAINNET_BOLT11_20U_BTC = '0.0001';
export const MAINNET_BOLT11_20U_HASH =
  '382ceed885fbca88c551f281319ed86f52c1a7c3c944ffd18e29baab31b747d2';
export const MAINNET_BOLT11_20U_EXPIRY_SECONDS = 3600;
export const MAINNET_BOLT11_20U_TIMESTAMP = 1651876513;

/** BOLT11 specification fixture (mainnet, 2500u = 0.0025 BTC). */
export const MAINNET_BOLT11_SPEC_2500U =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqdp6zsm';

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
