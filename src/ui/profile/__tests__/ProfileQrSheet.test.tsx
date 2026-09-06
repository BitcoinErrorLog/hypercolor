import React from 'react';
import { Share } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { COPY } from '../../../copy/uxCopy';
import { ProfileQrSheet } from '../ProfileQrSheet';
import { canonicalPubkyUri } from '../../../utils/canonicalPubkyUri';
import { copyText } from '../../../utils/copyText';

jest.mock('../../../utils/copyText', () => ({
  copyText: jest.fn(),
}));

const PUBKY = 'operrr8wsbpr3ue9d4qj41ge1kcc6r7fdiy6o3ugjrrhi4y77rdo';
const URI = canonicalPubkyUri(PUBKY);

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ProfileQrSheet
        visible
        pubky={PUBKY}
        copied={false}
        onCopied={jest.fn()}
        onClose={jest.fn()}
      />,
    );
  });
  return tree;
}

describe('ProfileQrSheet', () => {
  it('renders the canonical pubky URI and copies/shares it', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const tree = await render();
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(URI);
    expect(tree.root.findByProps({ testID: 'profileQrSheet' })).toBeTruthy();
    await act(async () => {
      tree.root.findByProps({ testID: 'profileQrCopy' }).props.onPress();
      tree.root.findByProps({ testID: 'profileQrShare' }).props.onPress();
    });
    expect(copyText).toHaveBeenCalledWith(URI);
    expect(shareSpy).toHaveBeenCalledWith({ message: URI });
    expect(JSON.stringify(tree.toJSON())).toContain(COPY.share);
    shareSpy.mockRestore();
    await act(async () => {
      tree.unmount();
    });
  });
});
