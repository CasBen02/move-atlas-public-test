# Deployment

Move Atlas is designed for Vercel with a Supabase production project. Deploy the Next.js application and database as one controlled release; do not expose the app to testers before authentication, migrations, provider restrictions, and the post-deploy checks pass.

## 1. Prepare production services

Create:

- a production Supabase project,
- a HERE browser credential restricted to the final web origin,
- a separate HERE server credential with Geocoding/Search and Routing access,
- a U.S. Census API key,
- a monitored support address for the NWS User-Agent,
- a Vercel project connected to this repository.

Decide the final HTTPS origin before configuring authentication and browser-key restrictions.

## 2. Back up and migrate Supabase

For a new database, apply all migrations and the seed:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --include-seed
```

For an existing database:

1. Review the migration diff.
2. Capture a restorable backup or confirm the project’s point-in-time recovery window.
3. Apply migrations in a staging project first.
4. Run account isolation, import, export, and deletion tests.
5. Apply the same migration set to production.

Do not edit an already-applied migration. Add a new forward migration.

## 3. Configure Supabase Auth

In Supabase Auth URL Configuration:

- set Site URL to `https://YOUR_PRODUCTION_ORIGIN`,
- allow the exact production callback URL,
- allow `http://localhost:3000/auth/callback` only for development,
- add only controlled preview callback URLs,
- remove obsolete deployment URLs after cutover.

Configure a real SMTP sender, sender domain, reply-to/support address, confirmation policy, and password-reset templates. Exercise confirmation and reset links in the production domain before inviting testers.

## 4. Configure Vercel

Import the GitHub repository with:

- Framework Preset: Next.js
- Root Directory: repository root
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: inherited from `vercel.json`

Add every required variable from [Environment configuration](ENVIRONMENT.md) to the Production scope. Use separate non-production credentials for Preview if preview provider access is enabled.

`vercel.json` runs `pnpm env:check` before `pnpm build`; placeholder or incomplete production configuration fails the deployment.
It also registers one daily production cron invocation for
`/api/maintenance/cleanup`. Vercel sends `CRON_SECRET` as a bearer credential;
confirm the cron is registered and its latest invocation succeeds after deploy.

## 5. Restrict HERE

After Vercel assigns the final domain:

1. add the exact HTTPS origin to the browser key allowlist,
2. remove broad wildcards not needed for previews,
3. confirm the browser key cannot call unnecessary products,
4. confirm `HERE_SERVER_API_KEY` is available only to server functions,
5. redeploy after changing `NEXT_PUBLIC_HERE_MAPS_API_KEY`.

Use the browser network inspector to confirm the private server key never appears in JavaScript, HTML, map requests, errors, or API responses.

## 6. Deploy

Deploy from the intended release commit. Wait for Vercel to report Ready; a successful Git push alone is not a deployment.

Check:

```text
https://YOUR_PRODUCTION_ORIGIN/api/health
```

Do not send traffic if it returns `503`.

## 7. Post-deploy smoke test

Using a fresh email address and a private/incognito browser:

1. Create an account and complete email confirmation if enabled.
2. Complete guided setup and create a move.
3. Sign out, use another browser session, sign back in, and confirm persistence.
4. Create and switch between two move plans.
5. Add an area and inspect source, geography, reference period, freshness, coverage, missing measures, and score denominator.
6. Add an apartment, condo, townhome, or house manually.
7. Enter verified vehicle dimensions, request a route, view actual geometry, and inspect restriction coverage wording.
8. View route weather and an official alert when one legitimately affects the route.
9. Add a budget item and packing box.
10. Export the account and inspect the JSON for secrets or disallowed data.
11. Test password reset.
12. Delete a disposable account and verify its application records are gone.
13. Open the curated demo and confirm every operational value is clearly sample data.
14. Test desktop, narrow mobile, keyboard-only navigation, reduced motion, and an unavailable-provider state.

Repeat critical isolation checks with two accounts. A record identifier copied from one account must not be readable or writable by the other.

## 8. Promote

Complete [Launch readiness](LAUNCH_CHECKLIST.md), record:

- release commit,
- Vercel deployment ID and production URL,
- migration filenames applied,
- backup or recovery checkpoint,
- provider credential owners and rotation dates,
- successful check/test output,
- known unavailable capabilities.

Only then share the production URL.

## Maintenance

- Review `/api/health` for release readiness; monitor provider availability separately.
- Review the protected daily cleanup invocation and investigate repeated failures.
- Rotate credentials on a documented schedule and after any suspected exposure.
- Review provider terms, API versions, NWS guidance, and Census dataset availability before upgrades.
- Apply dependency security updates through a tested branch and repeat the launch checklist.
- Preserve stale/unavailable labels during provider incidents; never backfill with sample facts.
