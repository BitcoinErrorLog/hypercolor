import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../../');
const ANDROID_REGISTRY = readFileSync(
  join(ROOT, 'android/app/src/main/java/com/hypercolor/AuthFlowCancelRegistry.kt'),
  'utf8',
);
const ANDROID_MODULE = readFileSync(
  join(ROOT, 'android/app/src/main/java/com/hypercolor/PaykitLinkModule.kt'),
  'utf8',
);
const IOS_MODULE = readFileSync(join(ROOT, 'ios/hypercolor/PaykitLinkModule.swift'), 'utf8');

describe('native auth-flow source pin', () => {
  it('pins Android AuthFlowCancelRegistry cancel/teardown predicates', () => {
    expect(ANDROID_REGISTRY).toContain('internal class AuthFlowCancelRegistry');
    expect(ANDROID_REGISTRY).toContain('fun cancel(');
    expect(ANDROID_REGISTRY).toContain('fun teardown(');
    expect(ANDROID_REGISTRY).toContain('Unavailable');
    expect(ANDROID_REGISTRY).toMatch(/auth_flow_cancelled|AuthFlowCancelKind/);
  });

  it('pins iOS PaykitLinkModule.swift RCTInvalidating and cancelAuthFlow', () => {
    expect(IOS_MODULE).toContain('class PaykitLinkModule: NSObject, RCTInvalidating');
    expect(IOS_MODULE).toContain('@objc func invalidate()');
    expect(IOS_MODULE).toContain('@objc func cancelAuthFlow(');
    expect(IOS_MODULE).toContain('bridgeTornDown');
    expect(IOS_MODULE).toContain('unavailable');
    expect(IOS_MODULE).toContain('auth_flow_cancelled');
  });

  it('plumbs chatKindsV from the FFI marker instead of hardcoding 0', () => {
    expect(ANDROID_MODULE).toContain('fun chatKindsVFromMarker');
    expect(ANDROID_MODULE).not.toContain('putInt("chatKindsV", 0)');
    expect(IOS_MODULE).toContain('func chatKindsVMap(from marker: ChatReceiverMarker)');
    expect(IOS_MODULE).not.toContain('"chatKindsV": 0');
  });
});
