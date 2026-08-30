import { buildPayUri, openPayUri } from '../walletHandoff';
import { ENDPOINT_BITCOIN_P2TR, ENDPOINT_LIGHTNING_BOLT11 } from '../../../types/payment';

const BOLT11 = 'lnbc1abcdefghijklmnopqrstuvwxyz';
const BECH32 = 'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k';

describe('buildPayUri', () => {
  it('builds lightning: and bitcoin: URIs from validated payloads', () => {
    expect(buildPayUri(ENDPOINT_LIGHTNING_BOLT11, BOLT11)).toEqual({
      uri: `lightning:${BOLT11}`,
      scheme: 'lightning',
    });
    expect(buildPayUri(ENDPOINT_BITCOIN_P2TR, BECH32)).toEqual({
      uri: `bitcoin:${BECH32}`,
      scheme: 'bitcoin',
    });
    expect(buildPayUri(ENDPOINT_BITCOIN_P2TR, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toEqual({
      uri: 'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      scheme: 'bitcoin',
    });
    expect(buildPayUri(ENDPOINT_LIGHTNING_BOLT11, 'LNBC1ABCDEFGHIJKLMNOPQRSTUVWXYZ').uri).toBe(
      'lightning:lnbc1abcdefghijklmnopqrstuvwxyz',
    );
  });

  it('rejects javascript:, file://, whitespace, mixed-case bech32, and oversized addresses', () => {
    expect(() => buildPayUri(ENDPOINT_LIGHTNING_BOLT11, 'javascript:alert(1)')).toThrow();
    expect(() => buildPayUri(ENDPOINT_BITCOIN_P2TR, 'file:///etc/passwd')).toThrow();
    expect(() => buildPayUri(ENDPOINT_LIGHTNING_BOLT11, ` ${BOLT11}`)).toThrow();
    expect(() => buildPayUri(ENDPOINT_LIGHTNING_BOLT11, `${BOLT11}\n`)).toThrow();
    expect(() => buildPayUri(ENDPOINT_BITCOIN_P2TR, BECH32.toUpperCase())).toThrow();
    expect(() => buildPayUri(ENDPOINT_BITCOIN_P2TR, `bc1p${'a'.repeat(100)}`)).toThrow();
    expect(() => buildPayUri('https-url', 'https://evil.example')).toThrow();
  });
});

describe('openPayUri', () => {
  it('opens when a wallet is installed', async () => {
    const openURL = jest.fn().mockResolvedValue(undefined);
    const result = await openPayUri(ENDPOINT_LIGHTNING_BOLT11, BOLT11, {
      canOpenURL: async () => true,
      openURL,
    });
    expect(result).toBe('opened');
    expect(openURL).toHaveBeenCalledWith(`lightning:${BOLT11}`);
  });

  it('falls back to copy-to-clipboard when canOpenURL is false', async () => {
    const copyText = jest.fn();
    const openURL = jest.fn();
    const result = await openPayUri(ENDPOINT_LIGHTNING_BOLT11, BOLT11, {
      canOpenURL: async () => false,
      openURL,
      copyText,
      alert: (_title, _message, buttons) => {
        buttons?.find(button => button.text === 'Copy URI')?.onPress?.();
      },
    });
    expect(result).toBe('copied');
    expect(openURL).not.toHaveBeenCalled();
    expect(copyText).toHaveBeenCalledWith(`lightning:${BOLT11}`);
  });
});
