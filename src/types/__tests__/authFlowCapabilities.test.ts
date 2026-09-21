import {
  HYPERCOLOR_WRITE_CAPABILITY,
  PAYKIT_MESSAGING_CAPABILITY,
  RING_GRANT_CAPABILITIES,
  capabilitiesCoverRingGrant,
  capabilityCoversPaykitRw,
  formatAuthFlowCapabilities,
  scopeCovers,
} from '../link';

describe('formatAuthFlowCapabilities', () => {
  it('joins individually valid grants the Chat FFI Capabilities parser accepts', () => {
    expect(
      formatAuthFlowCapabilities([PAYKIT_MESSAGING_CAPABILITY, HYPERCOLOR_WRITE_CAPABILITY]),
    ).toBe('/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw');
    expect(RING_GRANT_CAPABILITIES).toBe('/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw');
  });

  it('splits a combined string so it is not treated as one Capability', () => {
    expect(formatAuthFlowCapabilities('/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw')).toBe(
      RING_GRANT_CAPABILITIES,
    );
    expect(formatAuthFlowCapabilities(' /pub/paykit/:rw , /pub/hypercolor.app/v1/:rw ')).toBe(
      RING_GRANT_CAPABILITIES,
    );
  });

  it('accepts a single /pub/paykit/:rw grant', () => {
    expect(formatAuthFlowCapabilities(PAYKIT_MESSAGING_CAPABILITY)).toBe(
      PAYKIT_MESSAGING_CAPABILITY,
    );
    expect(capabilityCoversPaykitRw(PAYKIT_MESSAGING_CAPABILITY)).toBe(true);
  });

  it('accepts a directory prefix or root that covers /pub/paykit/', () => {
    expect(formatAuthFlowCapabilities('/pub/:rw')).toBe('/pub/:rw');
    expect(formatAuthFlowCapabilities('/:rw')).toBe('/:rw');
    expect(capabilityCoversPaykitRw('/pub/:rw')).toBe(true);
    expect(capabilityCoversPaykitRw('/:rw')).toBe(true);
  });

  it('rejects a combined string with two colons as one entry', () => {
    expect(() =>
      formatAuthFlowCapabilities(['/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw']),
    ).toThrow('comma-separated');
  });

  it('rejects missing paykit read+write and empty lists', () => {
    expect(() => formatAuthFlowCapabilities(HYPERCOLOR_WRITE_CAPABILITY)).toThrow('/pub/paykit/');
    expect(() => formatAuthFlowCapabilities('/pub/paykit/:r')).toThrow('/pub/paykit/');
    expect(() => formatAuthFlowCapabilities('')).toThrow('at least one');
    expect(() => formatAuthFlowCapabilities('   ,  ')).toThrow('at least one');
  });
});

describe('capabilitiesCoverRingGrant', () => {
  it('accepts reordered RING_GRANT entries and a covering /pub/:rw directory', () => {
    expect(
      capabilitiesCoverRingGrant(`${HYPERCOLOR_WRITE_CAPABILITY},${PAYKIT_MESSAGING_CAPABILITY}`),
    ).toBe(true);
    expect(capabilitiesCoverRingGrant('/pub/:rw')).toBe(true);
    expect(scopeCovers('/pub/', '/pub/paykit/')).toBe(true);
  });

  it('fails when /pub/hypercolor.app/v1/:rw is missing', () => {
    expect(capabilitiesCoverRingGrant(PAYKIT_MESSAGING_CAPABILITY)).toBe(false);
    expect(capabilitiesCoverRingGrant('/pub/paykit/:r,/pub/hypercolor.app/v1/:rw')).toBe(false);
  });
});
