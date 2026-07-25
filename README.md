# Move Atlas

Move Atlas is a private, all-in-one moving workspace for planning a move, comparing areas, saving homes and rentals, managing a budget, routing a moving vehicle, packing, changing an address, and settling in.

This repository contains the production application, not the earlier single-file prototype. The approved Move Atlas visual system and workflow are preserved in a Next.js application with server-protected integrations and Supabase-backed user data. The original interface is retained at `legacy/move-atlas-prototype.html` only as a design and migration reference; it is not the production runtime.

## What is connected

| Capability | Production source | Behavior when not configured or unsupported |
| --- | --- | --- |
| Accounts and user data | Supabase Auth and PostgreSQL | Account and protected workspace routes return an unavailable state |
| Map, geocoding, places, and routes | HERE Maps, Geocoding and Search v7, and Routing API v8 | No route or place result is invented |
| Moving-truck routing | HERE Routing API v8 truck parameters and notices | Missing restriction coverage requires manual verification; the app never guarantees a route |
| U.S. route weather and alerts | National Weather Service API | Weather remains unavailable outside NWS coverage or during a provider outage |
| U.S. area evidence | U.S. Census Bureau ACS 5-year API | Unsupported metrics are omitted from the score and shown as unavailable |
| Fuel cost | Route distance plus user-entered efficiency and price assumptions | Values remain labeled estimates; there is no live station-price claim |
| Planning assistant | Deterministic, local planning assistant | It is not labeled AI and does not claim access to live facts |
| Demo workspace | Curated sample data | Always labeled sample and isolated from authenticated user records |

There is currently no authorized property-listing inventory, Zillow integration, live fuel-price provider, BLS/FEMA/EPA/NCES/FHFA/FBI adapter, OpenAI assistant endpoint, or monitoring adapter in the application. Corresponding information must remain unavailable until a lawful provider adapter is implemented and configured. No website scraping is used.

## Architecture

- Next.js 16, React 19, TypeScript, and the App Router
- Server Route Handlers for authenticated mutations and provider calls
- Supabase Auth, PostgreSQL, Row Level Security, and server-only administrative operations
- Typed provider adapters with Zod validation, timeouts, bounded retries, structured unavailable states, and server-side caching
- HERE browser map key separated from the private HERE server routing key
- Vercel-compatible build and runtime configuration
- Vitest unit tests and Playwright end-to-end test support

The browser receives only public credentials intended for browser use. Private provider credentials and the Supabase service-role key remain in server environment variables.

## Local setup

Prerequisites:

- Node.js 20.9 or newer
- pnpm
- A Supabase project
- Two separate HERE credentials: a domain-restricted browser map key and a private server key
- A U.S. Census API key
- A valid application identifier and contact address for the NWS `User-Agent`

Install dependencies:

```sh
pnpm install --frozen-lockfile
```

Create the local environment file:

```sh
cp .env.example .env.local
```

Replace every placeholder in `.env.local`. Do not commit that file. See [Environment configuration](docs/ENVIRONMENT.md) and [Provider configuration](docs/PROVIDERS.md).

Apply the database migrations in filename order and load the curated demo seed:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --include-seed
```

Alternatively, apply the SQL files from `supabase/migrations` in order and then `supabase/seed.sql` through the Supabase SQL editor. Configure the Supabase authentication URLs before testing email confirmation or password reset.

Start the application:

```sh
pnpm dev
```

Open `http://localhost:3000`. The health endpoint is available at `http://localhost:3000/api/health`; it returns HTTP `503` until required production configuration and the database are available.

## Quality checks

Run the complete local verification sequence:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Or run the non-E2E checks together:

```sh
pnpm check
```

The production E2E journey is deliberately credential-gated because it creates a
real Supabase account and exercises HERE, NWS, Census, persistence, and the
sanitized export. It skips instead of substituting mock services when the live
environment is absent. Run it against an already deployed application:

```sh
E2E_RUN_LIVE=true \
E2E_BASE_URL=https://your-production-domain.example \
E2E_EMAIL_DOMAIN=your-controlled-test-domain.example \
E2E_TEST_PASSWORD='a-secure-test-password' \
E2E_SUPABASE_AUTO_CONFIRM=true \
pnpm test:e2e
```

Use a dedicated test project or controlled test-email domain, provide the values
through protected CI secrets, and enable automatic email confirmation only for
that controlled test environment. When `E2E_BASE_URL` is omitted, Playwright
starts the local app and uses the provider and Supabase values in `.env.local`.
Install the Chromium test browser once with
`pnpm exec playwright install chromium`.

Validate release environment values before deploying:

```sh
pnpm env:check
```

The environment check rejects empty, example, and obvious placeholder values. `vercel.json` runs this check before the production build.

## Database and privacy model

The SQL in `supabase/migrations` creates user-owned profiles and move plans plus structured records for setup, tasks, area research, homes and rentals, career opportunities, budgets, packing, mover quotes, utilities, address changes, document checklist metadata, routes, weather, assistant conversations, and settling-in tasks.

Important boundaries:

- Row Level Security is enabled and forced on application tables.
- User-owned children carry composite user and move-plan ownership.
- Provider-derived rows are readable by their owner but writable only through protected server operations.
- Provider cache and rate-limit tables are service-only.
- Account deletion uses the protected Supabase Admin API and cascades owned application records.
- Export uses an allowlist and must not include credentials, secrets, document contents, or private provider payloads.
- Document Center stores checklist metadata only; it does not upload document files.
- Legacy browser data is sanitized before one-time import. Passwords, prototype provider keys, mock route/weather results, and fake official area evidence are excluded.

See [the database guide](supabase/README.md) for the schema and RPC contracts.

## Deployment

The supported release target is Vercel with Supabase:

1. Create and migrate the production Supabase project.
2. Import this GitHub repository into Vercel.
3. Add the required environment values to the Production environment.
4. Add the exact production origin to Supabase Auth redirect URLs.
5. Restrict the HERE browser key to the exact production origin.
6. Deploy, then verify `/api/health`, account persistence, route rendering, weather, area evidence, export, and account deletion.

Full instructions are in [Deployment](docs/DEPLOYMENT.md). Use the [launch-readiness checklist](docs/LAUNCH_CHECKLIST.md) before promoting a release and [rollback notes](docs/ROLLBACK.md) before applying database changes.

A Git commit, GitHub branch, or successful local build is not evidence of a live production deployment. Record and share a production URL only after Vercel reports the deployment ready and the post-deploy checks pass.

## Operations

`GET /api/health` is a readiness check. It verifies that required environment values are non-placeholder values and that the application can query the migrated Supabase database. It does not call HERE, NWS, Census, or another metered provider. The response contains no credentials or raw provider errors:

- HTTP `200` with `status: "healthy"` means configuration validation and the database check passed.
- HTTP `503` with `status: "degraded"` means the release should not receive production traffic.

Provider outages are handled independently in product surfaces with source, freshness, stale-data, retry, and unavailable states. A healthy readiness response is not a guarantee that every third-party provider is currently available.

## Repository map

```text
src/app/                  App Router pages and protected API routes
src/components/           Move Atlas interface and interactive tools
src/lib/domain/           Deterministic calculations and safety logic
src/lib/providers/        Typed external-provider adapters
src/lib/services/         Route-weather and area-evidence orchestration
src/lib/supabase/         Browser, server, admin, and session clients
supabase/migrations/      Ordered production database migrations
supabase/seed.sql         Curated sample/template data only
tests/                    Unit and end-to-end tests
docs/                     Deployment, provider, rollback, and launch runbooks
legacy/                   Preserved single-file prototype reference
```

## Product and safety limits

Move Atlas provides planning support, not a guarantee that a route is safe, open, or legal for a particular vehicle. Users must verify critical clearance, weight, closure, weather, and commercial-vehicle restrictions with official transportation agencies, posted road signs, rental-company guidance, and appropriate commercial-routing tools.

Reported statistics describe their published geography and period; they do not predict individual safety or property conditions. ACS estimates are not current listings or appraisals. NWS forecasts can change. Fuel costs are estimates unless a licensed price provider is explicitly integrated and identified.

The application includes dedicated Privacy, Terms, Safety, and Support pages. Review their operator name, contact details, jurisdiction, and business policies with qualified counsel before a commercial launch.
