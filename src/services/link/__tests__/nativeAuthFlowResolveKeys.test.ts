import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../../');
const ANDROID = readFileSync(
  join(ROOT, 'android/app/src/main/java/com/hypercolor/PaykitLinkModule.kt'),
  'utf8',
);
const IOS = readFileSync(join(ROOT, 'ios/hypercolor/PaykitLinkModule.swift'), 'utf8');

describe('native auth-flow resolve key pin', () => {
  it('pins Android startAuthFlow and awaitAuthApproval WritableMap keys', () => {
    expect(ANDROID).toContain('fun startAuthFlow(');
    expect(ANDROID).toContain('putString("flowId", flowId)');
    expect(ANDROID).toContain('putString("authorizationUrl", flow.authorizationUrl())');
    expect(ANDROID).toContain('fun awaitAuthApproval(flowId: String, promise: Promise)');
    expect(ANDROID).toContain('putString("sessionAlias", alias)');
    expect(ANDROID).toContain('putString("pubky", session.pubky())');
  });

  it('pins iOS startAuthFlow and awaitAuthApproval dictionary keys', () => {
    expect(IOS).toContain('@objc func startAuthFlow(');
    expect(IOS).toContain('"flowId": flowId');
    expect(IOS).toContain('"authorizationUrl": flow.authorizationUrl()');
    expect(IOS).toContain('@objc func awaitAuthApproval(');
    expect(IOS).toContain('"sessionAlias": alias');
    expect(IOS).toContain('"pubky": session.pubky()');
    expect(IOS).toContain('"already awaiting"');
    expect(ANDROID).toContain('already awaiting');
  });
});
