import { createElement } from 'react';
import { catalogMetaById, VRT_CATALOG_META } from './catalogMeta';
import { TokenSwatchScreen } from './scenes/TokenSwatchScreen';
import {
  ChatsEmptyScene,
  ChatsOfflineScene,
  ContactsEmptyScene,
  ContactsOfflineScene,
  ContactsPopulatedScene,
  WelcomeErrorScene,
  WelcomeIdleScene,
  EnableCheckingScene,
  EnableSuccessScene,
  SettingsDefaultScene,
  ThreadEmptyScene,
  ChannelsEmptyScene,
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
  'auth.welcome.error': () => {
    assertCatalogAllowed();
    return createElement(WelcomeErrorScene);
  },
  'tabs.chats.empty': () => {
    assertCatalogAllowed();
    return createElement(ChatsEmptyScene);
  },
  'tabs.chats.offline': () => {
    assertCatalogAllowed();
    return createElement(ChatsOfflineScene);
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
  'auth.enable.checking': () => {
    assertCatalogAllowed();
    return createElement(EnableCheckingScene);
  },
  'auth.enable.success': () => {
    assertCatalogAllowed();
    return createElement(EnableSuccessScene);
  },
  'tabs.settings.default': () => {
    assertCatalogAllowed();
    return createElement(SettingsDefaultScene);
  },
  'stack.thread.empty': () => {
    assertCatalogAllowed();
    return createElement(ThreadEmptyScene);
  },
  'tabs.channels.empty': () => {
    assertCatalogAllowed();
    return createElement(ChannelsEmptyScene);
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
