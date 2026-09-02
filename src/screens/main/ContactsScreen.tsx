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
import { partitionContacts } from '../../ui/contacts/relationshipBadge';
import { ContactDetailContainer } from './contacts/ContactDetailScreen';
import { pullToRefreshFollows } from './contacts/contactsActions';
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

  if (detailPubky) {
    return <ContactDetailContainer pubky={detailPubky} onBack={closeContactDetail} />;
  }

  const sorted = sortContactsForDisplay(storeContacts);
  const { contacts, suggestions } = partitionContacts(sorted);

  return (
    <ContactsScreenContent
      contacts={contacts}
      suggestions={followsImportEnabled ? suggestions : []}
      followsImportEnabled={followsImportEnabled}
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
        const owner = useAuthStore.getState().pubky;
        if (!owner) return;
        void ContactsService.addManualContact(owner, pubky).then(result => {
          if (useAuthStore.getState().pubky !== owner) return;
          if (result.ok) {
            upsertContact(result.contact);
            openContactDetail(result.contact.pubky);
          }
        });
      }}
      onRetryLoad={() => {
        void loadLocal();
      }}
      onRetryImport={() => {
        void runImport();
      }}
    />
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
