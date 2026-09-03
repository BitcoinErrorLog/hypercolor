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

export function WelcomeLoadingScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Hypercolor" />
      <LoadingState label="Starting authorization…" testID="vrtWelcomeLoading" />
    </SafeAreaView>
  );
}

export function AwaitingRingWithUrlScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Approve in Ring" onBack={() => {}} />
      <StatusBanner
        label="Scan or open the approval link in Ring."
        tone="info"
        testID="vrtAwaitingRingHint"
      />
      <View style={styles.body}>
        <Text style={styles.lead} testID="mask-auth-url">
          pubkyring://paykit-connect?request=synthetic-fixture
        </Text>
        <Button label="Open Ring" onPress={() => {}} testID="vrtOpenRing" />
        <Button label="Copy link" onPress={() => {}} variant="secondary" testID="vrtCopyRing" />
        <Button label="Cancel" onPress={() => {}} variant="ghost" testID="vrtCancelRing" />
      </View>
    </SafeAreaView>
  );
}

export function AwaitingRingWaitingScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Approve in Ring" onBack={() => {}} />
      <LoadingState label="Waiting for Ring approval…" testID="vrtAwaitingRingWait" />
    </SafeAreaView>
  );
}

export function ChatsPopulatedScene(): React.ReactElement {
  const { aster, bramble } = SYNTHETIC_IDENTITIES;
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Chats" />
      <ListRow
        title={aster.name}
        subtitle="Hello from the fixture clock."
        onPress={() => {}}
        testID="vrtChatAster"
      />
      <ListRow
        title={bramble.name}
        subtitle="Payment request · synthetic"
        onPress={() => {}}
        testID="vrtChatBramble"
      />
    </SafeAreaView>
  );
}

export function EnableErrorScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Enable messaging" />
      <StatusBanner
        label="Could not enable messaging."
        tone="danger"
        actionLabel="Try again"
        onAction={() => {}}
        testID="vrtEnableError"
      />
    </SafeAreaView>
  );
}

export function EnableAuthorizingScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Enable messaging" />
      <LoadingState label="Waiting for Ring grant…" testID="vrtEnableAuthorizing" />
      <Text style={styles.lead} testID="mask-auth-url">
        Remaining: 00:42
      </Text>
    </SafeAreaView>
  );
}

export function SettingsRecoveryGateScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Recovery" onBack={() => {}} />
      <StatusBanner
        label="Enter your recovery code to continue."
        tone="warning"
        testID="vrtRecoveryHint"
      />
      <View style={styles.body}>
        <Button
          label="Continue"
          onPress={() => {}}
          disabled
          disabledReason="Recovery code required"
          testID="vrtRecoveryContinue"
        />
      </View>
    </SafeAreaView>
  );
}

export function ThreadLoadingScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title={SYNTHETIC_IDENTITIES.aster.name} onBack={() => {}} />
      <LoadingState label="Loading messages…" testID="vrtThreadLoading" />
    </SafeAreaView>
  );
}

export function ThreadPopulatedScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title={SYNTHETIC_IDENTITIES.aster.name} onBack={() => {}} />
      <ListRow title="Aster Example" subtitle="Hi — fixture message one." testID="vrtThreadMsg1" />
      <ListRow title="You" subtitle="Reply from the catalog fixture." testID="vrtThreadMsg2" />
    </SafeAreaView>
  );
}

export function ChannelsPopulatedScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Channels" />
      <ListRow
        title="Fixture private group"
        subtitle="Private · 3 members"
        onPress={() => {}}
        testID="vrtChannelPrivate"
      />
      <ListRow
        title="Fixture public topic"
        subtitle="Public · plaintext"
        onPress={() => {}}
        testID="vrtChannelPublic"
      />
    </SafeAreaView>
  );
}

export function ComposerSheetScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Compose" onBack={() => {}} />
      <ListRow title="Attach photo" onPress={() => {}} testID="vrtComposePhoto" />
      <ListRow title="Attach file" onPress={() => {}} testID="vrtComposeFile" />
      <ListRow title="Request payment" onPress={() => {}} testID="vrtComposePay" />
      <Button label="Cancel" onPress={() => {}} variant="ghost" testID="vrtComposeCancel" />
    </SafeAreaView>
  );
}

export function PaymentReviewScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Review payment" onBack={() => {}} />
      <StatusBanner
        label="Check amount and destination before sending."
        tone="info"
        testID="vrtPayReviewHint"
      />
      <ListRow title="Amount" subtitle="1,000 sats" testID="vrtPayAmount" />
      <ListRow title="To" subtitle={SYNTHETIC_IDENTITIES.aster.name} testID="vrtPayTo" />
      <View style={styles.body}>
        <Button label="Send payment" onPress={() => {}} testID="vrtPaySend" />
        <Button label="Cancel" onPress={() => {}} variant="secondary" testID="vrtPayCancel" />
      </View>
    </SafeAreaView>
  );
}

export function ContactsContentEmptyScene(): React.ReactElement {
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
        testID="vrtContactsContentEmpty"
      />
    </SafeAreaView>
  );
}

export function ContactsContentPopulatedScene(): React.ReactElement {
  const { aster, bramble } = SYNTHETIC_IDENTITIES;
  return (
    <SafeAreaView style={styles.root} testID="mask-pubky">
      <PageHeader title="Contacts" />
      <ListRow
        title={aster.name}
        subtitle={aster.pubky}
        onPress={() => {}}
        testID="vrtContactsContentAster"
      />
      <ListRow
        title={bramble.name}
        subtitle={bramble.pubky}
        onPress={() => {}}
        testID="vrtContactsContentBramble"
      />
    </SafeAreaView>
  );
}

export function ContactsContentOfflineScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Contacts" />
      <StatusBanner
        label="You are offline"
        tone="warning"
        actionLabel="Try again"
        onAction={() => {}}
        testID="vrtContactsContentOffline"
      />
      <EmptyState
        title="Could not load contacts."
        body="Try again when you are back online."
        testID="vrtContactsContentOfflineEmpty"
      />
    </SafeAreaView>
  );
}

export function MessageRequestsEmptyScene(): React.ReactElement {
  return (
    <SafeAreaView style={styles.root}>
      <PageHeader title="Message requests" onBack={() => {}} />
      <EmptyState
        title="No message requests."
        body="When someone messages you for the first time, they show up here."
        testID="vrtMessageRequestsEmpty"
      />
    </SafeAreaView>
  );
}

export function MessageRequestsPopulatedScene(): React.ReactElement {
  const { aster } = SYNTHETIC_IDENTITIES;
  return (
    <SafeAreaView style={styles.root} testID="mask-pubky">
      <PageHeader title="Message requests" onBack={() => {}} />
      <ListRow
        title={aster.name}
        subtitle={aster.pubky}
        meta="Accept or decline"
        onPress={() => {}}
        testID="vrtMessageRequestAster"
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
