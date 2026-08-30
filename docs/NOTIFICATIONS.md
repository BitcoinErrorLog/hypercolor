# Notifications (v1)

## What ships

v1 inbox freshness is **foreground-only**:

- `App.tsx` starts `LinkService.startLinkRetryDrain()` after keystore init and
  again whenever `AppState` becomes `'active'`. The drain stops when the app
  leaves the foreground.
- The same `'active'` / launch path runs `recoverPendingSends`, `drainRetries`,
  and `syncInbox` (when an Encrypted-Link session exists).
- `ChatsScreen` and `ThreadScreen` call `syncInbox` on focus and refresh from
  `LinkService.subscribeInboxSynced`.

There is no background fetch on iOS or Android, and no push pipeline.

## What is not implemented

**Background fetch** is not registered on either platform. A process that is
suspended or killed will not drain the Paykit inbox until the user opens the
app again.

**Push** is future work. A privacy-preserving design would be an **opt-in,
content-free waker**: a server (or homeserver-adjacent service) that knows
only “this device has something new,” never message bodies, senders, or
attachment metadata. The tradeoff is an extra network identity that can
correlate wake-ups with account activity. Until that exists, the product
does not request notification permission for chat.

## Why this is the v1 line

Encrypted Links already persist send intent and retry in `delivery_queue`.
Foreground drain plus focus refresh is enough to complete the nonce-safe
pipeline while the app is in use. Background and push would require native
work (`ios/**` / `android/**`) that this TypeScript wave does not take.
