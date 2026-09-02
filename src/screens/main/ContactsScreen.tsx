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
  const upsertContact = useContactStore(s => s.upsertContact);
  const removeContact = useContactStore(s => s.removeContact);
  const contactsMap = useContactStore(s => s.contacts);
  const detailPubky = useContactStore(s => s.detailPubky);
  const openContactDetail = useContactStore(s => s.openContactDetail);
  const closeContactDetail = useContactStore(s => s.closeContactDetail);
  const storeContacts = Object.values(contactsMap);

  const [followsImportEnabled, setFollowsImportEnabled] = useState(() =>
    ownerPubky ? FollowsImportSettings.getFollowsImportEnabled(ownerPubky) : false,
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
    if (!ownerPubky) return;
    try {
      const rows = await StorageService.getAllContacts(ownerPubky);
      for (const row of rows) {
        await TrustEngine.explain(row.pubky, ownerPubky);
      }
      const scored = await StorageService.getAllContacts(ownerPubky);
      scored.forEach(upsertContact);
      setLoadError(null);
      setLoadErrorDetails(null);
    } catch (err) {
      setLoadError(LOAD_FAILED);
      setLoadErrorDetails(err instanceof Error ? err.message : String(err));
    }
  }, [ownerPubky, upsertContact]);

  useEffect(() => {
    if (!ownerPubky) return;
    setFollowsImportEnabled(FollowsImportSettings.getFollowsImportEnabled(ownerPubky));
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
    if (!ownerPubky) return;
    setImporting(true);
    try {
      const result = await ContactsService.refreshFollowsIfEnabled(ownerPubky, true);
      applyRefreshResult(result);
      await loadLocal();
    } finally {
      setImporting(false);
    }
  }, [applyRefreshResult, loadLocal, ownerPubky]);

  const handleRefresh = useCallback(async () => {
    if (!ownerPubky) return;
    setRefreshing(true);
    try {
      const result = await pullToRefreshFollows({
        ownerPubky,
        followsImportEnabled,
        refreshFollowsIfEnabled: (owner, enabled) =>
          ContactsService.refreshFollowsIfEnabled(owner, enabled),
      });
      if (result) applyRefreshResult(result);
      await loadLocal();
    } finally {
      setRefreshing(false);
    }
  }, [applyRefreshResult, followsImportEnabled, loadLocal, ownerPubky]);

  const handleConfirmConsent = useCallback(() => {
    if (!ownerPubky) return;
    FollowsImportSettings.setFollowsImportEnabled(ownerPubky, true);
    setFollowsImportEnabled(true);
    setConsentOpen(false);
  }, [ownerPubky]);

  useEffect(() => {
    if (!ownerPubky || !followsImportEnabled) return;
    void runImport();
    // Opening Contacts re-reads follows only while import is on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerPubky, followsImportEnabled]);

  const handleStopFollows = useCallback(async () => {
    if (!ownerPubky) return;
    await ContactsService.stopUsingFollows(ownerPubky);
    FollowsImportSettings.setFollowsImportEnabled(ownerPubky, false);
    setFollowsImportEnabled(false);
    setUsedNexusFallback(false);
    setImportStatus(IMPORT_OFF_NOTE);
    setImportError(null);
    const remaining = Object.values(useContactStore.getState().contacts);
    for (const row of remaining) {
      if (!row.addedManually) removeContact(row.pubky);
    }
    await loadLocal();
  }, [loadLocal, ownerPubky, removeContact]);

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
        void handleConfirmConsent();
      }}
      onConsentDismiss={() => setConsentOpen(false)}
      onRefreshFollows={() => {
        void runImport();
      }}
      onStopFollows={() => {
        void handleStopFollows();
      }}
      onAddSuggestion={pubky => {
        if (!ownerPubky) return;
        void ContactsService.addManualContact(ownerPubky, pubky).then(result => {
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
