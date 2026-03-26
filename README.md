# URL Shortener

A fast, production-ready URL shortener built with **Node.js**, **Express**, **Supabase (PostgreSQL)**, and **Redis**.

Live demo: [sepehrtabaee.com/tinyurl](https://sepehrtabaee.com/tinyurl)

---

## Features

- Shorten any valid URL to a 6-character code
- Automatic 14-day expiration with custom override
- Redis caching for sub-millisecond redirects
- Redis-backed rate limiting to prevent abuse
- Click logging (IP + user agent) on every redirect
- Graceful handling of missing, inactive, or expired links

---

## How URL Shortening Works

### Code Generation — Base62 with Timestamp + Random Bits

Each short code is **6 characters** drawn from a Base62 alphabet:

```
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
```

**Why Base62?**
62 characters means `62^6 = 56,800,235,584` — over **56 billion** unique codes from just 6 characters. That's far more than enough for any realistic workload.

**Bit layout (34 bits packed into 6 Base62 chars):**

| Bits    | Purpose                                          |
|---------|--------------------------------------------------|
| 33 → 4  | 30-bit seconds since 2024-01-01 (~34 years range)|
| 3 → 0   | 4 random bits (16 slots per second)              |

```js
const tsSeconds  = Math.floor((Date.now() - EPOCH_MS) / 1000);
const randomBits = Math.floor(Math.random() * (1 << 4));
const combined   = (tsSeconds << 4) | randomBits;
return toBase62(combined); // e.g. "aB3kT2"
```

The timestamp component makes every code naturally time-ordered and unique by second, while the 4 random bits handle bursts of up to 16 requests per second without collision. In the rare case of a collision, the service retries up to 5 times before failing.

---

## Redis Caching

Every URL lookup follows a **cache-aside** pattern to avoid hitting the database on hot paths:

1. **Cache hit** — return the cached record immediately (TTL: 1 hour)
2. **Cache miss** — query Supabase, write the result to Redis, then respond
3. **On deactivation** — the cache entry is explicitly invalidated

```
Client → Redis (hit?) → Yes: redirect instantly
                      → No:  Supabase → write to Redis → redirect
```

Cache keys are namespaced as `url:<short_code>` and store `long_url`, `is_active`, and `expiration_date`.

---

## Security

### Rate Limiting (Redis-backed)

All endpoints are protected by a sliding-window rate limiter:

- **Window:** 15 minutes
- **Limit:** 100 requests per IP per window
- **Storage:** Redis (distributed — works correctly across multiple server instances)

The limiter uses [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit) with [`rate-limit-redis`](https://github.com/express-rate-limit/rate-limit-redis) as the backing store, so rate limit counters are shared across all processes and survive restarts.

### CORS

Only requests from `Website_URL` are permitted via CORS headers.

### JWT Verification (Recommended for Production)

Currently the API is open — any caller can create or deactivate short URLs. In a production multi-tenant environment you should add JWT middleware to protect the `POST /api/urls` and `DELETE /api/urls/:code` routes, verifying that the caller owns the resource before allowing mutations.

---

## Error Handling

| Scenario                          | Behavior                                                   |
|-----------------------------------|------------------------------------------------------------|
| Short code not found in DB        | Redirect to `/tinyurl?r=n&c=<code>` (not found page)      |
| URL is inactive (`is_active=false`)| Redirect to `/tinyurl?r=n&c=<code>` (not found page)     |
| URL has passed its expiration date | Redirect to `/tinyurl?r=e&c=<code>` (expired page)       |
| Invalid `long_url` in request     | `400 Bad Request`                                          |
| Code collision after 5 retries    | `500 Internal Server Error`                                |

---

## Database Schema

### `short_urls`

```sql
CREATE TABLE short_urls (
    id              BIGSERIAL PRIMARY KEY,
    long_url        TEXT         NOT NULL,
    short_code      VARCHAR(16)  NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expiration_date TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '14 days',
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Expiration must be in the future relative to creation
ALTER TABLE short_urls
ADD CONSTRAINT chk_expiration_future
CHECK (expiration_date IS NULL OR expiration_date > created_at);

-- Primary lookup index
CREATE UNIQUE INDEX idx_urls_short_code ON short_urls(short_code);

-- Optimized index for active, non-expired lookups
CREATE INDEX idx_urls_active_valid
ON short_urls(short_code)
WHERE is_active = TRUE;

-- Index for expiration cleanup queries
CREATE INDEX idx_urls_expiration_date ON short_urls(expiration_date);
```

### `url_clicks`

```sql
CREATE TABLE url_clicks (
    id         BIGSERIAL PRIMARY KEY,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);
```

Click logging is **non-blocking** — it fires asynchronously after the redirect is sent so it never adds latency to the user-facing response.

---

## API

| Method   | Path                | Description                        |
|----------|---------------------|------------------------------------|
| `GET`    | `/`                 | Health check                       |
| `GET`    | `/:code`            | Redirect to the original URL       |
| `POST`   | `/api/urls`         | Create a new short URL             |
| `GET`    | `/api/urls/:code`   | Fetch URL record (no redirect)     |
| `DELETE` | `/api/urls/:code`   | Deactivate a short URL             |

### POST `/api/urls`

**Request body:**
```json
{
  "long_url": "https://example.com/some/very/long/path",
  "expiration_date": "2026-12-31T00:00:00Z"  // optional
}
```

**Response `201`:**
```json
{
  "id": 42,
  "short_code": "aB3kT2",
  "short_url": "https://your-domain.com/aB3kT2",
  "long_url": "https://example.com/some/very/long/path",
  "expiration_date": "2026-12-31T00:00:00Z",
  "created_at": "2026-03-25T10:00:00Z"
}
```

---

## Potential Improvements

- **Expiration cleanup cron job** — add a scheduled job that soft-deletes (sets `is_active = false`) all rows where `expiration_date < NOW()`. The `idx_urls_expiration_date` index is already in place to make this query fast. This prevents stale rows from accumulating and keeps the active-index lean.
- **JWT authentication** — protect write endpoints so only authenticated users can create or revoke links.
- **Custom aliases** — allow users to specify their own short code instead of a generated one.
- **Analytics dashboard** — surface click counts, referrers, and geography from the `url_clicks` table.

---

## Environment Variables

| Variable         | Description                        |
|------------------|------------------------------------|
| `REDIS_HOST`     | Redis server hostname              |
| `REDIS_PASSWORD` | Redis authentication password      |
| `SUPABASE_URL`   | Supabase project URL               |
| `SUPABASE_KEY`   | Supabase service role key          |
| `BASE_URL`       | Public base URL for short links    |
| `WEBSITE_URL`    | Frontend URL for error redirects   |
| `PORT`           | Server port (default: 3000)        |
