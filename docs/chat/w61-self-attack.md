# W6.1 self-attack table (mobile)

| Attack | Expected | Gate |
| --- | --- | --- |
| Markdown `[click](javascript:alert(1))` | Rendered as plain text; no `onPress` link | `sanitizeHref` allows `https:` only; parser keeps original markdown as text |
| Markdown `https://user:pass@host` | Rejected | `URL.username` / `password` check |
| Oversized GIF (`bytes` > 8 MiB in search, or 413 / body > 8 MiB) | Not listed / not sent | `GifProxyClient` Content-Length pre-check + bounded stream; advertised oversize drop; `AttachmentService` 8 MiB |
| Non-proxy preview/gif URL | Dropped from results | Origin must be `https://hypercolor.app` |
| Non-GIF magic on fetch | Error; not attached | GIF87a/GIF89a sniff + `image/gif` content-type |
| Nickname equal to another contact's display name | Title is nickname; subtitle is always `shortPubky` | `peerIdentity` nickname branch |
| Display name with bidi override | Stripped before persist/initials | `sanitizeDisplayName` |
| Search across owners | No rows | `searchDecryptedMessages` always `WHERE owner_pubky = ?` |
| GIF 503 not configured | Dedicated empty state | `COPY.gifNotConfigured` |
| GIF staged outside sandbox | Never | `gifStagingPath` under `FileSystem.cacheDirectory`; `deleteAsync` in `finally` |
| Edit leaves old `body_search` | Search matches new body only | `applyGroupMessageEdit` writes `normalizeSearchText`; tombstone clears `body_search` |
| Hostile proxy omits Content-Length and streams past 8 MiB | Fetch `too-large`; no unbounded `arrayBuffer` | Bounded `getReader` abort |
