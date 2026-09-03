# VRT matrix coverage

Generated against `docs/ux/vrt-state-matrix.md`. Scene catalog: 117 ids × 4 captures.

| Matrix cell | Scene id | Notes |
|---|---|---|
| App splash | `bootstrap.app-splash.loading` | Production splash markup (ActivityIndicator on canvas) |
| Linking fallback | `bootstrap.linking-fallback.loading` | Same spinner as App fallback |
| Welcome idle / loading / error | `auth.welcome.*` | `WelcomeScreenContent` |
| Welcome __DEV__ debug | `auth.welcome.debug-*` | Presenter + debug slot |
| AwaitingRing URL / waiting / copied / fail | `auth.awaiting-ring.*` | `AwaitingRingAuthScreenContent` |
| EnableMessaging phases | `auth.enable.*` | `EnableMessagingScreenContent`; `enabled` maps to success (controller) |
| Chats states | `tabs.chats.*` | `ChatsScreenContent` |
| Channels list + modals | `tabs.channels.*` | `ChannelsScreenContent` |
| Channel chat | `stack.channel.*` | `ChannelScreenContent` |
| Channel members | `stack.channel-members.*` | same presenter `showMembers` |
| Contacts | `tabs.contacts.*` | `ContactsScreenContent` |
| ContactSearch | `stack.contact-search.*` | `ContactSearchView` |
| ContactDetail | `stack.contact-detail.default` | `ContactDetailView` |
| Profile | `tabs.profile.*` | `ProfileScreenContent` |
| Thread | `stack.thread.*` | `ThreadScreenContent` |
| Composer sheet | `stack.composer.sheet` | `ComposerActionMenu` on Thread |
| PaymentComposeSheet | `stack.payment.compose-*` | production sheet |
| PaymentReviewSheet | `stack.payment.review` | production sheet |
| MessageRequests | `tabs.requests.*` | `MessageRequestsContent` |
| Settings | `tabs.settings.*` | `SettingsScreenContent` |
| Attach / permission / wallet / HUD / sign-out | `overlay.*` | Composer menu, review walletUnavailable, `E2eSignupHud`, SignOutSheet |
| Tab bar focused/unfocused | `chrome.tab-bar.*` | `MainTabBarIcon` |
| Font scale 2.0 | `a11y.font-scale.two` | Welcome presenter; scale asserted in Jest |
| Token swatch | `design-system.token-swatch.default` | |

Uncovered / waived:

- Native `Alert.alert` permission / attach system sheets: no presentational tree (RN Alert). Host copy captured in `overlay.permission.alert`.
- Discover screen: inventory says omit until it exists.
- Live-proof running/ok/fail: `__DEV__` panel talks to native proof; VRT mounts the slot without tokens.
- ContactSearch “QR fallback card”: product has no separate QR card component; empty search is the current surface.

## Integrity duplicate waivers

`vrt/integrityGate.ts` only accepts duplicate captures when the exact scene-id pair is listed in `vrt/integrityWaivers.ts`; the allowlist does not change the 99% threshold. Current waived groups:

| Group | Scene ids | Reason |
|---|---|---|
| Loading fallbacks | `bootstrap.app-splash.loading`, `bootstrap.linking-fallback.loading` | Same centered activity indicator. |
| Auth aliases | `auth.enable.enabled`, `auth.enable.success`; `auth.welcome.debug-empty`, `auth.welcome.debug-result` | Controller/debug states intentionally share presenter output. |
| Ring copied alias | `auth.awaiting-ring.copied`, `auth.awaiting-ring.with-url` | Copied is a transient acknowledgement on the same Ring-auth URL surface; the only expected visual delta is the copy control state. |
| Shared sheets | `overlay.sign-out.alert`, `tabs.profile.sign-out`; `overlay.wallet.alert`, `stack.payment.review` | Matrix rows exercise the same sheet surface before interaction. |
| Member sheet aliases | `stack.channel-members.leave`, `stack.channel-members.list` | Matrix rows exercise the same members sheet before interaction. |
| Search aliases | `stack.contact-search.added`, `stack.contact-search.valid`; `stack.contact-search.empty`, `stack.contact-search.qr` | Product has no distinct added/QR fallback visual in this wave. |
| Payment/thread aliases | `stack.payment.compose-busy`, `stack.payment.compose-idle`; `stack.thread.delivered-read`, `stack.thread.populated`, `stack.thread.send-disabled`, `stack.thread.tip-collapsed`; `stack.thread.payment-claimed`, `stack.thread.payment-verified` | Accessibility or record-status differences have no distinct visible screenshot surface. |
| Channels join aliases | `tabs.channels.join-busy`, `tabs.channels.join-empty`, `tabs.channels.join-invalid` | Empty/invalid/busy join sheet states are visually identical without a valid public channel reference. |
| HEAD matrix aliases | `tabs.contacts.content-*` with matching `tabs.contacts.*`; `tabs.message-requests.*` with matching `tabs.requests.*`; `tabs.profile.settings-visible`, `tabs.profile.with-pubky` | Duplicate matrix names retained for coverage traceability. |

No waivers are allowed for `a11y.font-scale.two`, `tabs.settings.*` scroll states,
or `stack.channel.*` message states. Those scenes must render visibly distinct
content in captured baselines; identical output is treated as a gate failure.
