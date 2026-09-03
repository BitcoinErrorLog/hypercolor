import type { VrtMaskRule, VrtPlatform, VrtSceneRef, VrtTheme, VrtViewport } from './types';

export type VrtCatalogMeta = VrtSceneRef;

function meta(
  id: string,
  journey: string,
  screen: string,
  state: string,
  mask: readonly VrtMaskRule[] = [],
): VrtCatalogMeta {
  return Object.freeze({
    id,
    journey,
    screen,
    platform: 'all' as VrtPlatform | 'all',
    viewport: 'all' as VrtViewport | 'all',
    theme: 'dark' as VrtTheme,
    state,
    mask: Object.freeze(mask) as readonly VrtMaskRule[],
  });
}

export const VRT_CATALOG_META: readonly VrtCatalogMeta[] = Object.freeze([
  meta('design-system.token-swatch.default', 'design-system', 'token-swatch', 'default'),
  meta('auth.welcome.idle', 'auth', 'welcome', 'idle'),
  meta('auth.welcome.error', 'auth', 'welcome', 'error'),
  meta('tabs.chats.empty', 'tabs', 'chats', 'empty'),
  meta('tabs.chats.offline', 'tabs', 'chats', 'offline'),
  meta('tabs.contacts.empty', 'tabs', 'contacts', 'empty'),
  meta('tabs.contacts.populated', 'tabs', 'contacts', 'populated', [
    Object.freeze({ testID: 'mask-pubky', reason: 'pubky' as const }),
  ]),
  meta('tabs.contacts.offline', 'tabs', 'contacts', 'offline'),

  meta('auth.enable.checking', 'auth', 'enable', 'checking'),
  meta('auth.enable.success', 'auth', 'enable', 'success'),
  meta('tabs.settings.default', 'tabs', 'settings', 'default'),
  meta('stack.thread.empty', 'stack', 'thread', 'empty', [
    Object.freeze({ testID: 'mask-pubky', reason: 'pubky' as const }),
  ]),
  meta('tabs.channels.empty', 'tabs', 'channels', 'empty'),
]);

export function catalogMetaById(id: string): VrtCatalogMeta {
  const entry = VRT_CATALOG_META.find(item => item.id === id);
  if (!entry) {
    throw new Error(`Unknown VRT catalog id: ${id}`);
  }
  return entry;
}
