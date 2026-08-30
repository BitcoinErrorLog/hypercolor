import { buildPayUri, openPayUri, prepareRequestHandoff } from '../walletHandoff';
import { ENDPOINT_BITCOIN_P2TR, ENDPOINT_LIGHTNING_BOLT11 } from '../../../types/payment';
import {
  MAINNET_BOLT11_20U,
  MAINNET_BOLT11_20U_BTC,
  MAINNET_BOLT11_20U_HASH,
  MAINNET_BOLT11_AMOUNTLESS,
  MAINNET_P2PKH,
  MAINNET_P2TR,
} from './bolt11Vectors';

describe('buildPayUri', () => {
  it('builds lightning: and bitcoin: URIs from validated payloads', () => {
    expect(buildPayUri(ENDPOINT_LIGHTNING_BOLT11, MAINNET_BOLT11_20U)).toEqual({
      uri: `lightning:${MAINNET_BOLT11_20U}`,
      scheme: 'lightning',
    });
    expect(buildPayUri(ENDPOINT_BITCOIN_P2TR, MAINNET_P2TR, '0.001')).toEqual({
      uri: `bitcoin:${MAINNET_P2TR}?amount=0.001`,
      scheme: 'bitcoin',
    });
    expect(buildPayUri(ENDPOINT_BITCOIN_P2TR, MAINNET_P2PKH, '0.5')).toEqual({
      uri: `bitcoin:${MAINNET_P2PKH}?amount=0.5`,
      scheme: 'bitcoin',
    });
    expect(buildPayUri(ENDPOINT_LIGHTNING_BOLT11, MAINNET_BOLT11_20U.toUpperCase()).uri).toBe(
      `lightning:${MAINNET_BOLT11_20U}`,
    );
  });

  it('rejects javascript:, file://, whitespace, mixed-case bech32, and oversized addresses', () => {
    expect(() => buildPayUri(ENDPOINT_LIGHTNING_BOLT11, 'javascript:alert(1)')).toThrow();
    expect(() => buildPayUri(ENDPOINT_BITCOIN_P2TR, 'file:///etc/passwd')).toThrow();
    expect(() => buildPayUri(ENDPOINT_LIGHTNING_BOLT11, ` ${MAINNET_BOLT11_20U}`)).toThrow();
    expect(() => buildPayUri(ENDPOINT_LIGHTNING_BOLT11, `${MAINNET_BOLT11_20U}\n`)).toThrow();
    expect(() => buildPayUri(ENDPOINT_BITCOIN_P2TR, MAINNET_P2TR.toUpperCase())).toThrow();
    expect(() => buildPayUri(ENDPOINT_BITCOIN_P2TR, `bc1p${'a'.repeat(100)}`)).toThrow();
    expect(() => buildPayUri('https-url', 'https://evil.example')).toThrow();
  });
});

describe('prepareRequestHandoff', () => {
  it('blocks when the invoice amount differs from the request amount', () => {
    const result = prepareRequestHandoff({
      requestAmountBtc: '0.001',
      endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_20U,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('does not match the request amount');
    expect(result.invoiceAmountBtc).toBe(MAINNET_BOLT11_20U_BTC);
    expect(result.paymentHash).toBe(MAINNET_BOLT11_20U_HASH);
  });

  it('allows a matching invoice amount and surfaces the decoded amount', () => {
    const result = prepareRequestHandoff({
      requestAmountBtc: MAINNET_BOLT11_20U_BTC,
      endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_20U,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        scheme: 'lightning',
        requestAmountBtc: MAINNET_BOLT11_20U_BTC,
        invoiceAmountBtc: MAINNET_BOLT11_20U_BTC,
        paymentHash: MAINNET_BOLT11_20U_HASH,
        uri: `lightning:${MAINNET_BOLT11_20U}`,
      }),
    );
  });

  it('warns on an amountless invoice and names the request amount', () => {
    const result = prepareRequestHandoff({
      requestAmountBtc: '0.001',
      endpointIdentifier: ENDPOINT_LIGHTNING_BOLT11,
      payload: MAINNET_BOLT11_AMOUNTLESS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warning).toBe('Invoice has no amount. Enter 0.001 BTC in the wallet.');
    expect(result.invoiceAmountBtc).toBeNull();
    expect(result.uri).toBe(`lightning:${MAINNET_BOLT11_AMOUNTLESS}`);
  });

  it('binds bitcoin: URIs to the request amount', () => {
    const result = prepareRequestHandoff({
      requestAmountBtc: '0.001',
      endpointIdentifier: ENDPOINT_BITCOIN_P2TR,
      payload: MAINNET_P2TR,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        scheme: 'bitcoin',
        uri: `bitcoin:${MAINNET_P2TR}?amount=0.001`,
        requestAmountBtc: '0.001',
        invoiceAmountBtc: null,
      }),
    );
  });
});

describe('openPayUri', () => {
  it('opens when a wallet is installed', async () => {
    const openURL = jest.fn().mockResolvedValue(undefined);
    const result = await openPayUri(ENDPOINT_LIGHTNING_BOLT11, MAINNET_BOLT11_20U, {
      canOpenURL: async () => true,
      openURL,
    });
    expect(result).toBe('opened');
    expect(openURL).toHaveBeenCalledWith(`lightning:${MAINNET_BOLT11_20U}`);
  });

  it('falls back to copy-to-clipboard when canOpenURL is false', async () => {
    const copyText = jest.fn();
    const openURL = jest.fn();
    const result = await openPayUri(ENDPOINT_LIGHTNING_BOLT11, MAINNET_BOLT11_20U, {
      canOpenURL: async () => false,
      openURL,
      copyText,
      alert: (_title, _message, buttons) => {
        buttons?.find(button => button.text === 'Copy URI')?.onPress?.();
      },
    });
    expect(result).toBe('copied');
    expect(openURL).not.toHaveBeenCalled();
    expect(copyText).toHaveBeenCalledWith(`lightning:${MAINNET_BOLT11_20U}`);
  });
});
