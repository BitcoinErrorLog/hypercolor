import {
  ALLOWED_PUBKYAUTH_RELAY_HOST,
  assertAllowedPubkyauthRelay,
  parsePubkyauthAuthorizationUrl,
} from '../pubkyauthUrl';
import { RING_GRANT_CAPABILITIES } from '../../types/link';

const SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const RELAY = 'https://httprelay.pubky.app/link/';

describe('parsePubkyauthAuthorizationUrl', () => {
  it('parses caps, secret, and the allowlisted relay', () => {
    const raw =
      `pubkyauth:///?caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}` +
      `&secret=${SECRET}&relay=${encodeURIComponent(RELAY)}`;
    expect(parsePubkyauthAuthorizationUrl(raw)).toEqual({
      caps: RING_GRANT_CAPABILITIES,
      secret: SECRET,
      relay: RELAY,
    });
    expect(ALLOWED_PUBKYAUTH_RELAY_HOST).toBe('httprelay.pubky.app');
  });

  it('rejects a non-https or non-allowlisted relay', () => {
    expect(() => assertAllowedPubkyauthRelay('http://httprelay.pubky.app/link/')).toThrow('https');
    expect(() => assertAllowedPubkyauthRelay('https://evil.example/link/')).toThrow('allowlisted');
  });
});
