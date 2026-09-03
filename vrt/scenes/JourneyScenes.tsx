import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../../src/copy/uxCopy';
import {
  Button,
  EmptyState,
  LoadingState,
  ListRow,
  PageHeader,
  StatusBanner,
} from '../../src/ui/primitives';
import { color, space, typeRole } from '../../src/theme';
import { SYNTHETIC_IDENTITIES } from '../fixtures/identities';

export function WelcomeIdleScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Hypercolor" />
      <View style={styles.body}>
        <Text style={styles.lead}>{COPY.connectExplanation}</Text>
        <Button label={COPY.connectWithPubkyRing} onPress={() => {}} testID="vrtWelcomeConnect" />
      </View>
    </SafeAreaView>
  );
}

export function WelcomeErrorScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Hypercolor" />
      <StatusBanner
        label={COPY.couldNotStartAuthorization}
        tone="danger"
        testID="vrtWelcomeError"
      />
      <View style={styles.body}>
        <Button label={COPY.tryAgain} onPress={() => {}} testID="vrtWelcomeRetry" />
      </View>
    </SafeAreaView>
  );
}

export function ChatsEmptyScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Chats" />
      <EmptyState
        title={COPY.noChatsYet}
        body={COPY.chatsEmptyBody}
        actionLabel={COPY.addAContact}
        onAction={() => {}}
        testID="vrtChatsEmpty"
      />
    </SafeAreaView>
  );
}

export function ChatsOfflineScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Chats" />
      <StatusBanner
        label={COPY.sessionOfflineBanner}
        tone="warning"
        actionLabel={COPY.tryAgain}
        onAction={() => {}}
        testID="vrtChatsOffline"
      />
      <EmptyState
        title={COPY.noChatsYet}
        body={COPY.chatsEmptyBody}
        testID="vrtChatsOfflineEmpty"
      />
    </SafeAreaView>
  );
}

export function ContactsEmptyScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Contacts" />
      <EmptyState
        title="No contacts yet."
        body="Add someone by pubky, or use your public pubky.app follows to recognise people you already know."
        actionLabel="Add someone by pubky"
        onAction={() => {}}
        secondaryActionLabel="Use my follows"
        onSecondaryAction={() => {}}
        testID="vrtContactsEmpty"
      />
    </SafeAreaView>
  );
}

export function ContactsPopulatedScene(): React.ReactElement {
  const { aster, bramble } = SYNTHETIC_IDENTITIES;
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Contacts" />
      <ListRow
        title={aster.name}
        subtitle={aster.pubky}
        onPress={() => {}}
        testID="vrtContactAster"
      />
      <ListRow
        title={bramble.name}
        subtitle={bramble.pubky}
        onPress={() => {}}
        testID="vrtContactBramble"
      />
    </SafeAreaView>
  );
}

export function ContactsOfflineScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Contacts" />
      <StatusBanner
        label="You are offline"
        tone="warning"
        actionLabel={COPY.tryAgain}
        onAction={() => {}}
        testID="vrtContactsOffline"
      />
      <EmptyState
        title="Could not load contacts."
        body="Try again when you are back online."
        testID="vrtContactsOfflineEmpty"
      />
    </SafeAreaView>
  );
}

export function EnableCheckingScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Enable messaging" />
      <LoadingState label="Checking messaging status…" testID="vrtEnableChecking" />
    </SafeAreaView>
  );
}

export function EnableSuccessScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Enable messaging" />
      <EmptyState
        title={'Encrypted messaging enabled'}
        body={'Ring approved the grant and this device published a receiver marker.'}
        actionLabel={'Open chats'}
        onAction={() => {}}
        testID="vrtEnableSuccess"
      />
    </SafeAreaView>
  );
}

export function SettingsDefaultScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Settings" />
      <ListRow
        title="Backup & recovery"
        subtitle="Save a recovery code"
        onPress={() => {}}
        testID="vrtSettingsBackup"
      />
      <ListRow
        title="Sign out"
        subtitle="Removes local data. Ring still holds your key."
        onPress={() => {}}
        testID="vrtSettingsSignOut"
      />
    </SafeAreaView>
  );
}

export function ThreadEmptyScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title={SYNTHETIC_IDENTITIES.aster.name} onBack={() => {}} />
      <EmptyState
        title="No messages yet."
        body="Say hello to start the conversation."
        testID="vrtThreadEmpty"
      />
    </SafeAreaView>
  );
}

export function ChannelsEmptyScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Channels" />
      <EmptyState
        title="No channels yet."
        body="Create a private group or load public topics."
        actionLabel="Create private group"
        onAction={() => {}}
        testID="vrtChannelsEmpty"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  body: { flex: 1, padding: space.xl, gap: space.lg, justifyContent: 'center' },
  lead: {
    color: color.textSecondary,
    fontSize: typeRole.body.fontSize,
    lineHeight: typeRole.body.lineHeight,
    textAlign: 'center',
  },
});
