# VRT matrix coverage

- Catalog cells: **123**
- Scene renderers: **123** (1:1 with catalogMeta, including HEAD aliases)
- Uncovered product cells: **0** inside the catalog; skips below are out-of-catalog / deferred

## Covered

| Catalog id | Scene | Notes |
|---|---|---|
| `design-system.token-swatch.default` | `SCENE_RENDERERS['design-system.token-swatch.default']` | Production Content / presenter |
| `bootstrap.app-splash.loading` | `SCENE_RENDERERS['bootstrap.app-splash.loading']` | Production Content / presenter |
| `bootstrap.linking-fallback.loading` | `SCENE_RENDERERS['bootstrap.linking-fallback.loading']` | Production Content / presenter |
| `auth.welcome.idle` | `SCENE_RENDERERS['auth.welcome.idle']` | Production Content / presenter |
| `auth.welcome.loading` | `SCENE_RENDERERS['auth.welcome.loading']` | Production Content / presenter |
| `auth.welcome.error` | `SCENE_RENDERERS['auth.welcome.error']` | Production Content / presenter |
| `auth.welcome.debug-empty` | `SCENE_RENDERERS['auth.welcome.debug-empty']` | Production Content / presenter |
| `auth.welcome.debug-busy` | `SCENE_RENDERERS['auth.welcome.debug-busy']` | Production Content / presenter |
| `auth.welcome.debug-error` | `SCENE_RENDERERS['auth.welcome.debug-error']` | Production Content / presenter |
| `auth.welcome.debug-result` | `SCENE_RENDERERS['auth.welcome.debug-result']` | Production Content / presenter |
| `auth.awaiting-ring.with-url` | `SCENE_RENDERERS['auth.awaiting-ring.with-url']` | Production Content / presenter |
| `auth.awaiting-ring.waiting` | `SCENE_RENDERERS['auth.awaiting-ring.waiting']` | Production Content / presenter |
| `auth.awaiting-ring.copied` | `SCENE_RENDERERS['auth.awaiting-ring.copied']` | Production Content / presenter |
| `auth.awaiting-ring.fail` | `SCENE_RENDERERS['auth.awaiting-ring.fail']` | Production Content / presenter |
| `auth.enable.checking` | `SCENE_RENDERERS['auth.enable.checking']` | Production Content / presenter |
| `auth.enable.native-missing` | `SCENE_RENDERERS['auth.enable.native-missing']` | Production Content / presenter |
| `auth.enable.enabled` | `SCENE_RENDERERS['auth.enable.enabled']` | Production Content / presenter |
| `auth.enable.session-offline` | `SCENE_RENDERERS['auth.enable.session-offline']` | Production Content / presenter |
| `auth.enable.authorizing` | `SCENE_RENDERERS['auth.enable.authorizing']` | Production Content / presenter |
| `auth.enable.authorizing-https` | `SCENE_RENDERERS['auth.enable.authorizing-https']` | Production Content / presenter |
| `auth.enable.success` | `SCENE_RENDERERS['auth.enable.success']` | Production Content / presenter |
| `auth.enable.error` | `SCENE_RENDERERS['auth.enable.error']` | Production Content / presenter |
| `tabs.chats.messaging-off` | `SCENE_RENDERERS['tabs.chats.messaging-off']` | Production Content / presenter |
| `tabs.chats.empty` | `SCENE_RENDERERS['tabs.chats.empty']` | Production Content / presenter |
| `tabs.chats.populated` | `SCENE_RENDERERS['tabs.chats.populated']` | Production Content / presenter |
| `tabs.chats.unread-99` | `SCENE_RENDERERS['tabs.chats.unread-99']` | Production Content / presenter |
| `tabs.chats.pending-badge` | `SCENE_RENDERERS['tabs.chats.pending-badge']` | Production Content / presenter |
| `tabs.chats.offline` | `SCENE_RENDERERS['tabs.chats.offline']` | Production Content / presenter |
| `tabs.channels.empty` | `SCENE_RENDERERS['tabs.channels.empty']` | Production Content / presenter |
| `tabs.channels.populated` | `SCENE_RENDERERS['tabs.channels.populated']` | Production Content / presenter |
| `tabs.channels.create-private` | `SCENE_RENDERERS['tabs.channels.create-private']` | Production Content / presenter |
| `tabs.channels.create-public` | `SCENE_RENDERERS['tabs.channels.create-public']` | Production Content / presenter |
| `tabs.channels.join-empty` | `SCENE_RENDERERS['tabs.channels.join-empty']` | Production Content / presenter |
| `tabs.channels.join-invalid` | `SCENE_RENDERERS['tabs.channels.join-invalid']` | Production Content / presenter |
| `tabs.channels.join-busy` | `SCENE_RENDERERS['tabs.channels.join-busy']` | Production Content / presenter |
| `stack.channel.loading` | `SCENE_RENDERERS['stack.channel.loading']` | Production Content / presenter |
| `stack.channel.empty` | `SCENE_RENDERERS['stack.channel.empty']` | Production Content / presenter |
| `stack.channel.populated` | `SCENE_RENDERERS['stack.channel.populated']` | Production Content / presenter |
| `stack.channel.deleted` | `SCENE_RENDERERS['stack.channel.deleted']` | Production Content / presenter |
| `stack.channel.reply` | `SCENE_RENDERERS['stack.channel.reply']` | Production Content / presenter |
| `stack.channel.reactions` | `SCENE_RENDERERS['stack.channel.reactions']` | Production Content / presenter |
| `stack.channel.membership` | `SCENE_RENDERERS['stack.channel.membership']` | Production Content / presenter |
| `stack.channel.composer-hidden` | `SCENE_RENDERERS['stack.channel.composer-hidden']` | Production Content / presenter |
| `stack.channel.public` | `SCENE_RENDERERS['stack.channel.public']` | Production Content / presenter |
| `stack.channel-members.list` | `SCENE_RENDERERS['stack.channel-members.list']` | Production Content / presenter |
| `stack.channel-members.admin-add` | `SCENE_RENDERERS['stack.channel-members.admin-add']` | Production Content / presenter |
| `stack.channel-members.leave` | `SCENE_RENDERERS['stack.channel-members.leave']` | Production Content / presenter |
| `stack.channel-members.left` | `SCENE_RENDERERS['stack.channel-members.left']` | Production Content / presenter |
| `stack.channel-members.public-refresh` | `SCENE_RENDERERS['stack.channel-members.public-refresh']` | Production Content / presenter |
| `tabs.contacts.empty` | `SCENE_RENDERERS['tabs.contacts.empty']` | Production Content / presenter |
| `tabs.contacts.populated` | `SCENE_RENDERERS['tabs.contacts.populated']` | Production Content / presenter |
| `tabs.contacts.syncing` | `SCENE_RENDERERS['tabs.contacts.syncing']` | Production Content / presenter |
| `tabs.contacts.nexus-note` | `SCENE_RENDERERS['tabs.contacts.nexus-note']` | Production Content / presenter |
| `tabs.contacts.offline` | `SCENE_RENDERERS['tabs.contacts.offline']` | Production Content / presenter |
| `stack.contact-search.empty` | `SCENE_RENDERERS['stack.contact-search.empty']` | Production Content / presenter |
| `stack.contact-search.invalid` | `SCENE_RENDERERS['stack.contact-search.invalid']` | Production Content / presenter |
| `stack.contact-search.valid` | `SCENE_RENDERERS['stack.contact-search.valid']` | Production Content / presenter |
| `stack.contact-search.loading` | `SCENE_RENDERERS['stack.contact-search.loading']` | Production Content / presenter |
| `stack.contact-search.not-found` | `SCENE_RENDERERS['stack.contact-search.not-found']` | Production Content / presenter |
| `stack.contact-search.added` | `SCENE_RENDERERS['stack.contact-search.added']` | Production Content / presenter |
| `stack.contact-search.qr` | `SCENE_RENDERERS['stack.contact-search.qr']` | Production Content / presenter |
| `stack.contact-detail.default` | `SCENE_RENDERERS['stack.contact-detail.default']` | Production Content / presenter |
| `tabs.profile.unnamed` | `SCENE_RENDERERS['tabs.profile.unnamed']` | Production Content / presenter |
| `tabs.profile.with-pubky` | `SCENE_RENDERERS['tabs.profile.with-pubky']` | Production Content / presenter |
| `tabs.profile.settings-visible` | `SCENE_RENDERERS['tabs.profile.settings-visible']` | Production Content / presenter |
| `tabs.profile.sign-out` | `SCENE_RENDERERS['tabs.profile.sign-out']` | Production Content / presenter |
| `tabs.profile.debug` | `SCENE_RENDERERS['tabs.profile.debug']` | Production Content / presenter |
| `stack.thread.loading` | `SCENE_RENDERERS['stack.thread.loading']` | Production Content / presenter |
| `stack.thread.empty` | `SCENE_RENDERERS['stack.thread.empty']` | Production Content / presenter |
| `stack.thread.populated` | `SCENE_RENDERERS['stack.thread.populated']` | Production Content / presenter |
| `stack.thread.send-disabled` | `SCENE_RENDERERS['stack.thread.send-disabled']` | Production Content / presenter |
| `stack.thread.sending` | `SCENE_RENDERERS['stack.thread.sending']` | Production Content / presenter |
| `stack.thread.failed` | `SCENE_RENDERERS['stack.thread.failed']` | Production Content / presenter |
| `stack.thread.delivered-read` | `SCENE_RENDERERS['stack.thread.delivered-read']` | Production Content / presenter |
| `stack.thread.messaging-cta` | `SCENE_RENDERERS['stack.thread.messaging-cta']` | Production Content / presenter |
| `stack.thread.payment-pending` | `SCENE_RENDERERS['stack.thread.payment-pending']` | Production Content / presenter |
| `stack.thread.payment-accepted` | `SCENE_RENDERERS['stack.thread.payment-accepted']` | Production Content / presenter |
| `stack.thread.payment-expired` | `SCENE_RENDERERS['stack.thread.payment-expired']` | Production Content / presenter |
| `stack.thread.payment-claimed` | `SCENE_RENDERERS['stack.thread.payment-claimed']` | Production Content / presenter |
| `stack.thread.payment-verified` | `SCENE_RENDERERS['stack.thread.payment-verified']` | Production Content / presenter |
| `stack.thread.attach-uploading` | `SCENE_RENDERERS['stack.thread.attach-uploading']` | Production Content / presenter |
| `stack.thread.attach-failed` | `SCENE_RENDERERS['stack.thread.attach-failed']` | Production Content / presenter |
| `stack.thread.attach-image` | `SCENE_RENDERERS['stack.thread.attach-image']` | Production Content / presenter |
| `stack.thread.attach-backup` | `SCENE_RENDERERS['stack.thread.attach-backup']` | Production Content / presenter |
| `stack.composer.sheet` | `SCENE_RENDERERS['stack.composer.sheet']` | Production Content / presenter |
| `stack.thread.tip-collapsed` | `SCENE_RENDERERS['stack.thread.tip-collapsed']` | Production Content / presenter |
| `stack.thread.tip-empty` | `SCENE_RENDERERS['stack.thread.tip-empty']` | Production Content / presenter |
| `stack.thread.tip-expiry` | `SCENE_RENDERERS['stack.thread.tip-expiry']` | Production Content / presenter |
| `stack.payment.compose-idle` | `SCENE_RENDERERS['stack.payment.compose-idle']` | Production Content / presenter |
| `stack.payment.compose-amount` | `SCENE_RENDERERS['stack.payment.compose-amount']` | Production Content / presenter |
| `stack.payment.compose-reference` | `SCENE_RENDERERS['stack.payment.compose-reference']` | Production Content / presenter |
| `stack.payment.compose-busy` | `SCENE_RENDERERS['stack.payment.compose-busy']` | Production Content / presenter |
| `stack.payment.review` | `SCENE_RENDERERS['stack.payment.review']` | Production Content / presenter |
| `tabs.requests.empty` | `SCENE_RENDERERS['tabs.requests.empty']` | Production Content / presenter |
| `tabs.requests.populated` | `SCENE_RENDERERS['tabs.requests.populated']` | Production Content / presenter |
| `tabs.requests.busy` | `SCENE_RENDERERS['tabs.requests.busy']` | Production Content / presenter |
| `tabs.settings.default` | `SCENE_RENDERERS['tabs.settings.default']` | Production Content / presenter |
| `tabs.settings.mesh-on` | `SCENE_RENDERERS['tabs.settings.mesh-on']` | Production Content / presenter |
| `tabs.settings.telemetry-on` | `SCENE_RENDERERS['tabs.settings.telemetry-on']` | Production Content / presenter |
| `tabs.settings.backup-busy` | `SCENE_RENDERERS['tabs.settings.backup-busy']` | Production Content / presenter |
| `tabs.settings.recovery-shown` | `SCENE_RENDERERS['tabs.settings.recovery-shown']` | Production Content / presenter |
| `tabs.settings.restore-ok` | `SCENE_RENDERERS['tabs.settings.restore-ok']` | Production Content / presenter |
| `tabs.settings.restore-err` | `SCENE_RENDERERS['tabs.settings.restore-err']` | Production Content / presenter |
| `tabs.settings.enable-row` | `SCENE_RENDERERS['tabs.settings.enable-row']` | Production Content / presenter |
| `tabs.settings.liveproof-idle` | `SCENE_RENDERERS['tabs.settings.liveproof-idle']` | Production Content / presenter |
| `tabs.settings.liveproof-running` | `SCENE_RENDERERS['tabs.settings.liveproof-running']` | Production Content / presenter |
| `tabs.settings.liveproof-ok` | `SCENE_RENDERERS['tabs.settings.liveproof-ok']` | Production Content / presenter |
| `tabs.settings.liveproof-fail` | `SCENE_RENDERERS['tabs.settings.liveproof-fail']` | Production Content / presenter |
| `overlay.attach.alert` | `SCENE_RENDERERS['overlay.attach.alert']` | Production Content / presenter |
| `overlay.permission.alert` | `SCENE_RENDERERS['overlay.permission.alert']` | Production Content / presenter |
| `overlay.wallet.alert` | `SCENE_RENDERERS['overlay.wallet.alert']` | Production Content / presenter |
| `overlay.e2e-hud.success` | `SCENE_RENDERERS['overlay.e2e-hud.success']` | Production Content / presenter |
| `overlay.e2e-hud.error` | `SCENE_RENDERERS['overlay.e2e-hud.error']` | Production Content / presenter |
| `overlay.sign-out.alert` | `SCENE_RENDERERS['overlay.sign-out.alert']` | Production Content / presenter |
| `chrome.tab-bar.focused` | `SCENE_RENDERERS['chrome.tab-bar.focused']` | Production Content / presenter |
| `chrome.tab-bar.unfocused` | `SCENE_RENDERERS['chrome.tab-bar.unfocused']` | Production Content / presenter |
| `a11y.font-scale.two` | `SCENE_RENDERERS['a11y.font-scale.two']` | Production Content / presenter |
| `tabs.contacts.content-empty` | `SCENE_RENDERERS['tabs.contacts.content-empty']` | Production Content / presenter |
| `tabs.contacts.content-populated` | `SCENE_RENDERERS['tabs.contacts.content-populated']` | Production Content / presenter |
| `tabs.contacts.content-offline` | `SCENE_RENDERERS['tabs.contacts.content-offline']` | Production Content / presenter |
| `tabs.message-requests.empty` | `SCENE_RENDERERS['tabs.message-requests.empty']` | Production Content / presenter |
| `tabs.message-requests.populated` | `SCENE_RENDERERS['tabs.message-requests.populated']` | Production Content / presenter |
| `tabs.settings.recovery-gate` | `SCENE_RENDERERS['tabs.settings.recovery-gate']` | Production Content / presenter |

## Uncovered / skipped

| Item | Reason |
|---|---|
| Track A visual polish | Deferred until Content-backed baselines are re-captured and integrity-gated |
| Channel member admin edge cases beyond catalog rows | Covered by stack.channel-members.* rows where present; remaining P2 polish skipped |
| Live proof network round-trip | VRT mounts idle/running/ok/fail UI states only — no live homeserver |
| Real Ring authorization | Uses fixture auth URLs; QR/auth URL masked |

