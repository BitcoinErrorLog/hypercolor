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

const pubkyMask = Object.freeze({ testID: 'mask-pubky', reason: 'pubky' as const });
const authUrlMask = Object.freeze({ testID: 'mask-auth-url', reason: 'secret' as const });

export const VRT_CATALOG_META: readonly VrtCatalogMeta[] = Object.freeze([
  meta('design-system.token-swatch.default', 'design-system', 'token-swatch', 'default'),
  meta('auth.welcome.idle', 'auth', 'welcome', 'idle'),
  meta('auth.welcome.loading', 'auth', 'welcome', 'loading'),
  meta('auth.welcome.error', 'auth', 'welcome', 'error'),
  meta('auth.awaiting-ring.with-url', 'auth', 'awaiting-ring', 'with-url', [authUrlMask]),
  meta('auth.awaiting-ring.waiting', 'auth', 'awaiting-ring', 'waiting'),
  meta('auth.enable.checking', 'auth', 'enable', 'checking'),
  meta('auth.enable.authorizing', 'auth', 'enable', 'authorizing', [authUrlMask]),
  meta('auth.enable.success', 'auth', 'enable', 'success'),
  meta('auth.enable.error', 'auth', 'enable', 'error'),
  meta('tabs.chats.empty', 'tabs', 'chats', 'empty'),
  meta('tabs.chats.offline', 'tabs', 'chats', 'offline'),
  meta('tabs.chats.populated', 'tabs', 'chats', 'populated'),
  meta('tabs.contacts.empty', 'tabs', 'contacts', 'empty'),
  meta('tabs.contacts.populated', 'tabs', 'contacts', 'populated', [pubkyMask]),
  meta('tabs.contacts.offline', 'tabs', 'contacts', 'offline'),
  meta('tabs.contacts.content-empty', 'tabs', 'contacts-content', 'empty'),
  meta('tabs.contacts.content-populated', 'tabs', 'contacts-content', 'populated', [pubkyMask]),
  meta('tabs.contacts.content-offline', 'tabs', 'contacts-content', 'offline'),
  meta('tabs.message-requests.empty', 'tabs', 'message-requests', 'empty'),
  meta('tabs.message-requests.populated', 'tabs', 'message-requests', 'populated', [pubkyMask]),
  meta('tabs.settings.default', 'tabs', 'settings', 'default'),
  meta('tabs.settings.recovery-gate', 'tabs', 'settings', 'recovery-gate'),
  meta('stack.thread.empty', 'stack', 'thread', 'empty', [pubkyMask]),
  meta('stack.thread.loading', 'stack', 'thread', 'loading', [pubkyMask]),
  meta('stack.thread.populated', 'stack', 'thread', 'populated', [pubkyMask]),
  meta('stack.composer.sheet', 'stack', 'composer', 'sheet'),
  meta('stack.payment.review', 'stack', 'payment', 'review', [pubkyMask]),
  meta('tabs.channels.empty', 'tabs', 'channels', 'empty'),
  meta('tabs.channels.populated', 'tabs', 'channels', 'populated'),
]);

export function catalogMetaById(id: string): VrtCatalogMeta {
  const entry = VRT_CATALOG_META.find(item => item.id === id);
  if (!entry) {
    throw new Error(`Unknown VRT catalog id: ${id}`);
  }
  return entry;
}
