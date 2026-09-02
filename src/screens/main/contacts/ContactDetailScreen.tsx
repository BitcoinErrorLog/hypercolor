import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, RootStackParamList } from '../../../types';
import { threadRouteParams } from '../../../types/link';
import type { TrustExplanation } from '../../../services/TrustEngine';
import { TrustEngine } from '../../../services/TrustEngine';
import { StorageService } from '../../../services/StorageService';
import { PaymentService } from '../../../services/payments/PaymentService';
import { LinkService } from '../../../services/link/LinkService';
import { FollowsImportSettings } from '../../../services/contacts/followsImportSettings';
import { blockPeer } from '../../../services/contacts/blockPeer';
import { useAuthStore } from '../../../stores/authStore';
import { useContactStore } from '../../../stores/contactStore';
import { copyText } from '../../../utils/copyText';
import { ContactDetailView, linkStateLabel } from './ContactDetailView';

export { ContactDetailView, linkStateLabel } from './ContactDetailView';

export function ContactDetailContainer({ pubky, onBack }: { pubky: string; onBack: () => void }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const stored = useContactStore(s => {
    const row = s.contacts[pubky];
    if (!row || !ownerPubky) return undefined;
    if (s.ownerPubky !== ownerPubky) return undefined;
    if (row.ownerPubky !== ownerPubky) return undefined;
    return row;
  });
  const removeContact = useContactStore(s => s.removeContact);
  const [contact, setContact] = useState<Contact | null>(stored ?? null);
  const [loading, setLoading] = useState(!stored);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorDetails, setLoadErrorDetails] = useState<string | null>(null);
  const [trust, setTrust] = useState<TrustExplanation | null>(null);
  const [linkLabel, setLinkLabel] = useState(linkStateLabel(null));
  const [paymentIdentifiers, setPaymentIdentifiers] = useState<string[]>([]);
  const [paymentsUnavailableOffline, setPaymentsUnavailableOffline] = useState(false);
  const followsImportEnabled = ownerPubky
    ? FollowsImportSettings.getFollowsImportEnabled(ownerPubky)
    : false;

  const load = useCallback(async () => {
    if (!ownerPubky) return;
    setLoading(true);
    setLoadError(null);
    setLoadErrorDetails(null);
    try {
      const row = stored ?? (await StorageService.getContact(pubky, ownerPubky));
      if (!row || row.ownerPubky !== ownerPubky) {
        setContact(null);
        setLoadError('Could not load this contact.');
        return;
      }
      setContact(row);
      const explained = await TrustEngine.explain(row.pubky, ownerPubky);
      setTrust(explained);
      const link = await StorageService.getLink(ownerPubky, row.pubky);
      const status =
        link?.status === 'established' || link?.status === 'handshaking' ? link.status : null;
      setLinkLabel(linkStateLabel(status));
      try {
        const tips = await PaymentService.getPeerTipEndpoints(row.pubky);
        setPaymentIdentifiers(tips.map(t => t.identifier));
        setPaymentsUnavailableOffline(false);
      } catch {
        setPaymentsUnavailableOffline(true);
        setPaymentIdentifiers([]);
      }
    } catch (err) {
      setLoadError('Could not load this contact.');
      setLoadErrorDetails(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ownerPubky, pubky, stored]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ContactDetailView
      contact={contact}
      loading={loading}
      loadError={loadError}
      loadErrorDetails={loadErrorDetails}
      trust={trust}
      linkLabel={linkLabel}
      paymentIdentifiers={paymentIdentifiers}
      paymentsUnavailableOffline={paymentsUnavailableOffline}
      followsImportEnabled={followsImportEnabled}
      onBack={onBack}
      onMessage={() => nav.navigate('Thread', threadRouteParams(pubky))}
      onCopy={() => {
        copyText(pubky);
        AccessibilityInfo.announceForAccessibility('Pubky copied');
      }}
      onShare={() => {
        void Share.share({ message: pubky });
      }}
      onRetry={() => {
        void load();
      }}
      onBlock={() => {
        if (!ownerPubky) return;
        void (async () => {
          try {
            await blockPeer({
              ownerPubky,
              peerPubky: pubky,
              persistBlock: (owner, peer) => FollowsImportSettings.block(owner, peer),
              declineMessageRequest: peer => LinkService.declineMessageRequest(peer),
              deleteContact: (owner, peer) => StorageService.deleteContact(owner, peer),
            });
            removeContact(pubky);
            AccessibilityInfo.announceForAccessibility('Pubky blocked');
            onBack();
          } catch (err) {
            setLoadError('Could not block this pubky.');
            setLoadErrorDetails(err instanceof Error ? err.message : String(err));
          }
        })();
      }}
      onRemove={() => {
        if (!ownerPubky) return;
        void StorageService.deleteContact(ownerPubky, pubky);
        removeContact(pubky);
        onBack();
      }}
    />
  );
}

/**
 * Root-stack screen. Parent merge must register this on RootNavigator as
 * `<Stack.Screen name="ContactDetail" ...>` — this branch must not edit that file.
 */
export default function ContactDetailScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ContactDetail'>>();
  return <ContactDetailContainer pubky={route.params.pubky} onBack={() => nav.goBack()} />;
}
