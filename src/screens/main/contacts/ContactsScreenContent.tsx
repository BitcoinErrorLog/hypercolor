import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  SafeAreaView,
} from 'react-native';
import type { Contact } from '../../../types';
import { FollowsConsentSheet } from '../../../ui/contacts/FollowsConsentSheet';
import { ContactErrorBlock } from '../../../ui/contacts/ContactErrorBlock';
import { relationshipChips } from '../../../ui/contacts/relationshipBadge';
import { contactRowAccessLabel } from '../../../ui/contacts/shortPubky';
import {
  CONTACTS_BODY,
  CONTACTS_BRAND,
  CONTACTS_CANVAS,
  CONTACTS_ERROR,
  CONTACTS_HAIRLINE,
  CONTACTS_MUTED,
  CONTACTS_RADIUS,
  MIN_TARGET,
} from '../../../ui/contacts/tokens';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
import { contactPrimaryText, contactSecondaryText } from './contactIdentity';
import { color, space, radius, typeRole } from '../../../theme';

export const CONTACTS_EMPTY_TITLE = 'No contacts yet.';
export const CONTACTS_EMPTY_BODY =
  'Add someone by pubky, or use your public pubky.app follows to recognise people you already know.';
export const CONTACTS_EMPTY_PRIMARY = 'Add someone by pubky';
export const CONTACTS_EMPTY_SECONDARY = 'Use my follows';
const SUGGESTIONS_HEADER = 'Suggestions from your follows';
const SUGGESTIONS_SUBCOPY =
  'Not your contact list. Add one to keep them. Hypercolor never writes a follow.';
const FOLLOWS_SECTION_TITLE = 'pubky.app follows';
export const IMPORT_OFF_NOTE = 'Import is off. Imported suggestions were cleared.';
const NEXUS_FALLBACK_NOTE = 'Read from the public index and re-checked against your homeserver.';
export const IMPORT_FAILED = 'Could not read your follows.';
export const LOAD_FAILED = 'Could not load contacts.';

export function ContactsScreenContent({
  contacts,
  suggestions,
  followsImportEnabled,
  blockState = {},
  refreshing,
  importing,
  consentOpen,
  importStatus,
  importError,
  importErrorDetails,
  usedNexusFallback,
  loadError,
  loadErrorDetails,
  offline,
  onRefresh,
  onAdd,
  onOpenContact,
  onUseFollows,
  onConsentConfirm,
  onConsentDismiss,
  onRefreshFollows,
  onStopFollows,
  onAddSuggestion,
  onRetryLoad,
  onRetryImport,
}: {
  contacts: Contact[];
  suggestions: Contact[];
  followsImportEnabled: boolean;
  blockState?: Record<string, 'blocked' | 'cleanup-pending'>;
  refreshing: boolean;
  importing: boolean;
  consentOpen: boolean;
  importStatus: string | null;
  importError: string | null;
  importErrorDetails: string | null;
  usedNexusFallback: boolean;
  loadError: string | null;
  loadErrorDetails: string | null;
  offline: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onOpenContact: (pubky: string) => void;
  onUseFollows: () => void;
  onConsentConfirm: () => void;
  onConsentDismiss: () => void;
  onRefreshFollows: () => void;
  onStopFollows: () => void;
  onAddSuggestion: (pubky: string) => void;
  onRetryLoad: () => void;
  onRetryImport: () => void;
}) {
  const renderContact = useCallback(
    ({ item }: { item: Contact }) => (
      <ContactRow
        contact={item}
        followsImportEnabled={followsImportEnabled}
        blockState={blockState[item.pubky]}
        onPress={() => onOpenContact(item.pubky)}
      />
    ),
    [blockState, followsImportEnabled, onOpenContact],
  );

  const listHeader = (
    <View>
      {loadError ? (
        <ContactErrorBlock message={loadError} details={loadErrorDetails} onRetry={onRetryLoad} />
      ) : null}
      {!followsImportEnabled ? (
        <View style={styles.followsPanel} testID="followsOptInPanel">
          {importStatus ? (
            <Text
              testID="followsImportStatus"
              style={styles.followsStatus}
              accessibilityLiveRegion="polite"
            >
              {importStatus}
            </Text>
          ) : null}
          <Pressable
            testID="contactsUseFollows"
            accessibilityRole="button"
            accessibilityLabel={CONTACTS_EMPTY_SECONDARY}
            accessibilityState={{ disabled: offline }}
            disabled={offline}
            onPress={onUseFollows}
            style={styles.panelBtn}
          >
            <Text style={[styles.panelBtnLabel, offline && styles.disabledLabel]}>
              {CONTACTS_EMPTY_SECONDARY}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.followsPanel} testID="followsImportPanel">
          <Text style={styles.followsTitle}>{FOLLOWS_SECTION_TITLE}</Text>
          {importStatus ? (
            <Text
              testID="followsImportStatus"
              style={styles.followsStatus}
              accessibilityLiveRegion="polite"
            >
              {importStatus}
              {usedNexusFallback ? ` ${NEXUS_FALLBACK_NOTE}` : ''}
            </Text>
          ) : null}
          {importError ? (
            <ContactErrorBlock
              message={importError}
              details={importErrorDetails}
              onRetry={onRetryImport}
            />
          ) : null}
          {usedNexusFallback && !importStatus && !importError ? (
            <Text style={styles.followsStatus}>{NEXUS_FALLBACK_NOTE}</Text>
          ) : null}
          <Pressable
            testID="contactsRefreshFollows"
            accessibilityRole="button"
            accessibilityLabel="Refresh follows"
            accessibilityState={{ busy: importing, disabled: importing }}
            disabled={importing}
            onPress={onRefreshFollows}
            style={styles.panelBtn}
          >
            <Text style={styles.panelBtnLabel}>{importing ? 'Reading…' : 'Refresh follows'}</Text>
          </Pressable>
          <Pressable
            testID="contactsStopFollows"
            accessibilityRole="button"
            accessibilityLabel="Stop using follows"
            onPress={onStopFollows}
            style={styles.panelBtn}
          >
            <Text style={styles.panelBtnLabel}>Stop using follows</Text>
          </Pressable>
        </View>
      )}
      {suggestions.length > 0 ? (
        <View style={styles.suggestions} testID="followsSuggestions">
          <Text style={styles.suggestionsTitle}>{SUGGESTIONS_HEADER}</Text>
          <Text style={styles.suggestionsSub}>{SUGGESTIONS_SUBCOPY}</Text>
          {suggestions.map(item => (
            <View key={item.pubky} style={styles.suggestionRow} testID="suggestionRow">
              <ContactRow
                contact={item}
                followsImportEnabled={followsImportEnabled}
                suggestion
                blockState={blockState[item.pubky]}
                onPress={() => onOpenContact(item.pubky)}
              />
              <Pressable
                testID="suggestionAdd"
                accessibilityRole="button"
                accessibilityLabel={`Add ${contactPrimaryText(item)} as contact`}
                onPress={() => onAddSuggestion(item.pubky)}
                style={styles.addSuggestion}
              >
                <Text style={styles.addSuggestionLabel}>Add as contact</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  const empty = contacts.length === 0 && !followsImportEnabled;

  return (
    <SafeAreaView style={styles.container} testID="contactsScreen">
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Contacts
        </Text>
        <Pressable
          testID="contactsAdd"
          accessibilityRole="button"
          accessibilityLabel="Add someone by pubky"
          onPress={onAdd}
          style={styles.addBtn}
        >
          <Text style={styles.add}>Add</Text>
        </Pressable>
      </View>
      {empty ? (
        <View style={styles.empty} testID="contactsEmpty">
          <Text style={styles.emptyText}>{CONTACTS_EMPTY_TITLE}</Text>
          <Text style={styles.emptyHint}>{CONTACTS_EMPTY_BODY}</Text>
          {importStatus ? (
            <Text
              testID="followsImportStatus"
              style={styles.followsStatus}
              accessibilityLiveRegion="polite"
            >
              {importStatus}
            </Text>
          ) : null}
          <Pressable
            testID="contactsEmptyAdd"
            accessibilityRole="button"
            accessibilityLabel={CONTACTS_EMPTY_PRIMARY}
            onPress={onAdd}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryLabel}>{CONTACTS_EMPTY_PRIMARY}</Text>
          </Pressable>
          <Pressable
            testID="contactsEmptyUseFollows"
            accessibilityRole="button"
            accessibilityLabel={CONTACTS_EMPTY_SECONDARY}
            accessibilityState={{ disabled: offline }}
            disabled={offline}
            onPress={onUseFollows}
            style={styles.secondaryBtn}
          >
            <Text style={[styles.secondaryLabel, offline && styles.disabledLabel]}>
              {CONTACTS_EMPTY_SECONDARY}
            </Text>
          </Pressable>
          {offline ? <Text style={styles.offline}>You are offline.</Text> : null}
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={item => item.pubky}
          renderItem={renderContact}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            contacts.length === 0 ? (
              <Text style={styles.emptyHint}>{CONTACTS_EMPTY_TITLE}</Text>
            ) : null
          }
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={CONTACTS_BRAND}
            />
          }
        />
      )}
      {importing && !refreshing ? (
        <View style={styles.syncBar} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={CONTACTS_BRAND} />
          <Text style={styles.syncText}>Reading…</Text>
        </View>
      ) : null}
      <FollowsConsentSheet
        visible={consentOpen}
        busy={importing}
        onConfirm={onConsentConfirm}
        onDismiss={onConsentDismiss}
      />
    </SafeAreaView>
  );
}

function ContactRow({
  contact,
  followsImportEnabled,
  suggestion = false,
  blockState,
  onPress,
}: {
  contact: Contact;
  followsImportEnabled: boolean;
  suggestion?: boolean;
  blockState?: 'blocked' | 'cleanup-pending' | undefined;
  onPress: () => void;
}) {
  const primary = contactPrimaryText(contact);
  const secondary = contactSecondaryText(contact);
  const chips = relationshipChips(contact, followsImportEnabled);
  const blockedLabel =
    blockState === 'cleanup-pending'
      ? CONTACTS_COPY.blockedCleanupPending
      : blockState === 'blocked'
        ? CONTACTS_COPY.blockedState
        : null;
  return (
    <Pressable
      testID={suggestion ? 'suggestionContactRow' : 'contactRow'}
      accessibilityRole="button"
      accessibilityLabel={contactRowAccessLabel({
        addedManually: contact.addedManually,
        displayName: contact.displayName,
        pubky: contact.pubky,
        primary,
        secondary,
      })}
      onPress={onPress}
      style={[styles.row, suggestion && styles.suggestionInner]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>{primary.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>{primary}</Text>
        {secondary ? <Text style={styles.pubky}>{secondary}</Text> : null}
        {blockedLabel ? (
          <Text testID="contactRowBlockedState" style={styles.blockedState}>
            {blockedLabel}
          </Text>
        ) : null}
        {chips.length > 0 ? (
          <View style={styles.badges}>
            {chips.map(badge => (
              <View key={badge} style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <Text style={styles.chevron} importantForAccessibility="no">
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CONTACTS_CANVAS },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CONTACTS_HAIRLINE,
    flexWrap: 'wrap',
    gap: space.sm,
  },
  title: {
    fontSize: typeRole.title.fontSize,
    fontWeight: '700',
    color: CONTACTS_BODY,
    flexShrink: 1,
  },
  addBtn: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  add: { fontSize: typeRole.body.fontSize, color: color.brandText, fontWeight: '600' },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
  },
  syncText: { color: CONTACTS_MUTED, fontSize: typeRole.caption.fontSize },
  list: { paddingVertical: space.xs, paddingBottom: space.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    minHeight: MIN_TARGET,
    gap: space.lg,
  },
  suggestionInner: { paddingHorizontal: 0 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.xxl,
    backgroundColor: color.well,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: typeRole.heading.fontSize, fontWeight: '600', color: CONTACTS_BRAND },
  body: { flex: 1, gap: 3 },
  name: { fontSize: typeRole.callout.fontSize, fontWeight: '600', color: CONTACTS_BODY },
  pubky: { fontSize: typeRole.caption.fontSize, color: CONTACTS_MUTED, fontFamily: 'monospace' },
  blockedState: { fontSize: typeRole.caption.fontSize, color: CONTACTS_ERROR, fontWeight: '600' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  badge: {
    backgroundColor: color.well,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeText: { color: color.brandMuted, fontSize: typeRole.meta.fontSize, fontWeight: '600' },
  chevron: { color: CONTACTS_MUTED, fontSize: typeRole.heading.fontSize, paddingLeft: space.sm },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xxxl,
  },
  emptyText: {
    color: CONTACTS_BODY,
    fontSize: typeRole.numeric.fontSize,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyHint: {
    color: CONTACTS_MUTED,
    fontSize: typeRole.callout.fontSize,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryBtn: {
    minHeight: MIN_TARGET,
    minWidth: 220,
    borderRadius: CONTACTS_RADIUS,
    backgroundColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    marginTop: space.sm,
  },
  primaryLabel: { color: color.textOnBrand, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  secondaryBtn: {
    minHeight: MIN_TARGET,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { color: color.brandText, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  disabledLabel: { color: CONTACTS_MUTED },
  offline: { color: CONTACTS_MUTED, fontSize: typeRole.secondary.fontSize },
  followsPanel: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CONTACTS_HAIRLINE,
  },
  followsTitle: { color: CONTACTS_BODY, fontSize: typeRole.body.fontSize, fontWeight: '700' },
  followsStatus: { color: CONTACTS_MUTED, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
  panelBtn: { minHeight: MIN_TARGET, justifyContent: 'center' },
  panelBtnLabel: { color: color.brandText, fontSize: typeRole.body.fontSize, fontWeight: '600' },
  suggestions: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.sm,
    backgroundColor: color.surface,
    gap: space.sm,
  },
  suggestionsTitle: { color: CONTACTS_BODY, fontSize: typeRole.body.fontSize, fontWeight: '700' },
  suggestionsSub: { color: CONTACTS_MUTED, fontSize: typeRole.secondary.fontSize, lineHeight: 20 },
  suggestionRow: { gap: space.xs, paddingBottom: space.sm },
  addSuggestion: { minHeight: MIN_TARGET, justifyContent: 'center', paddingLeft: 62 },
  addSuggestionLabel: {
    color: color.brandText,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
  },
});
