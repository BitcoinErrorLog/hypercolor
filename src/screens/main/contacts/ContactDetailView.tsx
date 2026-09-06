import React, { useEffect, useState } from 'react';
import {
  BackHandler,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  CONTACTS_CANVAS,
  CONTACTS_ERROR,
  CONTACTS_MUTED,
} from '../../../ui/contacts/tokens';
import { contactPrimaryText, contactSecondaryText } from './contactIdentity';
import { COPY } from '../../../copy/uxCopy';
import { color, measure, radius, space, typeRole } from '../../../theme';
import {
  Avatar,
  Button,
  DetailRow,
  LoadingState,
  PageHeader,
  PubkyChip,
} from '../../../ui/primitives';

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
  nickname = '',
  onChangeNickname,
  onSaveNickname,
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
  nickname?: string;
  onChangeNickname?: (value: string) => void;
  onSaveNickname?: () => void;
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
      <PageHeader
        title="Contact"
        onBack={onBack}
        backLabel="Back"
        backAccessibilityLabel="Back to Contacts"
        testID="contactDetail"
      />
      {loading ? (
        <LoadingState label="Loading contact" testID="contactDetailLoading" />
      ) : loadError && !blocked ? (
        <ContactErrorBlock message={loadError} details={loadErrorDetails} onRetry={onRetry} />
      ) : blocked ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Avatar name={primary} pubky={pubky} size="lg" testID="contactDetailAvatar" />
          <Text style={styles.name}>{primary}</Text>
          {secondary ? <Text style={styles.secondary}>{secondary}</Text> : null}
          <PubkyChip
            pubky={contact?.pubky ?? pubky}
            onCopy={onCopy}
            testID="contactDetailPubkyChip"
          />
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
          <View style={styles.danger}>
            <Button
              testID="contactDetailUnblock"
              label={CONTACTS_COPY.unblockConfirm}
              variant="secondary"
              onPress={() => setUnblockOpen(true)}
            />
            {contact ? (
              <Button
                testID="contactDetailRemove"
                label="Remove contact"
                variant="destructive"
                onPress={() => setRemoveOpen(true)}
              />
            ) : null}
          </View>
        </ScrollView>
      ) : contact ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Avatar name={primary} pubky={pubky} size="lg" testID="contactDetailAvatar" />
          <Text style={styles.name}>{primary}</Text>
          {secondary ? <Text style={styles.secondary}>{secondary}</Text> : null}
          <PubkyChip
            pubky={contact?.pubky ?? pubky}
            onCopy={onCopy}
            testID="contactDetailPubkyChip"
          />
          {onChangeNickname && onSaveNickname ? (
            <>
              <TextInput
                testID="contactNickname"
                accessibilityLabel={COPY.nicknameLabel}
                value={nickname}
                onChangeText={onChangeNickname}
                placeholder={COPY.nicknamePlaceholder}
                placeholderTextColor={CONTACTS_MUTED}
                style={styles.nicknameInput}
              />
              <Button
                testID="contactSaveNickname"
                label={COPY.saveNickname}
                variant="secondary"
                onPress={onSaveNickname}
              />
            </>
          ) : null}
          <View style={styles.details}>
            <DetailRow label="Relationship" value={relation} testID="contactDetailRelationship" />
            <DetailRow label="Link" value={linkLabel} testID="contactDetailLink" />
            <DetailRow
              label="Trust"
              value={
                trust && trust.reasons.length > 0 ? (
                  <View style={styles.detailStack}>
                    {trust.reasons.map(reason => (
                      <Text key={reason.code} style={styles.detailValue}>
                        {reason.label}
                      </Text>
                    ))}
                  </View>
                ) : (
                  'No relationship'
                )
              }
            />
            <DetailRow
              label="Public payment methods"
              value={
                paymentsUnavailableOffline ? (
                  'Unavailable offline'
                ) : paymentIdentifiers.length === 0 ? (
                  'No public payment methods on file.'
                ) : (
                  <View style={styles.detailStack}>
                    {paymentIdentifiers.map(id => (
                      <Text key={id} style={styles.detailValue}>
                        {formatTipIdentifierDisplay(id)}
                      </Text>
                    ))}
                  </View>
                )
              }
              last
            />
          </View>
          <Button testID="contactDetailMessage" label="Message" onPress={onMessage} />
          <Button testID="contactDetailShare" label="Share" variant="secondary" onPress={onShare} />
          <View style={styles.danger}>
            <Button
              testID="contactDetailBlock"
              label="Block"
              variant="destructive"
              onPress={() => setBlockOpen(true)}
            />
            <Button
              testID="contactDetailRemove"
              label="Remove contact"
              variant="destructive"
              onPress={() => setRemoveOpen(true)}
            />
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
  body: { padding: space.xl, gap: space.md, paddingBottom: space.xxl + space.lg },
  nicknameInput: {
    minHeight: measure.hitTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: CONTACTS_BODY,
  },
  name: {
    color: CONTACTS_BODY,
    fontSize: typeRole.heading.fontSize,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondary: { color: CONTACTS_MUTED, fontSize: typeRole.callout.fontSize, textAlign: 'center' },
  blockedBanner: {
    color: CONTACTS_ERROR,
    fontSize: typeRole.callout.fontSize,
    fontWeight: '600',
    textAlign: 'center',
  },
  details: { gap: space.lg, marginTop: space.sm },
  detailStack: { gap: space.xs },
  detailValue: {
    color: CONTACTS_BODY,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
  },
  danger: { marginTop: space.xxl, gap: space.sm },
});
