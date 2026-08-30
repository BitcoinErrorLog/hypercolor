import React from 'react';
import { Image } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AuthQr, generateAuthQrDataUri } from '../AuthQr';

const PUBKYAUTH_URL =
  'pubkyauth:///?caps=/pub/paykit/:rw,/pub/hypercolor.app/v1/:rw&secret=abc&relay=https://relay.example';

const PAYKIT_CONNECT_URL =
  'pubkyring://paykit-connect?deviceId=hypercolor-sim&callback=hypercolor%3A%2F%2Fring-callback&ephemeralPk=aabbcc&caps=%2Fpub%2Fpaykit%2F%3Arw%2C%2Fpub%2Fhypercolor.app%2Fv1%2F%3Arw';

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

  it('renders a QR image for a paykit-connect URL', async () => {
    const tree = await render(<AuthQr value={PAYKIT_CONNECT_URL} />);
    expect(tree.root.findAllByProps({ testID: 'authQr' }).length).toBeGreaterThan(0);
    expect(imageUri(tree)).toMatch(/^data:image\/png;base64,/);
    await unmount(tree);
  });

  it('generateAuthQrDataUri encodes pubkyauth and paykit-connect payloads', () => {
    const paykitUri = generateAuthQrDataUri(PAYKIT_CONNECT_URL);
    const pubkyauthUri = generateAuthQrDataUri(PUBKYAUTH_URL);
    expect(paykitUri).toMatch(/^data:image\/png;base64,/);
    expect(pubkyauthUri).toMatch(/^data:image\/png;base64,/);
    expect(pubkyauthUri).not.toEqual(paykitUri);
  });
});
