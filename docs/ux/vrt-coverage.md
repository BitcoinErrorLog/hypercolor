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
