# Environment configuration

Move Atlas uses environment variables only for application-owner configuration. Users must never be asked to supply a key or token. Store production values in Vercel and local development values in `.env.local`; never commit either.

Copy `.env.example` to `.env.local` for local development. The committed example intentionally contains invalid placeholders.

## Required for production

| Variable | Browser-visible | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Canonical HTTPS origin, with no path, query, or fragment |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable/anon key; authorization still depends on RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Protected administrative operations, rate limiting, and provider cache |
| `NEXT_PUBLIC_HERE_MAPS_API_KEY` | Yes | HERE Maps for JavaScript key, restricted to approved web origins |
| `HERE_SERVER_API_KEY` | No | HERE geocoding, search, and routing from server code |
| `NWS_USER_AGENT` | No | Descriptive application identifier and monitored contact for NWS requests |
| `CENSUS_API_KEY` | No | Operator-managed Census API key for dependable ACS request limits |
| `CRON_SECRET` | No | Random 24+ character secret used by Vercel to authorize the daily cache/rate-limit cleanup |

Use separate HERE applications/keys for the browser and server. Never reuse the server key in a variable beginning with `NEXT_PUBLIC_`.

## Reserved optional values

| Variable | Current behavior |
| --- | --- |
| `BLS_API_KEY` | Reserved; no BLS adapter is active |
| `OPENAI_API_KEY` | Reserved; the current assistant remains the deterministic Planning assistant |
| `SENTRY_DSN` | Reserved; no monitoring adapter is active |

Setting a reserved value does not activate an integration. Do not present one as live until a typed adapter, disclosure, filtering, failure handling, and tests exist.

## Local example

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

NEXT_PUBLIC_HERE_MAPS_API_KEY=YOUR_LOCAL_DOMAIN_RESTRICTED_BROWSER_KEY
HERE_SERVER_API_KEY=YOUR_PRIVATE_SERVER_KEY

NWS_USER_AGENT=MoveAtlas/1.0 (support@your-real-domain.com)
CENSUS_API_KEY=YOUR_CENSUS_KEY
CRON_SECRET=GENERATE_A_RANDOM_VALUE_WITH_AT_LEAST_24_CHARACTERS
```

`NEXT_PUBLIC_APP_URL=http://localhost:3000` is appropriate for local development. `pnpm env:check` intentionally validates a production release and therefore requires an HTTPS public origin.

## Vercel scope

Add all required values to the Vercel **Production** environment. Add separate Preview values only if preview deployments are expected to exercise accounts and provider integrations.

Do not put production secrets in Development or Preview unless those environments are access-controlled. Prefer a separate non-production Supabase project and separate HERE credentials for previews.

After changing any `NEXT_PUBLIC_` value, redeploy. Next.js embeds public values into the client build. Rotating a server-only value also requires a redeploy or function restart before all invocations reliably use it.

## Validation

Run:

```sh
pnpm env:check
```

Validation fails on missing, too-short, obvious placeholder, or non-HTTPS production values. The Vercel build command runs this check before `next build`.

The application code retains graceful unavailable states so that local static and UI work can run without every provider. That behavior is not permission to promote an unconfigured build. `/api/health` returns `503` if required production configuration is absent or the database is unreachable.

## Secret handling

- Never prefix a private key with `NEXT_PUBLIC_`.
- Never print environment objects, provider request URLs containing a key, authorization headers, Supabase service-role values, or raw provider payloads to logs.
- Do not include environment values in exports, client storage, support screenshots, issue reports, or seeded data.
- Restrict the HERE browser key by exact origin and product permissions.
- Rotate a key immediately if it appears in a browser bundle, Git history, logs, or an unauthorized system.
- Treat `.env.local`, Vercel environment exports, Supabase service-role keys, and HERE server keys as secrets.

See [Provider configuration](PROVIDERS.md) for service-specific setup and [Rollback](ROLLBACK.md) for credential-rotation steps.
