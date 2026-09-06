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
import { blockPeer, unblockPeer } from '../../../services/contacts/blockPeer';
import { useAuthStore } from '../../../stores/authStore';
import { useContactStore } from '../../../stores/contactStore';
import { copyText } from '../../../utils/copyText';
import { ContactDetailView, linkStateLabel } from './ContactDetailView';
import { loadContactDetail } from './contactDetailLoad';
import { sanitizeDisplayName } from '../../../lib/sanitizeDisplayName';

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
  const storedPubky = stored?.pubky;
  const removeContact = useContactStore(s => s.removeContact);
  const [contact, setContact] = useState<Contact | null>(stored ?? null);
  const [loading, setLoading] = useState(!stored);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorDetails, setLoadErrorDetails] = useState<string | null>(null);
  const [trust, setTrust] = useState<TrustExplanation | null>(null);
  const [linkLabel, setLinkLabel] = useState(linkStateLabel(null));
  const [paymentIdentifiers, setPaymentIdentifiers] = useState<string[]>([]);
  const [paymentsUnavailableOffline, setPaymentsUnavailableOffline] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [, setPrivacyTick] = useState(0);
  const [nickname, setNickname] = useState('');

  useEffect(() => FollowsImportSettings.subscribe(() => setPrivacyTick(t => t + 1)), []);

  useEffect(() => {
    if (!ownerPubky) return undefined;
    void FollowsImportSettings.hydrate(ownerPubky);
    return undefined;
  }, [ownerPubky]);

  const followsImportEnabled = ownerPubky
    ? FollowsImportSettings.getFollowsImportEnabled(ownerPubky)
    : false;
  const blocked = ownerPubky ? FollowsImportSettings.isBlocked(ownerPubky, pubky) : false;
  const cleanupPending = ownerPubky
    ? FollowsImportSettings.isBlockCleanupPending(ownerPubky, pubky)
    : false;

  const applyLoad = useCallback(
    (result: Awaited<ReturnType<typeof loadContactDetail>>) => {
      if (result === 'cancelled') return;
      const stillBlocked = ownerPubky ? FollowsImportSettings.isBlocked(ownerPubky, pubky) : false;
      if (!result.contact && stillBlocked) {
        setContact(null);
        setTrust(null);
        setLinkLabel(linkStateLabel(null));
        setPaymentIdentifiers([]);
        setPaymentsUnavailableOffline(false);
        setLoadError(null);
        setLoadErrorDetails(null);
        setLoading(false);
        return;
      }
      setContact(result.contact);
      setTrust(result.trust);
      setLinkLabel(result.linkLabel);
      setPaymentIdentifiers(result.paymentIdentifiers);
      setPaymentsUnavailableOffline(result.paymentsUnavailableOffline);
      setLoadError(result.loadError);
      setLoadErrorDetails(result.loadErrorDetails);
      setLoading(false);
    },
    [ownerPubky, pubky],
  );

  useEffect(() => {
    if (!ownerPubky) return undefined;
    let cancelled = false;
    const ownerAtStart = ownerPubky;
    const row = useContactStore.getState().contacts[pubky];
    const cached =
      row &&
      row.ownerPubky === ownerAtStart &&
      useContactStore.getState().ownerPubky === ownerAtStart
        ? row
        : undefined;
    void loadContactDetail({
      ownerPubky: ownerAtStart,
      pubky,
      stored: cached,
      isCurrent: () => !cancelled,
      getContact: (peer, owner) => StorageService.getContact(peer, owner),
      explainTrust: (peer, owner) => TrustEngine.explain(peer, owner),
      getLink: (owner, peer) => StorageService.getLink(owner, peer),
      getPeerTipEndpoints: peer => PaymentService.getPeerTipEndpoints(peer),
    }).then(result => {
      if (cancelled) return;
      applyLoad(result);
      void StorageService.getContactNickname(ownerAtStart, pubky).then(value => {
        if (!cancelled) setNickname(value ?? '');
      });
    });
    return () => {
      cancelled = true;
    };
  }, [applyLoad, ownerPubky, pubky, storedPubky, reloadToken]);

  const runBlock = useCallback(async () => {
    if (!ownerPubky) return;
    const result = await blockPeer({
      ownerPubky,
      peerPubky: pubky,
      persistBlock: (owner, peer) => FollowsImportSettings.block(owner, peer),
      declineMessageRequest: peer => LinkService.declineMessageRequest(peer),
      deleteContact: (owner, peer) => StorageService.deleteContact(owner, peer),
      persistCleanupPending: (owner, peer) =>
        FollowsImportSettings.markBlockCleanupPending(owner, peer),
      clearCleanupPending: (owner, peer) =>
        FollowsImportSettings.clearBlockCleanupPending(owner, peer),
    });
    if (result.cleanup === 'complete') {
      removeContact(pubky);
      AccessibilityInfo.announceForAccessibility('Pubky blocked');
      onBack();
      return;
    }
    setLoadErrorDetails(result.details);
  }, [onBack, ownerPubky, pubky, removeContact]);

  const runUnblock = useCallback(async () => {
    if (!ownerPubky) return;
    await unblockPeer({
      ownerPubky,
      peerPubky: pubky,
      persistUnblock: (owner, peer) => FollowsImportSettings.unblock(owner, peer),
      releaseDeclinedRequest: (owner, peer) => LinkService.releaseDeclinedRequest(owner, peer),
      clearCleanupPending: (owner, peer) =>
        FollowsImportSettings.clearBlockCleanupPending(owner, peer),
    });
    AccessibilityInfo.announceForAccessibility('Pubky unblocked');
    if (!contact) {
      onBack();
      return;
    }
    setReloadToken(t => t + 1);
  }, [contact, onBack, ownerPubky, pubky]);

  return (
    <ContactDetailView
      pubky={pubky}
      contact={contact}
      loading={loading}
      loadError={loadError}
      loadErrorDetails={loadErrorDetails}
      trust={trust}
      linkLabel={linkLabel}
      paymentIdentifiers={paymentIdentifiers}
      paymentsUnavailableOffline={paymentsUnavailableOffline}
      followsImportEnabled={followsImportEnabled}
      blocked={blocked}
      cleanupPending={cleanupPending}
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
        if (cleanupPending) {
          void runBlock();
          return;
        }
        setLoading(true);
        setLoadError(null);
        setLoadErrorDetails(null);
        setReloadToken(t => t + 1);
      }}
      onBlock={() => {
        void runBlock();
      }}
      onUnblock={() => {
        void runUnblock();
      }}
      onRemove={() => {
        if (!ownerPubky) return;
        void StorageService.deleteContact(ownerPubky, pubky);
        removeContact(pubky);
        onBack();
      }}
      nickname={nickname}
      onChangeNickname={setNickname}
      onSaveNickname={() => {
        if (!ownerPubky) return;
        const next = sanitizeDisplayName(nickname);
        setNickname(next);
        void StorageService.setContactNickname(ownerPubky, pubky, next);
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
