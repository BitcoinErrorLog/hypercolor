import { maestroFlow } from '../report/buildReport';
import type { CaptureTarget } from '../types';
import { vrtSceneReadyTestIds } from '../sceneReady';

const entry = {
  id: 'tabs.channels.create-private',
  journey: 'tabs',
  screen: 'channels',
  platform: 'all' as const,
  viewport: 'all' as const,
  theme: 'dark' as const,
  state: 'create-private',
  mask: [],
};

function target(platform: 'android' | 'ios', device: string): CaptureTarget {
  return {
    entry,
    platform,
    viewport: platform === 'android' ? 'android-large' : 'ios-large',
    device,
    captureName: `tabs/channels/create-private/${platform}/${device}.png`,
  };
}

describe('maestroFlow', () => {
  it('asserts the Android scene marker by testID, not text', () => {
    const yaml = maestroFlow(target('android', 'pixel-8-pro'), 'com.hypercolor');
    expect(yaml).toContain('id: "vrt-scene:tabs.channels.create-private"');
    expect(yaml).not.toContain('text: "vrt-scene:tabs.channels.create-private"');
    expect(yaml).toContain('timeout: 20000');
  });

  it('waits on channelsCreateSheet for iOS create scenes', () => {
    expect(vrtSceneReadyTestIds('tabs.channels.create-public')).toContain('channelsCreateSheet');
    const yaml = maestroFlow(target('ios', 'iphone-16-pro-max'), 'org.name.hypercolor');
    expect(yaml).toContain('id: "channelsCreateSheet"');
    expect(yaml).not.toContain('text: "New"');
  });
});
