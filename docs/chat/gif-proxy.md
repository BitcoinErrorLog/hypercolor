# GIF proxy contract (mobile + web)

GIFs are **not** a wire kind. The client searches and fetches bytes through
Hypercolor's Vercel proxy, then sends `chat.attachment.v0` (`image/gif`) on the
existing encrypted attachment path (8 MiB cap). The provider key never ships in
the app. No client IP is sent to Tenor.

Base: `https://hypercolor.app/api/gif`

## Search — `GET /api/gif/search`

Query:

| Param   | Type   | Notes                          |
| ------- | ------ | ------------------------------ |
| `q`     | string | Search text; trim; required    |
| `limit` | int    | 1–24, default 12               |

Success `200` JSON:

```json
{
  "results": [
    {
      "id": "tenor-id",
      "preview": { "url": "https://…", "w": 220, "h": 124 },
      "gif": { "url": "https://…", "w": 480, "h": 270, "bytes": 420000 }
    }
  ]
}
```

`preview.url` and `gif.url` are **signed proxy URLs** on `https://hypercolor.app/api/gif/fetch?id=<id>&kind=<preview|gif>&token=<hmac-token>`, never raw Tenor CDN URLs. `bytes` is optional when upstream omits size; the client and server both enforce the 8 MiB attachment cap on the fetched body.

## Fetch: `GET /api/gif/fetch?id=<id>&kind=<gif|preview>&token=<token>`

Statelessly verifies the short-TTL HMAC-SHA256 `token` bound to `id`, `kind`, and the allowlisted Tenor URL (`403` when missing, invalid, or expired). Returns GIF bytes with `Content-Type: image/gif`, `Content-Length`, and `X-Content-Type-Options: nosniff`. Body larger than 8 MiB returns `413`; upstream rate limits return `429`; upstream failures return `502`. Clients send `redirect: 'error'` and never follow off-origin redirects.

## Not configured — `503`

When `TENOR_API_KEY` (or equivalent) is missing:

```json
{ "error": "not configured" }
```

Clients MUST show a real empty state: **GIF search not configured**. Do not
fall back to a third-party host from the device.
