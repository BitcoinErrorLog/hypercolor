import React from 'react';
import { Image } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AuthQr, generateAuthQrDataUri } from '../AuthQr';

const PUBKYAUTH_URL =
  'pubkyauth:///?caps=/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw&secret=abc&relay=https://relay.example';

const PUBKYAUTH_URL_B =
  'pubkyauth:///?caps=/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw&secret=xyz&relay=https://httprelay.pubky.app/link/';

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

async function unmount(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    tree.unmount();
  });
}

function imageUri(tree: ReactTestRenderer): string | undefined {
  const image = tree.root.findByType(Image);
  const source = image.props.source as { uri?: string };
  return source.uri;
}

describe('AuthQr', () => {
  it('renders nothing when value is empty', async () => {
    const tree = await render(<AuthQr value="" />);
    expect(tree.toJSON()).toBeNull();
    await unmount(tree);
  });

  it('renders a QR image for a pubkyauth URL', async () => {
    const tree = await render(<AuthQr value={PUBKYAUTH_URL} />);
    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    const uri = imageUri(tree);
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect((uri ?? '').length).toBeGreaterThan(100);
    await unmount(tree);
  });

  it('renders a QR image for a second pubkyauth URL', async () => {
    const tree = await render(<AuthQr value={PUBKYAUTH_URL_B} />);
    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    expect(imageUri(tree)).toMatch(/^data:image\/png;base64,/);
    await unmount(tree);
  });

  it('generateAuthQrDataUri encodes distinct pubkyauth payloads', () => {
    const uriA = generateAuthQrDataUri(PUBKYAUTH_URL);
    const uriB = generateAuthQrDataUri(PUBKYAUTH_URL_B);
    expect(uriA).toMatch(/^data:image\/png;base64,/);
    expect(uriB).toMatch(/^data:image\/png;base64,/);
    expect(uriA).not.toEqual(uriB);
  });
});
