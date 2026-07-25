# Launch-readiness checklist

Do not mark an item complete from source inspection alone. Keep command output, deployment IDs, provider configuration screenshots, and test-account evidence with the release record. Never paste credentials into the record.

## Release identity

- [ ] Final release commit and branch recorded
- [ ] Code review completed for authentication, ownership, provider, export, and deletion changes
- [ ] Production URL and Vercel deployment ID recorded
- [ ] Known unavailable features listed for support and demos
- [ ] Previous known-good Vercel deployment identified

## Build and automated verification

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm env:check`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e`
- [ ] Dependency audit reviewed; high-impact findings resolved or explicitly accepted
- [ ] Test output archived without secrets or private provider payloads

## Supabase and data isolation

- [ ] Production project and region confirmed
- [ ] Restorable backup/PITR checkpoint confirmed before migration
- [ ] All migration filenames applied in order
- [ ] Curated demo seed applied
- [ ] RLS enabled and forced on application tables
- [ ] Anonymous access limited to intended curated templates
- [ ] Service-only tables inaccessible to browser roles
- [ ] Two test users cannot read, update, or delete one another’s records
- [ ] Multiple move-plan switching persists across sessions
- [ ] Local prototype import is offered once, sanitizes excluded fields, and does not duplicate
- [ ] JSON export contains only allowlisted user data
- [ ] Account deletion removes the disposable Auth user and owned application records
- [ ] Document Center stores metadata only

## Authentication

- [ ] Site URL is the exact production HTTPS origin
- [ ] Redirect URL allowlist contains only required production, local, and controlled preview URLs
- [ ] Production SMTP sender and monitored support/reply-to are configured
- [ ] Sign-up and email confirmation tested
- [ ] Sign-in, persistent session, and sign-out tested
- [ ] Password reset tested on the production origin
- [ ] Protected pages and API routes reject unauthenticated requests
- [ ] Demo workspace is not backed by or linked to a real user account

## Credentials and security

- [ ] No secret exists in Git history, client JavaScript, HTML, source maps, logs, screenshots, or exports
- [ ] Supabase service-role key exists only in server environments
- [ ] HERE browser and server credentials are separate
- [ ] HERE browser key is restricted to exact required origins and products
- [ ] Server API responses never expose provider request URLs containing credentials
- [ ] Mutation routes enforce same-origin checks, validation, authorization, and rate limits
- [ ] Timeouts and bounded retries exist for provider calls
- [ ] Security headers and Content Security Policy verified in production
- [ ] Stored and reflected user content is rendered safely
- [ ] Privacy-conscious logging contains no provider secrets or sensitive payloads
- [ ] Credential owners and rotation dates recorded

## HERE route and map

- [ ] Real map tiles and route geometry render on desktop and mobile
- [ ] Origin, destination, alternatives, and selected route are accurate
- [ ] Address/place search returns real provider results
- [ ] Adding or removing a supported stop recalculates the route
- [ ] Passenger-car routing tested
- [ ] Moving-truck routing tested with verified height, width, length, gross weight, and clearance buffer
- [ ] Towing or trailer profile tested
- [ ] Displayed U.S. units convert correctly to provider metric units
- [ ] Known incompatible restriction fixture/provider result produces the correct conflict state
- [ ] Narrow margin and missing-coverage states are distinct
- [ ] No route is called guaranteed safe, legal, suitable, or open
- [ ] Provider source, coverage, and freshness are visible
- [ ] Private HERE key is absent from the browser

## Weather

- [ ] NWS User-Agent contains a monitored real contact
- [ ] Forecast points align with timed route segments
- [ ] Temperature, condition, precipitation, wind, and available gust/visibility fields retain official timestamps
- [ ] Active alerts show official name, effective period, expected route arrival, and official reference
- [ ] Alert severity and urgency are visually prioritized
- [ ] Route change, departure change, stale refresh, and manual refresh behavior tested
- [ ] Alert refresh interval respects provider guidance
- [ ] NWS outage shows unavailable or stale status without fake facts
- [ ] International/out-of-coverage route does not claim U.S. weather

## Area Intelligence

- [ ] Search requires no user credential or source configuration
- [ ] Selected place resolves to an explicit Census geography
- [ ] Every metric shows raw value, fit score, source, geography, reference period, retrieval date, coverage, and caveat
- [ ] Missing measures remain missing and are excluded from the weighted denominator
- [ ] Reliable-data coverage percentage is accurate
- [ ] Neighborhood selection does not imply property- or block-level evidence
- [ ] ACS values are not described as current listings or appraisals
- [ ] Reported crime and school measures remain unavailable unless an official adapter supplies them
- [ ] No unsupported place receives fake default values
- [ ] No Zillow or other unauthorized scraping occurs

## Product and accessibility

- [ ] Existing Move Atlas sections and primary workflows remain usable
- [ ] Guided setup works for apartments, condos, townhomes, houses, and other supported homes
- [ ] Loading, empty, retry, outage, stale, and offline states reviewed
- [ ] Desktop and mobile navigation tested
- [ ] Dialogs and forms are usable on a narrow phone viewport
- [ ] Keyboard navigation, visible focus, labels, and focus management tested
- [ ] Reduced-motion behavior tested
- [ ] Browser history, direct routes, refresh, and back/forward navigation tested
- [ ] Curated demo content is consistently labeled sample
- [ ] Privacy, Terms, Safety, and Support pages contain final operator/contact details
- [ ] Legal and safety wording reviewed by qualified counsel before commercial use

## Deployment and operations

- [ ] Vercel Production environment contains all required non-placeholder values
- [ ] Preview environments use separate credentials or have provider access disabled
- [ ] `/api/health` returns HTTP `200` on the final production deployment
- [ ] Provider failure does not crash unrelated application sections
- [ ] Protected daily cache and rate-limit cleanup cron is registered and succeeds
- [ ] Provider status, quota, and billing alerts configured at provider accounts
- [ ] Support inbox is monitored
- [ ] Rollback owner, procedure, and recovery checkpoint confirmed
- [ ] Post-deploy smoke test in `docs/DEPLOYMENT.md` completed
- [ ] Production URL shared only after every blocking item above passes
