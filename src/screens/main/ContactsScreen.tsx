import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Contact, MainTabParamList, RootStackParamList } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useContactStore } from '../../stores/contactStore';
import { StorageService } from '../../services/StorageService';
import { ContactsService } from '../../services/ContactsService';
import { TrustEngine } from '../../services/TrustEngine';
import { FollowsImportSettings } from '../../services/contacts/followsImportSettings';
import { contactsForOwner } from '../../services/contacts/contactOwnerScope';
import type { ImportFollowsRefreshResult } from '../../services/ContactsService';
import { ConfirmSheet } from '../../ui/contacts/ConfirmSheet';
import { CONTACTS_COPY } from '../../ui/contacts/contactsCopy';
import { partitionContacts } from '../../ui/contacts/relationshipBadge';
import { ContactQrScanner } from '../../ui/contacts/ContactQrScanner';
import { ContactDetailContainer } from './contacts/ContactDetailScreen';
import {
  afterManualContactAdded,
  pullToRefreshFollows,
  decideScannedContact,
  submitManualContact,
} from './contacts/contactsActions';
import {
  CONTACTS_EMPTY_BODY,
  CONTACTS_EMPTY_PRIMARY,
  CONTACTS_EMPTY_SECONDARY,
  CONTACTS_EMPTY_TITLE,
  ContactsScreenContent,
  IMPORT_FAILED,
  IMPORT_OFF_NOTE,
  LOAD_FAILED,
} from './contacts/ContactsScreenContent';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export {
  CONTACTS_EMPTY_BODY,
  CONTACTS_EMPTY_PRIMARY,
  CONTACTS_EMPTY_SECONDARY,
  CONTACTS_EMPTY_TITLE,
  ContactsScreenContent,
};

function importStatusText(result: ImportFollowsRefreshResult): string | null {
  if (result.skipped) return null;
  if (!result.ok) return null;
  if (result.imported === 0) return 'No confirmed follows yet.';
  return `Imported ${result.imported} confirmed follows as suggestions.`;
}

export default function ContactsScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<MainTabParamList, 'Contacts'>>();
  const ownerPubky = useAuthStore(s => s.pubky);
  const storeOwner = useContactStore(s => s.ownerPubky);
  const replaceContacts = useContactStore(s => s.replaceContacts);
  const upsertContact = useContactStore(s => s.upsertContact);
  const contactsMap = useContactStore(s => s.contacts);
  const detailPubky = useContactStore(s => s.detailPubky);
  const openContactDetail = useContactStore(s => s.openContactDetail);
  const closeContactDetail = useContactStore(s => s.closeContactDetail);
  const [, setConsentTick] = useState(0);

  useEffect(() => FollowsImportSettings.subscribe(() => setConsentTick(t => t + 1)), []);

  const followsImportEnabled = ownerPubky
    ? FollowsImportSettings.getFollowsImportEnabled(ownerPubky)
    : false;

  const storeContacts = contactsForOwner(
    ownerPubky && storeOwner === ownerPubky ? ownerPubky : null,
    contactsMap,
  );

  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importErrorDetails, setImportErrorDetails] = useState<string | null>(null);
  const [usedNexusFallback, setUsedNexusFallback] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorDetails, setLoadErrorDetails] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [unblockAndAddPubky, setUnblockAndAddPubky] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    const owner = useAuthStore.getState().pubky;
    if (!owner) return;
    try {
      const rows = await StorageService.getAllContacts(owner);
      for (const row of rows) {
        await TrustEngine.explain(row.pubky, owner);
      }
      if (useAuthStore.getState().pubky !== owner) return;
      const scored = await StorageService.getAllContacts(owner);
      if (useAuthStore.getState().pubky !== owner) return;
      replaceContacts(owner, scored);
      setLoadError(null);
      setLoadErrorDetails(null);
    } catch (err) {
      setLoadError(LOAD_FAILED);
      setLoadErrorDetails(err instanceof Error ? err.message : String(err));
    }
  }, [replaceContacts]);

  useEffect(() => {
    if (!ownerPubky) return;
    setUsedNexusFallback(false);
    setImportError(null);
    setImportErrorDetails(null);
    void loadLocal();
  }, [loadLocal, ownerPubky]);

  useEffect(() => {
    const focus = route.params?.focusPubky;
    if (focus) openContactDetail(focus);
  }, [openContactDetail, route.params?.focusPubky]);

  const applyRefreshResult = useCallback((result: ImportFollowsRefreshResult) => {
    if (result.skipped) return;
    setUsedNexusFallback(result.usedNexusFallback);
    if (!result.ok) {
      setImportError(IMPORT_FAILED);
      setImportErrorDetails(result.message);
      setImportStatus(null);
      const lower = result.message.toLowerCase();
      if (
        lower.includes('network') ||
        lower.includes('offline') ||
        lower.includes('failed to fetch')
      ) {
        setOffline(true);
      }
      return;
    }
    setOffline(false);
    setImportError(null);
    setImportErrorDetails(null);
    setImportStatus(importStatusText(result));
    AccessibilityInfo.announceForAccessibility(
      result.imported === 0
        ? 'No confirmed follows yet.'
        : `Imported ${result.imported} confirmed follows as suggestions.`,
    );
  }, []);

  const runImport = useCallback(async () => {
    const owner = useAuthStore.getState().pubky;
    if (!owner) return;
    if (!FollowsImportSettings.getFollowsImportEnabled(owner)) return;
    setImporting(true);
    try {
      const result = await ContactsService.refreshFollowsIfEnabled(owner);
      if (useAuthStore.getState().pubky !== owner) return;
      if (!FollowsImportSettings.getFollowsImportEnabled(owner)) return;
      applyRefreshResult(result);
      await loadLocal();
    } finally {
      setImporting(false);
    }
  }, [applyRefreshResult, loadLocal]);

  const handleRefresh = useCallback(async () => {
    const owner = useAuthStore.getState().pubky;
    if (!owner) return;
    setRefreshing(true);
    try {
      const result = await pullToRefreshFollows({
        ownerPubky: owner,
        refreshFollowsIfEnabled: ContactsService.refreshFollowsIfEnabled,
      });
      if (useAuthStore.getState().pubky !== owner) return;
      if (result) applyRefreshResult(result);
      await loadLocal();
    } finally {
      setRefreshing(false);
    }
  }, [applyRefreshResult, loadLocal]);

  const handleConfirmConsent = useCallback(() => {
    const owner = useAuthStore.getState().pubky;
    if (!owner) return;
    FollowsImportSettings.setFollowsImportEnabled(owner, true);
    setConsentOpen(false);
  }, []);

  useEffect(() => {
    if (!ownerPubky || !followsImportEnabled) return;
    void runImport();
  }, [ownerPubky, followsImportEnabled, runImport]);

  const handleStopFollows = useCallback(async () => {
    const owner = useAuthStore.getState().pubky;
    if (!owner) return;
    try {
      await ContactsService.stopUsingFollows(owner);
      if (useAuthStore.getState().pubky !== owner) return;
      setUsedNexusFallback(false);
      setImportStatus(IMPORT_OFF_NOTE);
      setImportError(null);
      setImportErrorDetails(null);
      await loadLocal();
    } catch (err) {
      setImportError('Could not stop using follows.');
      setImportErrorDetails(err instanceof Error ? err.message : String(err));
    }
  }, [loadLocal]);

  const handleScanAdd = useCallback(
    async (pubky: string, confirmUnblock = false) => {
      const owner = useAuthStore.getState().pubky;
      if (!owner) return;
      const result = await submitManualContact({
        ownerPubky: owner,
        pubky,
        confirmUnblock,
        addManualContact: (o, p, options) => ContactsService.addManualContact(o, p, options),
      });
      if (useAuthStore.getState().pubky !== owner) return;
      if (!result.ok) {
        if (result.reason === 'blocked') {
          setScanOpen(false);
          setUnblockAndAddPubky(pubky);
          return;
        }
        setScanError(result.message);
        return;
      }
      upsertContact(result.contact);
      const landing = afterManualContactAdded(result.contact.pubky);
      setScanOpen(false);
      setScanError(null);
      openContactDetail(landing.detailPubky);
    },
    [openContactDetail, upsertContact],
  );

  const handleAddSuggestion = useCallback(
    (pubky: string, confirmUnblock = false) => {
      const owner = useAuthStore.getState().pubky;
      if (!owner) return;
      void ContactsService.addManualContact(
        owner,
        pubky,
        confirmUnblock ? { confirmUnblock: true } : undefined,
      ).then(result => {
        if (useAuthStore.getState().pubky !== owner) return;
        if (!result.ok) {
          if (result.reason === 'blocked') setUnblockAndAddPubky(pubky);
          return;
        }
        upsertContact(result.contact);
        openContactDetail(result.contact.pubky);
      });
    },
    [openContactDetail, upsertContact],
  );

  if (detailPubky) {
    return <ContactDetailContainer pubky={detailPubky} onBack={closeContactDetail} />;
  }

  const sorted = sortContactsForDisplay(storeContacts);
  const { contacts, suggestions } = partitionContacts(sorted);
  const blockState: Record<string, 'blocked' | 'cleanup-pending'> = {};
  if (ownerPubky) {
    for (const row of sorted) {
      if (!FollowsImportSettings.isBlocked(ownerPubky, row.pubky)) continue;
      blockState[row.pubky] = FollowsImportSettings.isBlockCleanupPending(ownerPubky, row.pubky)
        ? 'cleanup-pending'
        : 'blocked';
    }
  }

  return (
    <>
      <ContactsScreenContent
        contacts={contacts}
        suggestions={followsImportEnabled ? suggestions : []}
        followsImportEnabled={followsImportEnabled}
        blockState={blockState}
        refreshing={refreshing}
        importing={importing}
        consentOpen={consentOpen}
        importStatus={importStatus}
        importError={importError}
        importErrorDetails={importErrorDetails}
        usedNexusFallback={usedNexusFallback}
        loadError={loadError}
        loadErrorDetails={loadErrorDetails}
        offline={offline}
        onRefresh={() => {
          void handleRefresh();
        }}
        onAdd={() => nav.navigate('ContactSearch')}
        onOpenContact={openContactDetail}
        onUseFollows={() => setConsentOpen(true)}
        onConsentConfirm={() => {
          handleConfirmConsent();
        }}
        onConsentDismiss={() => setConsentOpen(false)}
        onRefreshFollows={() => {
          void runImport();
        }}
        onStopFollows={() => {
          void handleStopFollows();
        }}
        onAddSuggestion={pubky => {
          handleAddSuggestion(pubky);
        }}
        onRetryLoad={() => {
          void loadLocal();
        }}
        onRetryImport={() => {
          void runImport();
        }}
        onScanQr={() => {
          setScanError(null);
          setScanOpen(true);
        }}
      />
      <ContactQrScanner
        visible={scanOpen}
        error={scanError}
        onClose={() => {
          setScanOpen(false);
          setScanError(null);
        }}
        onManualFallback={() => {
          setScanOpen(false);
          setScanError(null);
          nav.navigate('ContactSearch');
        }}
        onBarcode={raw => {
          const decision = decideScannedContact(raw, ownerPubky);
          if (decision.kind === 'error') {
            setScanError(decision.message);
            return;
          }
          void handleScanAdd(decision.pubky);
        }}
      />
      <ConfirmSheet
        visible={unblockAndAddPubky !== null}
        title={CONTACTS_COPY.unblockAndAddTitle}
        body={CONTACTS_COPY.unblockBody}
        confirmLabel={CONTACTS_COPY.unblockAndAddConfirm}
        onDismiss={() => setUnblockAndAddPubky(null)}
        onConfirm={() => {
          const target = unblockAndAddPubky;
          setUnblockAndAddPubky(null);
          if (target) handleAddSuggestion(target, true);
        }}
      />
    </>
  );
}

function sortContactsForDisplay(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const rank = (c: Contact) => (c.isMutual ? 3 : c.isFollowing ? 2 : c.isFollower ? 1 : 0);
    const rankDiff = rank(b) - rank(a);
    if (rankDiff !== 0) return rankDiff;
    return b.trustScore - a.trustScore;
  });
}
