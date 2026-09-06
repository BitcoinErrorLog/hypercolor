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

`preview.url` and `gif.url` are **proxy URLs** (same origin), never a raw
Tenor CDN URL. `bytes` is the advertised GIF size; the client still enforces
the 8 MiB attachment cap on the fetched body.

## Fetch — `GET /api/gif/fetch?id=`

Returns the GIF **bytes** with `Content-Type: image/gif` (or the sniffed type).
Rejects ids that were not produced by search. Body larger than 8 MiB → `413`.

## Not configured — `503`

When `TENOR_API_KEY` (or equivalent) is missing:

```json
{ "error": "not configured" }
```

Clients MUST show a real empty state: **GIF search not configured**. Do not
fall back to a third-party host from the device.
