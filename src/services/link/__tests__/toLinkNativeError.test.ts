import { createLinkNativeError, toLinkNativeError } from '../PaykitLinkNative';

/**
 * Unknown native rejections must collapse to coarse static messages. Raw
 * native exception text can carry filesystem paths or key material and must
 * never cross into JS logs / UI.
 */
describe('toLinkNativeError', () => {
  it('passes through an already-typed LinkNativeError unchanged', () => {
    const typed = createLinkNativeError('network', 'network error');
    expect(toLinkNativeError(typed)).toBe(typed);
  });

  it('maps a code-bearing rejection to the coarse message for that code', () => {
    const err = { code: 'auth', message: 42 };
    expect(toLinkNativeError(err)).toEqual({ code: 'auth', message: 'authentication failed' });
  });

  it('maps a userInfo.code rejection to the coarse message for that code', () => {
    const err = { userInfo: { code: 'consumed' } };
    expect(toLinkNativeError(err)).toEqual({ code: 'consumed', message: 'resource consumed' });
  });

  it('does not forward unknown exception text (paths / key material)', () => {
    const sensitive =
      'RNCSQLiteException: open /var/mobile/Containers/Data/ABCD/Documents/hypercolor.sqlite failed; key=deadbeef';
    const mapped = toLinkNativeError(new Error(sensitive));
    expect(mapped.code).toBe('protocol');
    expect(mapped.message).toBe('protocol error');
    expect(mapped.message).not.toContain('/var/mobile');
    expect(mapped.message).not.toContain('deadbeef');
  });

  it('coarsens non-Error unknown values', () => {
    expect(toLinkNativeError('sqlite full at /data/data/com.hypercolor/x.db')).toEqual({
      code: 'protocol',
      message: 'protocol error',
    });
    expect(toLinkNativeError(undefined)).toEqual({ code: 'protocol', message: 'protocol error' });
  });

  it('maps EncryptedLink in_flight and parked_result_conflict to unavailable', () => {
    expect(toLinkNativeError({ code: 'in_flight', message: 'send already in flight' })).toEqual({
      code: 'unavailable',
      message: 'unavailable',
    });
    expect(toLinkNativeError({ code: 'parked_result_conflict' })).toEqual({
      code: 'unavailable',
      message: 'unavailable',
    });
    expect(toLinkNativeError({ userInfo: { code: 'in_flight' } })).toEqual({
      code: 'unavailable',
      message: 'unavailable',
    });
    expect(toLinkNativeError(Object.assign(new Error('parked_result_conflict'), { name: 'parked_result_conflict' }))).toEqual({
      code: 'unavailable',
      message: 'unavailable',
    });
  });
});
