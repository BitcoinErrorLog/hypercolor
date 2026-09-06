import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { WelcomeScreenContent } from '../../src/screens/auth/WelcomeScreenContent';
import { AwaitingRingAuthScreenContent } from '../../src/screens/auth/AwaitingRingAuthScreenContent';
import { EnableMessagingScreenContent } from '../../src/screens/main/EnableMessagingScreenContent';
import { ChatsScreenContent } from '../../src/screens/main/ChatsScreenContent';
import { ThreadScreenContent } from '../../src/screens/main/ThreadScreen';
import { ChannelsScreenContent } from '../../src/screens/main/ChannelsScreen';
import { ChannelScreenContent } from '../../src/screens/main/ChannelScreen';
import { ContactsScreenContent } from '../../src/screens/main/contacts/ContactsScreenContent';
import { ContactSearchView } from '../../src/screens/main/contacts/ContactSearchView';
import { ContactQrScanner } from '../../src/ui/contacts/ContactQrScanner';
import { ContactDetailView } from '../../src/screens/main/contacts/ContactDetailView';
import { MessageRequestsContent } from '../../src/screens/main/MessageRequestsScreen';
import { SettingsScreenContent } from '../../src/screens/main/SettingsScreenContent';
import { ProfileScreenContent } from '../../src/screens/main/ProfileScreenContent';
import { ComposerActionMenu } from '../../src/components/ComposerActionMenu';
import { EmojiPickerSheet } from '../../src/components/EmojiPickerSheet';
import { GifPickerSheet } from '../../src/components/GifPickerSheet';
import { PaymentComposeSheet } from '../../src/components/PaymentComposeSheet';
import { PaymentReviewSheet } from '../../src/components/PaymentReviewSheet';
import { ThreadTipBarContent } from '../../src/components/ThreadTipBar';
import { E2eSignupHud } from '../../src/navigation/E2eSignupHud';
import { setE2eSignupHud } from '../../src/navigation/e2eSignupResult';
import { MainTabBarIcon } from '../../src/navigation/tabBarIcons';
import { TokenSwatchScreen } from './TokenSwatchScreen';
import { composerActionItems } from '../../src/ui/composerActions';
import { mapPaymentReview } from '../../src/ui/paymentReview';
import { sessionUiModel } from '../../src/ui/sessionUi';
import { ProductSplash } from '../../src/ui/primitives';
import { COPY } from '../../src/copy/uxCopy';
import { INITIAL_ENABLE_MESSAGING_STATE } from '../../src/screens/main/enableMessagingController';
import { color, radius, space, typeRole } from '../../src/theme';
import { threadProps } from './threadDefaults';
import {
  AUTH_URL,
  CHANNEL_FIXTURE,
  CHANNEL_MEMBERS,
  CHANNEL_MESSAGES,
  CHANNELS_POPULATED,
  CHAT_ROWS,
  CONTACTS_BY_PUBKY,
  CONTACTS_POPULATED,
  ENABLE_AUTH_URL,
  FIXED_NOW_MS,
  MESSAGE_REQUEST_ROWS,
  PAYMENT_REVIEW_INPUT,
  OWNER,
  PAYMENT_REVIEW_FIXTURE,
  PEER,
  REQUEST_PENDING,
  linkMessage,
  noop,
} from '../fixtures/productData';
import type { PaymentRequestRecord, TipEndpointRecord } from '../../src/types/payment';
import type { AttachmentRecord } from '../../src/types/attachment';
import { GROUP_MEMBERSHIP_KIND, GROUP_REACTION_KIND } from '../../src/types/group';

const n = noop;

function welcome(patch: Partial<React.ComponentProps<typeof WelcomeScreenContent>> = {}) {
  return (
    <WelcomeScreenContent
      loading={false}
      connectPending={false}
      error={null}
      resetAvailable={false}
      resetOpen={false}
      resetBusy={false}
      onConnect={n}
      onOpenReset={n}
      onConfirmReset={n}
      onDismissReset={n}
      {...patch}
    />
  );
}

function enable(patch: Partial<React.ComponentProps<typeof EnableMessagingScreenContent>> = {}) {
  return (
    <EnableMessagingScreenContent
      state={INITIAL_ENABLE_MESSAGING_STATE}
      remainingLabel={null}
      onBack={n}
      onPrimary={n}
      onSecondary={n}
      onCopyAuth={n}
      {...patch}
    />
  );
}

function chats(patch: Partial<React.ComponentProps<typeof ChatsScreenContent>> = {}) {
  return (
    <ChatsScreenContent
      conversations={[]}
      contacts={CONTACTS_BY_PUBKY}
      pendingRequests={0}
      ownerPubky={OWNER}
      needsEnable={false}
      showEnableCta={false}
      listError={null}
      nowMs={FIXED_NOW_MS}
      onOpenThread={n}
      onOpenRequests={n}
      onNewChat={n}
      onEnableMessaging={n}
      onRetry={n}
      onCopyMyPubky={n}
      onShareMyPubky={n}
      onChangeFilter={n}
      onOpenSearch={n}
      listFilter="inbox"
      {...patch}
    />
  );
}

function contacts(patch: Partial<React.ComponentProps<typeof ContactsScreenContent>> = {}) {
  return (
    <ContactsScreenContent
      contacts={[]}
      suggestions={[]}
      followsImportEnabled={false}
      refreshing={false}
      importing={false}
      consentOpen={false}
      importStatus={null}
      importError={null}
      importErrorDetails={null}
      usedNexusFallback={false}
      loadError={null}
      loadErrorDetails={null}
      offline={false}
      onRefresh={n}
      onAdd={n}
      onOpenContact={n}
      onUseFollows={n}
      onConsentConfirm={n}
      onConsentDismiss={n}
      onRefreshFollows={n}
      onStopFollows={n}
      onAddSuggestion={n}
      onRetryLoad={n}
      onRetryImport={n}
      onScanQr={n}
      {...patch}
    />
  );
}

function channels(patch: Partial<React.ComponentProps<typeof ChannelsScreenContent>> = {}) {
  return (
    <ChannelsScreenContent
      channels={[]}
      contacts={CONTACTS_POPULATED}
      mode="private"
      publicOptIn={true}
      createOpen={false}
      joinOpen={false}
      createPublicDefault={false}
      busy={false}
      pendingInvite={null}
      memberCap={16}
      onModeChange={n}
      onLoadPublic={n}
      onOpenCreate={n}
      onCloseCreate={n}
      onOpenJoin={n}
      onCloseJoin={n}
      onCreatePrivate={n}
      onCreatePublic={n}
      onJoinPublic={n}
      onConfirmPendingJoin={n}
      onDismissPendingJoin={n}
      onOpenChannel={n}
      listFilter="inbox"
      onChangeFilter={n}
      {...patch}
    />
  );
}

function channel(patch: Partial<React.ComponentProps<typeof ChannelScreenContent>> = {}) {
  return (
    <ChannelScreenContent
      channel={CHANNEL_FIXTURE}
      messages={CHANNEL_MESSAGES}
      attachments={[]}
      members={CHANNEL_MEMBERS}
      contacts={CONTACTS_POPULATED}
      fanoutOutcomes={[]}
      localPubky={OWNER}
      draft=""
      replyTo={null}
      sending={false}
      loading={false}
      showMembers={false}
      addPubky=""
      isAdmin={true}
      selfActive={true}
      memberCap={16}
      onBack={n}
      onChangeDraft={n}
      onSend={n}
      actionMenuOpen={false}
      composerNotice={null}
      onOpenActionMenu={n}
      onCloseActionMenu={n}
      onComposerAction={n}
      onReply={n}
      onClearReply={n}
      onToggleMembers={n}
      onChangeAddPubky={n}
      onReact={n}
      onEdit={n}
      onDelete={n}
      onAddMember={n}
      onRemoveMember={n}
      onLeave={n}
      onRefreshPublic={n}
      retryableEventIds={new Set()}
      onRetryFailed={n}
      channelMuted={false}
      channelArchived={false}
      onToggleMute={n}
      onToggleArchive={n}
      {...patch}
    />
  );
}

function settings(patch: Partial<React.ComponentProps<typeof SettingsScreenContent>> = {}) {
  return <SettingsVrtBase patch={patch} />;
}

function SettingsVrtBase({
  patch,
}: {
  patch: Partial<React.ComponentProps<typeof SettingsScreenContent>>;
}) {
  return (
    <SettingsScreenContent
      pubky={OWNER}
      homeserver={PEER}
      session={sessionUiModel('enabled')}
      meshEnabled={false}
      telemetryEnabled={false}
      backupBusy={false}
      recoveryCode={null}
      recoveryConfirmed={false}
      recoveryCopied={false}
      restoreCode=""
      restoreNote={null}
      restoreError={null}
      markedSection={null}
      onBack={n}
      onToggleMesh={n}
      onToggleTelemetry={n}
      onBackup={n}
      onCopyRecovery={n}
      onToggleRecoveryConfirmed={n}
      onRecoveryDone={n}
      onChangeRestoreCode={n}
      onRestore={n}
      onEnableMessaging={n}
      onCopyPubky={n}
      {...patch}
    />
  );
}

function settingsScrolled(
  patch: Partial<React.ComponentProps<typeof SettingsScreenContent>> = {},
  scrollY = 0,
) {
  return <SettingsVrtContent patch={patch} scrollY={scrollY} />;
}

function SettingsVrtContent({
  patch,
  scrollY,
}: {
  patch: Partial<React.ComponentProps<typeof SettingsScreenContent>>;
  scrollY: number;
}) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: scrollY, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollY]);

  return <SettingsVrtBase patch={{ ...patch, scrollRef }} />;
}

function profile(patch: Partial<React.ComponentProps<typeof ProfileScreenContent>> = {}) {
  return (
    <ProfileScreenContent
      displayName="Cedar Example"
      pubky={OWNER}
      copied={false}
      session={sessionUiModel('enabled')}
      sessionKind="enabled"
      showEnableMessaging={false}
      signOutOpen={false}
      signOutBusy={false}
      signOutError={null}
      lastBackupRelative={null}
      onOpenSettings={n}
      onCopyPubky={n}
      onEnableMessaging={n}
      onOpenRequests={n}
      onOpenBackup={n}
      onOpenTipEndpoints={n}
      onOpenSignOut={n}
      onCancelSignOut={n}
      onConfirmSignOut={n}
      qrOpen={false}
      qrCopied={false}
      onShowQr={n}
      onCloseQr={n}
      onQrCopied={n}
      nameDraft="Cedar Example"
      onChangeNameDraft={n}
      onSaveDisplayName={n}
      {...patch}
    />
  );
}

function paymentRecord(
  status: PaymentRequestRecord['status'],
  patch: Partial<PaymentRequestRecord> = {},
): PaymentRequestRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    direction: 'received',
    paymentRequestId: 'pay-fix-1',
    eventId: 'pay-evt-1',
    amountValue: '0.00010000',
    amountAsset: 'btc',
    paymentReference: 'fixture-ref',
    endpointIds: ['ln'],
    expiresAt: status === 'pending' ? FIXED_NOW_MS + 3_600_000 : FIXED_NOW_MS - 3_600_000,
    status,
    createdAt: FIXED_NOW_MS - 120_000,
    updatedAt: FIXED_NOW_MS,
    proofJson: status === 'proof_received' ? '{}' : null,
    reason: null,
    pendingEventId: null,
    displayedPaymentHash: 'aabb',
    proofVerified: status === 'proof_received' ? true : null,
    invoiceReused: false,
    ...patch,
  };
}

function attachment(resolveState: AttachmentRecord['resolveState']): AttachmentRecord {
  return {
    ownerPubky: OWNER,
    eventId: 'att-1',
    conversationId: `dm:${PEER}`,
    channelId: null,
    senderPubky: PEER,
    direction: 'received',
    location: `/pub/hypercolor.app/v1/attachments/${PEER}/att-1`,
    keyRef: 'ref',
    contentType: 'image/png',
    size: 12,
    thumbnailLocation: null,
    localCachePath: resolveState === 'ready' ? '/tmp/vrt.png' : null,
    createdAt: FIXED_NOW_MS,
    updatedAt: FIXED_NOW_MS,
    deliveryState: resolveState === 'failed' ? 'failed' : 'delivered',
    resolveState,
  };
}

function tip(expired: boolean): TipEndpointRecord {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    identifier: 'ln-fixture',
    payload: 'lightning:vrt',
    updatedAt: FIXED_NOW_MS,
    validationStatus: 'valid',
    invoiceAmount: '0.0001',
    invoiceExpiresAt: expired ? FIXED_NOW_MS - 1 : FIXED_NOW_MS + 86_400_000,
    paymentHash: null,
  };
}

function splash() {
  return <ProductSplash />;
}

function hud(error: boolean) {
  setE2eSignupHud({
    pubky: OWNER,
    secretHex: '00',
    homeserverPubky: PEER,
    error,
  });
  return <E2eSignupHud />;
}

function tabChrome(focused: boolean) {
  const tint = focused ? color.brand : color.textSecondary;
  return (
    <View style={styles.tabBar} testID="vrtTabBar">
      {(['Chats', 'Channels', 'Contacts', 'Profile'] as const).map(name => (
        <View key={name} style={styles.tabItem}>
          <MainTabBarIcon
            routeName={name}
            focused={focused && name === 'Chats'}
            color={name === 'Chats' && focused ? color.brand : tint}
            size={24}
          />
          <Text style={{ color: name === 'Chats' && focused ? color.brand : tint }}>{name}</Text>
        </View>
      ))}
    </View>
  );
}

const debugBusy = (
  <View testID="debugSignupBusy">
    <Text>Debug signup busy</Text>
  </View>
);

function debugState(
  label: string,
  tone: 'neutral' | 'success' | 'danger' = 'neutral',
  detail?: string,
) {
  return (
    <View testID={`debugSignup${label.replace(/[^A-Za-z0-9]/g, '')}`} style={styles.debugState}>
      <Text
        style={[
          styles.debugStateTitle,
          tone === 'success' && styles.success,
          tone === 'danger' && styles.danger,
        ]}
      >
        {label}
      </Text>
      <Text style={styles.debugStateBody}>VRT fixture state: {label.toLowerCase()}</Text>
      {detail ? (
        <View style={styles.debugProgress}>
          <Text style={styles.debugStateBody}>{detail}</Text>
          <View style={styles.debugProgressTrack}>
            <View style={styles.debugProgressFill} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function fontScaleTwoWelcome() {
  return (
    <View style={styles.fill}>
      {welcome()}
      <View pointerEvents="none" style={styles.fontScaleBadge} testID="a11yFontScaleTwoMarker">
        <Text numberOfLines={1} style={styles.fontScaleTitle}>
          Font scale 2.0
        </Text>
        <Text numberOfLines={2} style={styles.fontScaleBody}>
          Device text scale is forced to 200% by the capture runner before this scene is asserted.
        </Text>
      </View>
    </View>
  );
}

export const SCENE_RENDERERS: Record<string, () => React.ReactElement> = {
  'design-system.token-swatch.default': () => <TokenSwatchScreen />,
  'bootstrap.app-splash.loading': splash,
  'bootstrap.linking-fallback.loading': splash,
  'auth.welcome.idle': () => welcome(),
  'auth.welcome.loading': () => welcome({ loading: true }),
  'auth.welcome.error': () =>
    welcome({ error: { message: COPY.couldNotStartAuthorization, details: null } }),
  'auth.welcome.debug-empty': () => welcome({ showDebugPanel: true, debugPanel: debugBusy }),
  'auth.welcome.debug-busy': () =>
    welcome({ showDebugPanel: true, debugPanel: debugBusy, loading: true }),
  'auth.welcome.debug-error': () =>
    welcome({
      showDebugPanel: true,
      debugPanel: debugBusy,
      error: { message: 'Debug signup failed', details: null },
    }),
  'auth.welcome.debug-result': () =>
    welcome({ showDebugPanel: true, debugPanel: debugState('Debug signup result', 'success') }),
  'auth.awaiting-ring.with-url': () => (
    <AwaitingRingAuthScreenContent
      phase="waiting"
      ringAuthUrl={AUTH_URL}
      delegationBusy={false}
      onCancel={n}
      onOpenRing={n}
      onGenerateNew={n}
      onTryAgain={n}
    />
  ),
  'auth.awaiting-ring.waiting': () => (
    <AwaitingRingAuthScreenContent
      phase="waiting"
      ringAuthUrl=""
      delegationBusy={false}
      onCancel={n}
      onOpenRing={n}
      onGenerateNew={n}
      onTryAgain={n}
    />
  ),
  'auth.awaiting-ring.copied': () => (
    <AwaitingRingAuthScreenContent
      phase="waiting"
      ringAuthUrl={AUTH_URL}
      delegationBusy={false}
      onCancel={n}
      onOpenRing={n}
      onGenerateNew={n}
      onTryAgain={n}
    />
  ),
  'auth.awaiting-ring.fail': () => (
    <AwaitingRingAuthScreenContent
      phase="offline"
      ringAuthUrl={AUTH_URL}
      delegationBusy={false}
      onCancel={n}
      onOpenRing={n}
      onGenerateNew={n}
      onTryAgain={n}
    />
  ),
  'auth.enable.checking': () => enable(),
  'auth.enable.native-missing': () =>
    enable({ state: { ...INITIAL_ENABLE_MESSAGING_STATE, phase: 'native-missing' } }),
  'auth.enable.enabled': () =>
    enable({ state: { ...INITIAL_ENABLE_MESSAGING_STATE, phase: 'success', pubky: OWNER } }),
  'auth.enable.session-offline': () =>
    enable({ state: { ...INITIAL_ENABLE_MESSAGING_STATE, phase: 'session-offline' } }),
  'auth.enable.authorizing': () =>
    enable({
      state: {
        ...INITIAL_ENABLE_MESSAGING_STATE,
        phase: 'authorizing',
        authorizationUrl: ENABLE_AUTH_URL,
        authorizingStartedAt: FIXED_NOW_MS,
      },
      remainingLabel: 'Remaining: 00:42',
    }),
  'auth.enable.authorizing-https': () =>
    enable({
      state: {
        ...INITIAL_ENABLE_MESSAGING_STATE,
        phase: 'authorizing',
        authorizationUrl: 'https://relay.example/auth',
        authorizingStartedAt: FIXED_NOW_MS,
      },
      remainingLabel: 'Remaining: 00:42',
    }),
  'auth.enable.success': () =>
    enable({ state: { ...INITIAL_ENABLE_MESSAGING_STATE, phase: 'success', pubky: OWNER } }),
  'auth.enable.error': () =>
    enable({
      state: {
        ...INITIAL_ENABLE_MESSAGING_STATE,
        phase: 'error',
        message: COPY.couldNotStartAuthorization,
      },
    }),
  'tabs.chats.messaging-off': () =>
    chats({ needsEnable: true, showEnableCta: true, ownerPubky: OWNER }),
  'tabs.chats.empty': () => chats(),
  'tabs.chats.populated': () =>
    chats({ conversations: CHAT_ROWS.map(row => ({ ...row, unreadCount: 0 })) }),
  'tabs.chats.unread-99': () => chats({ conversations: CHAT_ROWS }),
  'tabs.chats.pending-badge': () => chats({ pendingRequests: 120 }),
  'tabs.chats.offline': () =>
    chats({ listError: COPY.couldNotLoadChats, conversations: CHAT_ROWS }),
  'tabs.channels.empty': () => channels(),
  'tabs.channels.populated': () => channels({ channels: CHANNELS_POPULATED }),
  'tabs.channels.create-private': () =>
    channels({ createOpen: true, contacts: CONTACTS_POPULATED }),
  'tabs.channels.create-public': () =>
    channels({ createOpen: true, createPublicDefault: true, publicOptIn: true }),
  'tabs.channels.join-empty': () => channels({ joinOpen: true }),
  'tabs.channels.join-invalid': () => channels({ joinOpen: true }),
  'tabs.channels.join-busy': () => channels({ joinOpen: true, busy: true }),
  'stack.channel.loading': () =>
    channel({ channel: null, loading: true, messages: [], members: [], selfActive: false }),
  'stack.channel.empty': () => channel({ messages: [] }),
  'stack.channel.populated': () => channel(),
  'stack.channel.deleted': () =>
    channel({
      messages: CHANNEL_MESSAGES.map((m, i) => (i === 0 ? { ...m, deleted: true, body: '' } : m)),
    }),
  'stack.channel.reply': () => {
    const [parent, child] = CHANNEL_MESSAGES;
    if (!parent || !child) return channel();
    return channel({
      messages: [
        parent,
        {
          ...child,
          replyToEventId: parent.eventId,
          replyToAuthorPubky: parent.senderPubky,
        },
      ],
      replyTo: parent,
    });
  },
  'stack.channel.reactions': () => {
    const base = CHANNEL_MESSAGES[0];
    if (!base) return channel();
    const react = {
      ...base,
      eventId: 'g-react',
      kind: GROUP_REACTION_KIND,
      body: '👍',
      targetEventId: base.eventId,
      targetAuthorPubky: base.senderPubky,
    };
    return channel({ messages: [...CHANNEL_MESSAGES, react] });
  },
  'stack.channel.membership': () => {
    const base = CHANNEL_MESSAGES[0];
    if (!base) return channel();
    return channel({
      messages: [
        {
          ...base,
          eventId: 'g-mem',
          kind: GROUP_MEMBERSHIP_KIND,
          body: 'joined',
        },
      ],
    });
  },
  'stack.channel.composer-hidden': () => channel({ selfActive: false }),
  'stack.channel.public': () => channel({ channel: { ...CHANNEL_FIXTURE, isPublic: true } }),
  'stack.channel-members.list': () => channel({ showMembers: true }),
  'stack.channel-members.admin-add': () =>
    channel({ showMembers: true, addPubky: PEER, isAdmin: true }),
  'stack.channel-members.leave': () => channel({ showMembers: true }),
  'stack.channel-members.left': () => channel({ showMembers: true, selfActive: false }),
  'stack.channel-members.public-refresh': () =>
    channel({ showMembers: true, channel: { ...CHANNEL_FIXTURE, isPublic: true } }),
  'tabs.contacts.empty': () => contacts(),
  'tabs.contacts.populated': () => contacts({ contacts: CONTACTS_POPULATED }),
  'tabs.contacts.syncing': () => contacts({ contacts: CONTACTS_POPULATED, importing: true }),
  'tabs.contacts.nexus-note': () =>
    contacts({
      contacts: CONTACTS_POPULATED,
      followsImportEnabled: true,
      usedNexusFallback: true,
    }),
  'tabs.contacts.offline': () => contacts({ offline: true, loadError: COPY.couldNotLoadChats }),
  'tabs.contacts.scan': () => (
    <>
      {contacts({ contacts: CONTACTS_POPULATED })}
      <ContactQrScanner
        visible
        permission="granted"
        error={null}
        onClose={n}
        onBarcode={n}
        onManualFallback={n}
      />
    </>
  ),
  'tabs.contacts.scan-denied': () => (
    <>
      {contacts({ contacts: CONTACTS_POPULATED })}
      <ContactQrScanner
        visible
        permission="denied"
        error={null}
        onClose={n}
        onBarcode={n}
        onManualFallback={n}
      />
    </>
  ),
  'stack.contact-search.empty': () => (
    <ContactSearchView
      loading={false}
      error={null}
      errorDetails={null}
      onCancel={n}
      onAdd={n}
      onScanQr={n}
    />
  ),
  'stack.contact-search.invalid': () => (
    <ContactSearchView
      loading={false}
      error={null}
      errorDetails={null}
      onCancel={n}
      onAdd={n}
      onScanQr={n}
      initialValue="not-a-pubky"
    />
  ),
  'stack.contact-search.valid': () => (
    <ContactSearchView
      loading={false}
      error={null}
      errorDetails={null}
      onCancel={n}
      onAdd={n}
      onScanQr={n}
      initialValue={PEER}
    />
  ),
  'stack.contact-search.loading': () => (
    <ContactSearchView
      loading
      error={null}
      errorDetails={null}
      onCancel={n}
      onAdd={n}
      onScanQr={n}
      initialValue={PEER}
    />
  ),
  'stack.contact-search.not-found': () => (
    <ContactSearchView
      loading={false}
      error="Not Found"
      errorDetails={null}
      onCancel={n}
      onAdd={n}
      onScanQr={n}
      initialValue={PEER}
    />
  ),
  'stack.contact-search.added': () => (
    <ContactSearchView
      loading={false}
      error={null}
      errorDetails={null}
      onCancel={n}
      onAdd={n}
      onScanQr={n}
      initialValue={PEER}
    />
  ),
  'stack.contact-search.qr': () => (
    <>
      <ContactSearchView
        loading={false}
        error={null}
        errorDetails={null}
        onCancel={n}
        onAdd={n}
        onScanQr={n}
      />
      <ContactQrScanner
        visible
        permission="granted"
        error={null}
        onClose={n}
        onBarcode={n}
        onManualFallback={n}
      />
    </>
  ),
  'stack.contact-detail.default': () => (
    <ContactDetailView
      pubky={PEER}
      contact={CONTACTS_POPULATED[0] ?? null}
      loading={false}
      loadError={null}
      loadErrorDetails={null}
      trust={null}
      linkLabel="Encrypted link ready"
      paymentIdentifiers={[]}
      paymentsUnavailableOffline={false}
      followsImportEnabled={false}
      blocked={false}
      cleanupPending={false}
      onBack={n}
      onMessage={n}
      onCopy={n}
      onShare={n}
      onRetry={n}
      onBlock={n}
      onUnblock={n}
      onRemove={n}
      nickname="Ada"
      onChangeNickname={n}
      onSaveNickname={n}
    />
  ),
  'tabs.profile.unnamed': () => profile({ displayName: COPY.notConnected, pubky: null }),
  'tabs.profile.with-pubky': () => profile(),
  'tabs.profile.qr': () => profile({ qrOpen: true }),
  'tabs.profile.settings-visible': () => profile(),
  'tabs.profile.sign-out': () => profile({ signOutOpen: true }),
  'tabs.profile.debug': () =>
    profile({ displayName: 'Debug Cedar', copied: true, debugSlot: debugBusy }),
  'stack.thread.loading': () => (
    <ThreadScreenContent {...threadProps({ loading: true, linkMessages: [] })} />
  ),
  'stack.thread.empty': () => <ThreadScreenContent {...threadProps({ linkMessages: [] })} />,
  'stack.thread.populated': () => <ThreadScreenContent {...threadProps()} />,
  'stack.thread.keyboard-open': () => (
    <View style={styles.fill}>
      <View style={styles.fill}>
        <ThreadScreenContent {...threadProps({ draft: 'Typing above the keyboard' })} />
      </View>
      <View testID="vrtKeyboardInset" style={styles.keyboardInset} />
    </View>
  ),
  'stack.thread.send-disabled': () => <ThreadScreenContent {...threadProps({ draft: '' })} />,
  'stack.thread.sending': () => (
    <ThreadScreenContent {...threadProps({ sending: true, draft: 'Hi' })} />
  ),
  'stack.thread.failed': () => (
    <ThreadScreenContent
      {...threadProps({
        linkMessages: [
          linkMessage({
            eventId: 'fail-1',
            direction: 'sent',
            body: 'Failed send fixture',
            deliveryState: 'failed',
          }),
        ],
        retryableEventIds: new Set(['fail-1']),
      })}
    />
  ),
  'stack.thread.delivered-read': () => <ThreadScreenContent {...threadProps()} />,
  'stack.thread.messaging-cta': () => (
    <ThreadScreenContent {...threadProps({ sessionKind: 'needs-enable' })} />
  ),
  'stack.thread.payment-pending': () => (
    <ThreadScreenContent
      {...threadProps({ payments: [paymentRecord('pending')], linkMessages: [] })}
    />
  ),
  'stack.thread.payment-accepted': () => (
    <ThreadScreenContent
      {...threadProps({ payments: [paymentRecord('accepted')], linkMessages: [] })}
    />
  ),
  'stack.thread.payment-expired': () => (
    <ThreadScreenContent
      {...threadProps({ payments: [paymentRecord('cancelled')], linkMessages: [] })}
    />
  ),
  'stack.thread.payment-claimed': () => (
    <ThreadScreenContent
      {...threadProps({
        payments: [
          paymentRecord('accepted', {
            proofJson: '{}',
            proofVerified: false,
          }),
        ],
        linkMessages: [],
      })}
    />
  ),
  'stack.thread.payment-verified': () => (
    <ThreadScreenContent
      {...threadProps({ payments: [paymentRecord('proof_received')], linkMessages: [] })}
    />
  ),
  'stack.thread.attach-uploading': () => (
    <ThreadScreenContent
      {...threadProps({ attachments: [attachment('uploading')], linkMessages: [] })}
    />
  ),
  'stack.thread.attach-failed': () => (
    <ThreadScreenContent
      {...threadProps({ attachments: [attachment('failed')], linkMessages: [] })}
    />
  ),
  'stack.thread.attach-image': () => (
    <ThreadScreenContent
      {...threadProps({ attachments: [attachment('ready')], linkMessages: [] })}
    />
  ),
  'stack.thread.attach-backup': () => (
    <ThreadScreenContent
      {...threadProps({ attachments: [attachment('unavailable-from-backup')], linkMessages: [] })}
    />
  ),
  'stack.composer.sheet': () => (
    <View style={styles.fill}>
      <ThreadScreenContent {...threadProps({ actionMenuOpen: true })} />
      <ComposerActionMenu
        visible
        actions={composerActionItems('dm', {
          messagingEnabled: true,
          inboxClosed: false,
          hasTipEndpoints: true,
        })}
        onSelect={n}
        onClose={n}
      />
    </View>
  ),
  'stack.thread.tip-collapsed': () => (
    <ThreadScreenContent {...threadProps({ tipPickerOpen: false })} />
  ),
  'stack.thread.tip-empty': () => (
    <View style={styles.fill}>
      <ThreadTipBarContent endpoints={[]} onTip={n} />
    </View>
  ),
  'stack.thread.tip-expiry': () => (
    <View style={styles.fill}>
      <ThreadTipBarContent endpoints={[tip(true)]} onTip={n} />
    </View>
  ),
  'stack.payment.compose-idle': () => (
    <PaymentComposeSheet visible busy={false} onClose={n} onSubmit={n} />
  ),
  'stack.payment.compose-amount': () => (
    <PaymentComposeSheet
      visible
      busy={false}
      initialAmount="nope"
      seedError="Enter a valid BTC amount"
      onClose={n}
      onSubmit={n}
    />
  ),
  'stack.payment.compose-reference': () => (
    <PaymentComposeSheet
      visible
      busy={false}
      initialAmount="0.0001"
      seedError="Enter a payment reference"
      onClose={n}
      onSubmit={n}
    />
  ),
  'stack.payment.compose-busy': () => <PaymentComposeSheet visible busy onClose={n} onSubmit={n} />,
  'stack.payment.review': () => (
    <PaymentReviewSheet
      visible
      review={PAYMENT_REVIEW_FIXTURE}
      busy={false}
      onClose={n}
      onContinue={n}
      onCopyUri={n}
    />
  ),
  'tabs.requests.empty': () => (
    <MessageRequestsContent
      pendingRows={[]}
      declinedRows={[]}
      busyPeer={null}
      ownerPubky={OWNER}
      onBack={n}
      onAccept={n}
      onAcceptDeclined={n}
      onDecline={n}
    />
  ),
  'tabs.requests.populated': () => (
    <MessageRequestsContent
      pendingRows={MESSAGE_REQUEST_ROWS}
      declinedRows={[]}
      busyPeer={null}
      ownerPubky={OWNER}
      onBack={n}
      onAccept={n}
      onAcceptDeclined={n}
      onDecline={n}
    />
  ),
  'tabs.requests.busy': () => (
    <MessageRequestsContent
      pendingRows={MESSAGE_REQUEST_ROWS}
      declinedRows={[]}
      busyPeer={REQUEST_PENDING.request.peerPubky}
      ownerPubky={OWNER}
      onBack={n}
      onAccept={n}
      onAcceptDeclined={n}
      onDecline={n}
    />
  ),
  'tabs.settings.default': () => settings(),
  'tabs.settings.mesh-on': () => settings({ meshEnabled: true }),
  'tabs.settings.telemetry-on': () => settingsScrolled({ telemetryEnabled: true }, 480),
  'tabs.settings.backup-busy': () => settingsScrolled({ backupBusy: true }, 250),
  'tabs.settings.recovery-shown': () =>
    settingsScrolled(
      {
        recoveryCode: 'fix-code-aaaa-bbbb',
        recoveryConfirmed: true,
        recoveryCopied: true,
      },
      250,
    ),
  'tabs.settings.restore-ok': () =>
    settingsScrolled(
      {
        restoreCode: 'fix-code-aaaa-bbbb',
        restoreNote: 'Restore complete. History is local.',
      },
      330,
    ),
  'tabs.settings.restore-err': () =>
    settingsScrolled(
      {
        restoreCode: 'bad-code',
        restoreNote: 'That recovery code did not work.',
        restoreError: 'mismatch',
      },
      330,
    ),
  'tabs.settings.enable-row': () =>
    settingsScrolled({ session: sessionUiModel('needs-enable') }, 420),
  'tabs.settings.liveproof-idle': () =>
    settingsScrolled({ liveProofSlot: debugState('Live proof idle') }, 760),
  'tabs.settings.liveproof-running': () =>
    settingsScrolled(
      {
        liveProofSlot: debugState(
          'Live proof running',
          'neutral',
          'Authorizing through the VRT relay fixture.',
        ),
      },
      760,
    ),
  'tabs.settings.liveproof-ok': () =>
    settingsScrolled({ liveProofSlot: debugState('Live proof ok', 'success') }, 760),
  'tabs.settings.liveproof-fail': () =>
    settingsScrolled({ liveProofSlot: debugState('Live proof failed', 'danger') }, 760),
  'overlay.attach.alert': () => (
    <ComposerActionMenu
      visible
      actions={composerActionItems('dm', {
        messagingEnabled: true,
        inboxClosed: false,
        hasTipEndpoints: false,
      })}
      onSelect={n}
      onClose={n}
    />
  ),
  'overlay.permission.alert': () => (
    <View style={styles.splash} testID="permissionAlertHost">
      <Text>Photo library permission is required to attach.</Text>
    </View>
  ),
  'overlay.wallet.alert': () => (
    <PaymentReviewSheet
      visible
      review={mapPaymentReview({ ...PAYMENT_REVIEW_INPUT, walletUnavailable: true })}
      busy={false}
      onClose={n}
      onContinue={n}
      onCopyUri={n}
    />
  ),
  'overlay.e2e-hud.success': () => hud(false),
  'overlay.e2e-hud.error': () => hud(true),
  'overlay.sign-out.alert': () => profile({ signOutOpen: true }),
  'chrome.tab-bar.focused': () => tabChrome(true),
  'chrome.tab-bar.unfocused': () => tabChrome(false),
  'a11y.font-scale.two': fontScaleTwoWelcome,

  // HEAD catalog aliases (content-duplicate / renamed rows)
  'tabs.contacts.content-empty': () => contacts(),
  'tabs.contacts.content-populated': () => contacts({ contacts: CONTACTS_POPULATED }),
  'tabs.contacts.content-offline': () =>
    contacts({ offline: true, loadError: COPY.couldNotLoadChats }),
  'tabs.message-requests.empty': () => (
    <MessageRequestsContent
      pendingRows={[]}
      declinedRows={[]}
      busyPeer={null}
      ownerPubky={OWNER}
      onBack={n}
      onAccept={n}
      onAcceptDeclined={n}
      onDecline={n}
    />
  ),
  'tabs.message-requests.populated': () => (
    <MessageRequestsContent
      pendingRows={MESSAGE_REQUEST_ROWS}
      declinedRows={[]}
      busyPeer={null}
      ownerPubky={OWNER}
      onBack={n}
      onAccept={n}
      onAcceptDeclined={n}
      onDecline={n}
    />
  ),
  'tabs.settings.recovery-gate': () =>
    settingsScrolled({ recoveryCode: 'fix-code-aaaa-bbbb', recoveryConfirmed: false }, 250),
  'stack.composer.emoji': () => (
    <View style={styles.fill}>
      <EmojiPickerSheet visible onClose={n} onPick={n} />
    </View>
  ),
  'stack.composer.gif-unconfigured': () => (
    <View style={styles.fill}>
      <GifPickerSheet
        visible
        onClose={n}
        onPick={n}
        seedResult={{ ok: false, reason: 'not-configured', message: 'not configured' }}
      />
    </View>
  ),
  'tabs.chats.archived': () =>
    chats({
      conversations: CHAT_ROWS.map(row => ({ ...row, unreadCount: 0 })),
      listFilter: 'archived',
    }),
  'stack.thread.day-separator': () => (
    <ThreadScreenContent
      {...threadProps({
        linkMessages: [
          linkMessage({
            eventId: 'evt-day-1',
            direction: 'received',
            body: 'Yesterday fixture.',
            deliveryState: 'delivered',
            sentAt: FIXED_NOW_MS - 36 * 60 * 60 * 1000,
          }),
          linkMessage({
            eventId: 'evt-day-2',
            direction: 'sent',
            body: 'Today fixture.',
            deliveryState: 'read',
            sentAt: FIXED_NOW_MS - 60_000,
          }),
        ],
      })}
    />
  ),
  'tabs.profile.display-name': () =>
    profile({ displayName: 'Cedar Example', nameDraft: 'Cedar Example' }),
};

export function renderVrtScene(id: string): React.ReactElement {
  const render = SCENE_RENDERERS[id];
  if (!render) throw new Error(`Unknown scene ${id}`);
  return render();
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: color.canvas,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.xxl,
  },
  fill: { flex: 1, backgroundColor: color.canvas },
  keyboardInset: { height: 280, backgroundColor: color.surfaceRaised },
  debugState: {
    marginHorizontal: space.xl,
    marginBottom: space.xxxl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    borderRadius: radius.md,
    padding: space.lg,
    backgroundColor: color.surface,
  },
  debugStateTitle: {
    color: color.textPrimary,
    fontSize: typeRole.body.fontSize,
    fontWeight: '700',
  },
  debugStateBody: {
    color: color.textSecondary,
    fontSize: typeRole.caption.fontSize,
    marginTop: space.xs,
  },
  debugProgress: {
    marginTop: space.md,
    gap: space.sm,
  },
  debugProgressTrack: {
    height: 6,
    borderRadius: radius.sm,
    backgroundColor: color.surfaceRaised,
    overflow: 'hidden',
  },
  debugProgressFill: {
    width: '62%',
    height: '100%',
    backgroundColor: color.brand,
  },
  success: { color: color.success },
  danger: { color: color.danger },
  fontScaleBadge: {
    position: 'absolute',
    top: space.lg,
    right: space.lg,
    maxWidth: 168,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.brand,
    borderRadius: radius.md,
    padding: space.sm,
    backgroundColor: color.surface,
  },
  fontScaleTitle: {
    color: color.textPrimary,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
    fontWeight: '700',
  },
  fontScaleBody: {
    color: color.textSecondary,
    fontSize: typeRole.meta.fontSize,
    lineHeight: typeRole.meta.lineHeight,
    marginTop: space.xs,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: color.canvas,
    borderTopColor: color.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.md,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: space.xs },
});
