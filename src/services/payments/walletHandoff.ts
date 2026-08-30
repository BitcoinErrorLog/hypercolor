import { Alert, Clipboard, Linking } from 'react-native';
import {
  isValidBolt11,
  isValidOnchainAddress,
  schemeForEndpointIdentifier,
} from '../../types/payment';

export type WalletHandoffDeps = {
  canOpenURL?: (url: string) => Promise<boolean>;
  openURL?: (url: string) => Promise<void>;
  alert?: (title: string, message: string, buttons?: AlertButton[]) => void;
  copyText?: (text: string) => void;
};

type AlertButton = { text: string; onPress?: () => void; style?: 'cancel' | 'default' };

export type BuiltPayUri = {
  uri: string;
  scheme: 'lightning' | 'bitcoin';
};

/**
 * Build a lightning: or bitcoin: URI from a validated endpoint payload.
 * Never passes the raw wire string through — only reconstructed schemes
 * after S3 charset checks. Other schemes are impossible by construction.
 */
export function buildPayUri(endpointIdentifier: string, payload: string): BuiltPayUri {
  const scheme = schemeForEndpointIdentifier(endpointIdentifier);
  if (scheme === 'lightning') {
    if (!isValidBolt11(payload)) {
      throw new Error('bolt11 invoice failed validation');
    }
    return { uri: `lightning:${payload.toLowerCase()}`, scheme };
  }
  if (scheme === 'bitcoin') {
    if (!isValidOnchainAddress(payload)) {
      throw new Error('on-chain address failed validation');
    }
    return { uri: `bitcoin:${payload}`, scheme };
  }
  throw new Error('endpoint identifier is not a lightning or bitcoin destination');
}

export async function openPayUri(
  endpointIdentifier: string,
  payload: string,
  deps: WalletHandoffDeps = {},
): Promise<'opened' | 'copied'> {
  const { uri } = buildPayUri(endpointIdentifier, payload);
  const canOpen = deps.canOpenURL ?? ((url: string) => Linking.canOpenURL(url));
  const openURL = deps.openURL ?? ((url: string) => Linking.openURL(url));
  const alert = deps.alert ?? Alert.alert;
  const copyText = deps.copyText ?? ((text: string) => Clipboard.setString(text));

  const available = await canOpen(uri);
  if (available) {
    await openURL(uri);
    return 'opened';
  }

  await new Promise<void>(resolve => {
    alert(
      'No wallet installed',
      'Copy the payment URI and paste it into a wallet that supports lightning: or bitcoin: links.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
        {
          text: 'Copy URI',
          onPress: () => {
            copyText(uri);
            resolve();
          },
        },
      ],
    );
  });
  return 'copied';
}
