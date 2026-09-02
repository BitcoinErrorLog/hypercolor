import React, { useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Contact } from '../../../types';
import type { TrustExplanation } from '../../../services/TrustEngine';
import { formatTipIdentifierDisplay } from '../../../utils/displaySanitize';
import { ConfirmSheet } from '../../../ui/contacts/ConfirmSheet';
import { ContactErrorBlock } from '../../../ui/contacts/ContactErrorBlock';
import { relationshipLabel } from '../../../ui/contacts/relationshipBadge';
import { groupedPubky } from '../../../ui/contacts/shortPubky';
import { CONTACTS_COPY } from '../../../ui/contacts/contactsCopy';
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
import { contactPrimaryText, contactSecondaryText } from './contactIdentity';

export function linkStateLabel(status: 'established' | 'handshaking' | null): string {
  if (status === 'established') return 'Encrypted link ready';
  if (status === 'handshaking') return 'Link handshake in progress';
  return 'No encrypted link yet';
}

export function ContactDetailView({
  pubky,
  contact,
  loading,
  loadError,
  loadErrorDetails,
  trust,
  linkLabel,
  paymentIdentifiers,
  paymentsUnavailableOffline,
  followsImportEnabled,
  blocked,
  cleanupPending,
  onBack,
  onMessage,
  onCopy,
  onShare,
  onRetry,
  onBlock,
  onUnblock,
  onRemove,
}: {
  pubky: string;
  contact: Contact | null;
  loading: boolean;
  loadError: string | null;
  loadErrorDetails: string | null;
  trust: TrustExplanation | null;
  linkLabel: string;
  paymentIdentifiers: string[];
  paymentsUnavailableOffline: boolean;
  followsImportEnabled: boolean;
  blocked: boolean;
  cleanupPending: boolean;
  onBack: () => void;
  onMessage: () => void;
  onCopy: () => void;
  onShare: () => void;
  onRetry: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onRemove: () => void;
}) {
  const [blockOpen, setBlockOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (blockOpen) {
        setBlockOpen(false);
        return true;
      }
      if (removeOpen) {
        setRemoveOpen(false);
        return true;
      }
      if (unblockOpen) {
        setUnblockOpen(false);
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [blockOpen, onBack, removeOpen, unblockOpen]);

  const relation = contact ? relationshipLabel(contact, followsImportEnabled) : 'No relationship';
  const primary = contact ? contactPrimaryText(contact) : groupedPubky(pubky);
  const secondary = contact ? contactSecondaryText(contact) : null;
  const blockedLabel = cleanupPending
    ? CONTACTS_COPY.blockedCleanupPending
    : CONTACTS_COPY.blockedState;

  return (
    <SafeAreaView style={styles.container} testID="contactDetailScreen">
      <View style={styles.header}>
        <Pressable
          testID="contactDetailBack"
          accessibilityRole="button"
          accessibilityLabel="Back to Contacts"
          onPress={onBack}
          style={styles.headerBtn}
        >
          <Text style={styles.headerBtnLabel}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Contact
        </Text>
        <View style={styles.headerBtn} />
      </View>
      {loading ? (
        <View testID="contactDetailLoading" style={styles.centered}>
          <Text style={styles.muted}>Loading…</Text>
        </View>
      ) : loadError && !blocked ? (
        <ContactErrorBlock message={loadError} details={loadErrorDetails} onRetry={onRetry} />
      ) : blocked ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>{primary.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{primary}</Text>
          {secondary ? <Text style={styles.secondary}>{secondary}</Text> : null}
          <Text
            testID="contactDetailFullPubky"
            style={styles.fullPubky}
            selectable
            accessibilityLabel={`Full pubky ${groupedPubky(contact?.pubky ?? pubky)}`}
          >
            {contact?.pubky ?? pubky}
          </Text>
          <Text testID="contactDetailBlockedState" style={styles.blockedBanner}>
            {blockedLabel}
          </Text>
          {cleanupPending ? (
            <ContactErrorBlock
              message={CONTACTS_COPY.blockedCleanupPending}
              details={loadErrorDetails}
              onRetry={onRetry}
              retryLabel={CONTACTS_COPY.blockedCleanupRetry}
            />
          ) : null}
          <Pressable
            testID="contactDetailCopy"
            accessibilityRole="button"
            accessibilityLabel="Copy pubky"
            onPress={onCopy}
            style={styles.outlineBtn}
          >
            <Text style={styles.outlineLabel}>Copy pubky</Text>
          </Pressable>
          <View style={styles.danger}>
            <Pressable
              testID="contactDetailUnblock"
              accessibilityRole="button"
              accessibilityLabel={CONTACTS_COPY.unblockConfirm}
              onPress={() => setUnblockOpen(true)}
              style={styles.dangerBtn}
            >
              <Text style={styles.dangerLabel}>{CONTACTS_COPY.unblockConfirm}</Text>
            </Pressable>
            {contact ? (
              <Pressable
                testID="contactDetailRemove"
                accessibilityRole="button"
                accessibilityLabel="Remove contact"
                onPress={() => setRemoveOpen(true)}
                style={styles.dangerBtn}
              >
                <Text style={styles.dangerLabel}>Remove contact</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      ) : contact ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>{primary.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{primary}</Text>
          {secondary ? <Text style={styles.secondary}>{secondary}</Text> : null}
          <Text
            testID="contactDetailFullPubky"
            style={styles.fullPubky}
            selectable
            accessibilityLabel={`Full pubky ${groupedPubky(contact?.pubky ?? pubky)}`}
          >
            {contact?.pubky ?? pubky}
          </Text>
          <Pressable
            testID="contactDetailCopy"
            accessibilityRole="button"
            accessibilityLabel="Copy pubky"
            onPress={onCopy}
            style={styles.outlineBtn}
          >
            <Text style={styles.outlineLabel}>Copy pubky</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>Relationship</Text>
          <Text testID="contactDetailRelationship" style={styles.sectionValue}>
            {relation}
          </Text>
          <Text style={styles.sectionLabel}>Link</Text>
          <Text testID="contactDetailLink" style={styles.sectionValue}>
            {linkLabel}
          </Text>
          <Text style={styles.sectionLabel}>Trust</Text>
          {trust && trust.reasons.length > 0 ? (
            trust.reasons.map(reason => (
              <Text key={reason.code} style={styles.trustLine}>
                {reason.label}
              </Text>
            ))
          ) : (
            <Text style={styles.sectionValue}>No relationship</Text>
          )}
          <Text style={styles.sectionLabel}>Public payment methods</Text>
          {paymentsUnavailableOffline ? (
            <Text style={styles.sectionValue}>Unavailable offline</Text>
          ) : paymentIdentifiers.length === 0 ? (
            <Text style={styles.sectionValue}>No public payment methods on file.</Text>
          ) : (
            paymentIdentifiers.map(id => (
              <Text key={id} style={styles.sectionValue}>
                {formatTipIdentifierDisplay(id)}
              </Text>
            ))
          )}
          <Pressable
            testID="contactDetailMessage"
            accessibilityRole="button"
            accessibilityLabel="Message"
            onPress={onMessage}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryLabel}>Message</Text>
          </Pressable>
          <Pressable
            testID="contactDetailShare"
            accessibilityRole="button"
            accessibilityLabel="Share"
            onPress={onShare}
            style={styles.outlineBtn}
          >
            <Text style={styles.outlineLabel}>Share</Text>
          </Pressable>
          <View style={styles.danger}>
            <Pressable
              testID="contactDetailBlock"
              accessibilityRole="button"
              accessibilityLabel="Block"
              onPress={() => setBlockOpen(true)}
              style={styles.dangerBtn}
            >
              <Text style={styles.dangerLabel}>Block</Text>
            </Pressable>
            <Pressable
              testID="contactDetailRemove"
              accessibilityRole="button"
              accessibilityLabel="Remove contact"
              onPress={() => setRemoveOpen(true)}
              style={styles.dangerBtn}
            >
              <Text style={styles.dangerLabel}>Remove contact</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <ContactErrorBlock message="Could not load this contact." onRetry={onRetry} />
      )}
      <ConfirmSheet
        visible={blockOpen}
        title={CONTACTS_COPY.blockTitle}
        body={CONTACTS_COPY.blockBody}
        confirmLabel={CONTACTS_COPY.blockConfirm}
        destructive
        onDismiss={() => setBlockOpen(false)}
        onConfirm={() => {
          setBlockOpen(false);
          onBlock();
        }}
      />
      <ConfirmSheet
        visible={removeOpen}
        title={CONTACTS_COPY.removeTitle}
        body={CONTACTS_COPY.removeBody}
        confirmLabel={CONTACTS_COPY.removeConfirm}
        destructive
        onDismiss={() => setRemoveOpen(false)}
        onConfirm={() => {
          setRemoveOpen(false);
          onRemove();
        }}
      />
      <ConfirmSheet
        visible={unblockOpen}
        title={CONTACTS_COPY.unblockTitle}
        body={CONTACTS_COPY.unblockBody}
        confirmLabel={CONTACTS_COPY.unblockConfirm}
        onDismiss={() => setUnblockOpen(false)}
        onConfirm={() => {
          setUnblockOpen(false);
          onUnblock();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CONTACTS_CANVAS },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CONTACTS_HAIRLINE,
  },
  headerBtn: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, justifyContent: 'center' },
  headerBtnLabel: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: CONTACTS_BODY, fontSize: 17, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: CONTACTS_MUTED, fontSize: 15 },
  body: { padding: 20, gap: 10, paddingBottom: 40 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  avatarLetter: { fontSize: 24, fontWeight: '600', color: CONTACTS_BRAND },
  name: { color: CONTACTS_BODY, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  secondary: { color: CONTACTS_MUTED, fontSize: 15, textAlign: 'center' },
  blockedBanner: {
    color: CONTACTS_ERROR,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  fullPubky: {
    color: CONTACTS_MUTED,
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  sectionLabel: { color: CONTACTS_MUTED, fontSize: 13, marginTop: 8, fontWeight: '600' },
  sectionValue: { color: CONTACTS_BODY, fontSize: 15 },
  trustLine: { color: CONTACTS_BODY, fontSize: 15 },
  primaryBtn: {
    minHeight: MIN_TARGET,
    borderRadius: CONTACTS_RADIUS,
    backgroundColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outlineBtn: {
    minHeight: MIN_TARGET,
    borderRadius: CONTACTS_RADIUS,
    borderWidth: 1,
    borderColor: CONTACTS_BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineLabel: { color: '#8f57f0', fontSize: 16, fontWeight: '600' },
  danger: { marginTop: 24, gap: 8 },
  dangerBtn: { minHeight: MIN_TARGET, justifyContent: 'center' },
  dangerLabel: { color: '#fca5a5', fontSize: 16, fontWeight: '600' },
});
