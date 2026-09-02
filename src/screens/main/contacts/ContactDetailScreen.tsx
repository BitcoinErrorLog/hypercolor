import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, PubkyKey, RootStackParamList } from '../../../types';
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
import { loadContactDetail } from './contactDetailLoad';

export { ContactDetailView, linkStateLabel } from './ContactDetailView';

export function ContactDetailContainer({ pubky, onBack }: { pubky: string; onBack: () => void }) {
  const ownerPubky = useAuthStore(s => s.pubky);
  return (
    <ContactDetailLoader
      key={`${ownerPubky ?? ''}:${pubky}`}
      pubky={pubky}
      ownerPubky={ownerPubky}
      onBack={onBack}
    />
  );
}

function ContactDetailLoader({
  pubky,
  ownerPubky,
  onBack,
}: {
  pubky: string;
  ownerPubky: PubkyKey | null;
  onBack: () => void;
}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
  const [retryCleansUpBlock, setRetryCleansUpBlock] = useState(false);
  const [trust, setTrust] = useState<TrustExplanation | null>(null);
  const [linkLabel, setLinkLabel] = useState(linkStateLabel(null));
  const [paymentIdentifiers, setPaymentIdentifiers] = useState<string[]>([]);
  const [paymentsUnavailableOffline, setPaymentsUnavailableOffline] = useState(false);
  const followsImportEnabled = ownerPubky
    ? FollowsImportSettings.getFollowsImportEnabled(ownerPubky)
    : false;

  const applyLoad = useCallback((result: Awaited<ReturnType<typeof loadContactDetail>>) => {
    if (result === 'cancelled') return;
    setContact(result.contact);
    setTrust(result.trust);
    setLinkLabel(result.linkLabel);
    setPaymentIdentifiers(result.paymentIdentifiers);
    setPaymentsUnavailableOffline(result.paymentsUnavailableOffline);
    setLoadError(result.loadError);
    setLoadErrorDetails(result.loadErrorDetails);
    setRetryCleansUpBlock(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ownerPubky) return undefined;
    let cancelled = false;
    const ownerAtStart = ownerPubky;
    void loadContactDetail({
      ownerPubky: ownerAtStart,
      pubky,
      stored,
      isCurrent: () => !cancelled,
      getContact: (peer, owner) => StorageService.getContact(peer, owner),
      explainTrust: (peer, owner) => TrustEngine.explain(peer, owner),
      getLink: (owner, peer) => StorageService.getLink(owner, peer),
      getPeerTipEndpoints: peer => PaymentService.getPeerTipEndpoints(peer),
    }).then(result => {
      if (cancelled) return;
      applyLoad(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyLoad, ownerPubky, pubky, stored]);

  const runBlock = useCallback(async () => {
    if (!ownerPubky) return;
    const result = await blockPeer({
      ownerPubky,
      peerPubky: pubky,
      persistBlock: (owner, peer) => FollowsImportSettings.block(owner, peer),
      declineMessageRequest: peer => LinkService.declineMessageRequest(peer),
      deleteContact: (owner, peer) => StorageService.deleteContact(owner, peer),
    });
    if (result.cleanup === 'complete') {
      removeContact(pubky);
      AccessibilityInfo.announceForAccessibility('Pubky blocked');
      onBack();
      return;
    }
    setRetryCleansUpBlock(true);
    setLoadError(result.message);
    setLoadErrorDetails(result.details);
  }, [onBack, ownerPubky, pubky, removeContact]);

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
        if (retryCleansUpBlock) {
          void runBlock();
          return;
        }
        if (!ownerPubky) return;
        setLoading(true);
        setLoadError(null);
        setLoadErrorDetails(null);
        void loadContactDetail({
          ownerPubky,
          pubky,
          stored,
          isCurrent: () => true,
          getContact: (peer, owner) => StorageService.getContact(peer, owner),
          explainTrust: (peer, owner) => TrustEngine.explain(peer, owner),
          getLink: (owner, peer) => StorageService.getLink(owner, peer),
          getPeerTipEndpoints: peer => PaymentService.getPeerTipEndpoints(peer),
        }).then(applyLoad);
      }}
      onBlock={() => {
        void runBlock();
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
