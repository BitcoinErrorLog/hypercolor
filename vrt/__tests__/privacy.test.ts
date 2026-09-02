import { SYNTHETIC_IDENTITIES } from '../fixtures/identities';
import { scanText } from '../privacy/scan';

describe('VRT privacy scan', () => {
  it('allows synthetic fixture pubkys and rejects unknown z32', () => {
    const allowed = scanText('fixture.ts', SYNTHETIC_IDENTITIES.aster.pubky);
    expect(allowed).toEqual([]);
    const unknown = scanText('leak.html', 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u');
    expect(unknown.some(hit => hit.rule === 'z32')).toBe(true);
  });
});
