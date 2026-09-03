export type IntegrityWaiver = {
  readonly scenes: readonly [string, string];
  readonly reason: string;
};

function pairs(scenes: readonly string[], reason: string): readonly IntegrityWaiver[] {
  const waivers: IntegrityWaiver[] = [];
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      waivers.push({ scenes: [scenes[i]!, scenes[j]!], reason });
    }
  }
  return waivers;
}

export const INTEGRITY_WAIVERS: readonly IntegrityWaiver[] = Object.freeze([
  ...pairs(
    ['bootstrap.app-splash.loading', 'bootstrap.linking-fallback.loading'],
    'Both loading fallbacks intentionally render the same centered activity indicator.',
  ),
  ...pairs(
    ['auth.enable.enabled', 'auth.enable.success'],
    'The controller alias and terminal success phase intentionally use the same success presenter.',
  ),
  ...pairs(
    ['auth.welcome.debug-empty', 'auth.welcome.debug-result'],
    'Both debug-panel states intentionally render the same inactive debug slot.',
  ),
  ...pairs(
    ['auth.awaiting-ring.copied', 'auth.awaiting-ring.with-url'],
    'Copied is a transient acknowledgement on the same Ring-auth URL surface; the only expected visual delta is the copy control state.',
  ),
  ...pairs(
    ['overlay.sign-out.alert', 'tabs.profile.sign-out'],
    'The overlay row and profile state both exercise the same sign-out sheet.',
  ),
  ...pairs(
    ['overlay.wallet.alert', 'stack.payment.review'],
    'Wallet-unavailable and normal review currently share the same review copy in the presenter.',
  ),
  ...pairs(
    ['stack.channel-members.leave', 'stack.channel-members.list'],
    'The member-list and leave affordance states render the same members sheet before interaction.',
  ),
  ...pairs(
    ['stack.contact-search.added', 'stack.contact-search.valid'],
    'Added and valid contact-search fixtures intentionally render the same entered pubky.',
  ),
  ...pairs(
    ['stack.contact-search.empty', 'stack.contact-search.qr'],
    'The QR fallback has no distinct production card in this wave, so it matches empty search.',
  ),
  ...pairs(
    ['stack.payment.compose-busy', 'stack.payment.compose-idle'],
    'The busy flag only changes disabled accessibility state for the default empty form.',
  ),
  ...pairs(
    [
      'stack.thread.delivered-read',
      'stack.thread.populated',
      'stack.thread.send-disabled',
      'stack.thread.tip-collapsed',
    ],
    'These thread fixtures intentionally share the same visible transcript and collapsed composer.',
  ),
  ...pairs(
    ['stack.thread.payment-claimed', 'stack.thread.payment-verified'],
    'Claimed and verified payment records currently share the same verified receipt rendering.',
  ),
  ...pairs(
    ['tabs.channels.join-empty', 'tabs.channels.join-invalid'],
    'Join invalid has no seeded input prop, so it matches the empty join sheet.',
  ),
  ...pairs(
    ['tabs.channels.join-busy', 'tabs.channels.join-empty', 'tabs.channels.join-invalid'],
    'The busy join state is visually identical until a valid public channel reference exists.',
  ),
  ...pairs(
    ['tabs.contacts.content-empty', 'tabs.contacts.empty'],
    'Content aliases preserve HEAD matrix naming while rendering the same contacts empty state.',
  ),
  ...pairs(
    ['tabs.contacts.content-offline', 'tabs.contacts.offline'],
    'Content aliases preserve HEAD matrix naming while rendering the same contacts offline state.',
  ),
  ...pairs(
    ['tabs.contacts.content-populated', 'tabs.contacts.nexus-note', 'tabs.contacts.populated'],
    'Contacts populated aliases render the same list; the Nexus note is below the captured fold.',
  ),
  ...pairs(
    ['tabs.message-requests.empty', 'tabs.requests.empty'],
    'Message request aliases preserve HEAD matrix naming while rendering the same empty list.',
  ),
  ...pairs(
    ['tabs.message-requests.populated', 'tabs.requests.populated'],
    'Message request aliases preserve HEAD matrix naming while rendering the same populated list.',
  ),
  ...pairs(
    ['tabs.profile.settings-visible', 'tabs.profile.with-pubky'],
    'Settings-visible is a navigation affordance state with no open sheet in the presenter.',
  ),
]);

export function integrityWaiverKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export const INTEGRITY_WAIVER_MAP: ReadonlyMap<string, IntegrityWaiver> = new Map(
  INTEGRITY_WAIVERS.map(waiver => [integrityWaiverKey(...waiver.scenes), waiver]),
);
