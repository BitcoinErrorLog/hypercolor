import { createElement } from 'react';
import { catalogMetaById, VRT_CATALOG_META } from './catalogMeta';
import { TokenSwatchScreen } from './scenes/TokenSwatchScreen';
import {
  AwaitingRingWaitingScene,
  AwaitingRingWithUrlScene,
  ChannelsEmptyScene,
  ChannelsPopulatedScene,
  ChatsEmptyScene,
  ChatsOfflineScene,
  ChatsPopulatedScene,
  ComposerSheetScene,
  ContactsContentEmptyScene,
  ContactsContentOfflineScene,
  ContactsContentPopulatedScene,
  ContactsEmptyScene,
  ContactsOfflineScene,
  ContactsPopulatedScene,
  EnableAuthorizingScene,
  EnableCheckingScene,
  EnableErrorScene,
  EnableSuccessScene,
  MessageRequestsEmptyScene,
  MessageRequestsPopulatedScene,
  PaymentReviewScene,
  SettingsDefaultScene,
  SettingsRecoveryGateScene,
  ThreadEmptyScene,
  ThreadLoadingScene,
  ThreadPopulatedScene,
  WelcomeErrorScene,
  WelcomeIdleScene,
  WelcomeLoadingScene,
} from './scenes/JourneyScenes';
import type { VrtCatalogEntry } from './types';

export function assertCatalogAllowed(): void {
  if (
    process.env.E2E_VRT === '1' ||
    process.env.EXPO_PUBLIC_E2E_VRT === '1' ||
    process.env.NODE_ENV === 'test'
  ) {
    return;
  }
  throw new Error(
    'VRT catalog requires E2E_VRT=1 (or NODE_ENV=test). Production must not mount it.',
  );
}

const RENDERERS: Record<string, VrtCatalogEntry['render']> = {
  'design-system.token-swatch.default': () => {
    assertCatalogAllowed();
    return createElement(TokenSwatchScreen);
  },
  'auth.welcome.idle': () => {
    assertCatalogAllowed();
    return createElement(WelcomeIdleScene);
  },
  'auth.welcome.loading': () => {
    assertCatalogAllowed();
    return createElement(WelcomeLoadingScene);
  },
  'auth.welcome.error': () => {
    assertCatalogAllowed();
    return createElement(WelcomeErrorScene);
  },
  'auth.awaiting-ring.with-url': () => {
    assertCatalogAllowed();
    return createElement(AwaitingRingWithUrlScene);
  },
  'auth.awaiting-ring.waiting': () => {
    assertCatalogAllowed();
    return createElement(AwaitingRingWaitingScene);
  },
  'auth.enable.checking': () => {
    assertCatalogAllowed();
    return createElement(EnableCheckingScene);
  },
  'auth.enable.authorizing': () => {
    assertCatalogAllowed();
    return createElement(EnableAuthorizingScene);
  },
  'auth.enable.success': () => {
    assertCatalogAllowed();
    return createElement(EnableSuccessScene);
  },
  'auth.enable.error': () => {
    assertCatalogAllowed();
    return createElement(EnableErrorScene);
  },
  'tabs.chats.empty': () => {
    assertCatalogAllowed();
    return createElement(ChatsEmptyScene);
  },
  'tabs.chats.offline': () => {
    assertCatalogAllowed();
    return createElement(ChatsOfflineScene);
  },
  'tabs.chats.populated': () => {
    assertCatalogAllowed();
    return createElement(ChatsPopulatedScene);
  },
  'tabs.contacts.empty': () => {
    assertCatalogAllowed();
    return createElement(ContactsEmptyScene);
  },
  'tabs.contacts.populated': () => {
    assertCatalogAllowed();
    return createElement(ContactsPopulatedScene);
  },
  'tabs.contacts.offline': () => {
    assertCatalogAllowed();
    return createElement(ContactsOfflineScene);
  },
  'tabs.contacts.content-empty': () => {
    assertCatalogAllowed();
    return createElement(ContactsContentEmptyScene);
  },
  'tabs.contacts.content-populated': () => {
    assertCatalogAllowed();
    return createElement(ContactsContentPopulatedScene);
  },
  'tabs.contacts.content-offline': () => {
    assertCatalogAllowed();
    return createElement(ContactsContentOfflineScene);
  },
  'tabs.message-requests.empty': () => {
    assertCatalogAllowed();
    return createElement(MessageRequestsEmptyScene);
  },
  'tabs.message-requests.populated': () => {
    assertCatalogAllowed();
    return createElement(MessageRequestsPopulatedScene);
  },
  'tabs.settings.default': () => {
    assertCatalogAllowed();
    return createElement(SettingsDefaultScene);
  },
  'tabs.settings.recovery-gate': () => {
    assertCatalogAllowed();
    return createElement(SettingsRecoveryGateScene);
  },
  'stack.thread.empty': () => {
    assertCatalogAllowed();
    return createElement(ThreadEmptyScene);
  },
  'stack.thread.loading': () => {
    assertCatalogAllowed();
    return createElement(ThreadLoadingScene);
  },
  'stack.thread.populated': () => {
    assertCatalogAllowed();
    return createElement(ThreadPopulatedScene);
  },
  'stack.composer.sheet': () => {
    assertCatalogAllowed();
    return createElement(ComposerSheetScene);
  },
  'stack.payment.review': () => {
    assertCatalogAllowed();
    return createElement(PaymentReviewScene);
  },
  'tabs.channels.empty': () => {
    assertCatalogAllowed();
    return createElement(ChannelsEmptyScene);
  },
  'tabs.channels.populated': () => {
    assertCatalogAllowed();
    return createElement(ChannelsPopulatedScene);
  },
};

export const VRT_CATALOG: readonly VrtCatalogEntry[] = Object.freeze(
  VRT_CATALOG_META.map(meta => {
    const render = RENDERERS[meta.id];
    if (!render) {
      throw new Error(`Catalog meta ${meta.id} has no renderer`);
    }
    return Object.freeze({ ...meta, render });
  }),
);

export function catalogById(id: string): VrtCatalogEntry {
  const meta = catalogMetaById(id);
  const entry = VRT_CATALOG.find(item => item.id === meta.id);
  if (!entry) {
    throw new Error(`Unknown VRT catalog id: ${id}`);
  }
  return entry;
}
