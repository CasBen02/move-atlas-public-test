# Provider configuration

Provider credentials belong to the application operator. They are configured in the server environment and never requested from a Move Atlas user.

Every production provider result must retain its provider name, source, retrieval time, coverage, and caveats. Provider errors return structured unavailable states; they must not be replaced with sample or AI-generated facts.

## Supabase

Supabase provides authentication, PostgreSQL persistence, Row Level Security, protected RPCs, rate-limit counters, and validated provider caching.

1. Create a production Supabase project in the desired region.
2. Apply every SQL file in `supabase/migrations` in filename order.
3. Apply `supabase/seed.sql`. It contains curated sample/template content only.
4. Copy the project URL, publishable key, and service-role key into the corresponding environment variables.
5. In Auth URL Configuration, set the Site URL to the exact production origin.
6. Add exact redirect URLs for `/auth/callback`, password reset, and any controlled preview environment used for testing.
7. Enable the desired email/password confirmation policy and configure a production SMTP sender before inviting external testers.
8. Verify RLS with two separate test users before launch.

The publishable key is designed for browser use; it does not bypass RLS. The service-role key bypasses RLS and must remain server-only.

## HERE

Move Atlas uses:

- Maps for JavaScript in the browser
- Geocoding and Search API v7 on the server
- Routing API v8 on the server
- Truck routing parameters and provider notices for applicable vehicle profiles

Create separate HERE applications or credentials:

### Browser map key

Set `NEXT_PUBLIC_HERE_MAPS_API_KEY`.

- Enable only the Maps for JavaScript capabilities the application needs.
- Restrict use to `http://localhost:3000` for a development key.
- Restrict the production key to the exact production HTTPS origin.
- Add preview origins only when previews are access-controlled and genuinely need maps.
- Never grant server-routing permissions to the browser key when the HERE account can separate them.

The key is visible by design in the browser. Domain and product restrictions are the security boundary.

### Private server key

Set `HERE_SERVER_API_KEY`.

- Enable Geocoding and Search v7 and Routing v8.
- Keep the value only in server environment variables.
- Use a separate key from the browser map key.
- Do not log generated HERE URLs because API-key authentication places the key in the query string.

The current adapter implements HERE API-key authentication. HERE OAuth credentials are not an interchangeable drop-in and are not accepted by the release validator.

### Route safety boundaries

HERE truck routing and notices are provider decision support, not proof that every restriction is known. Move Atlas applies entered dimensions and the user’s clearance buffer where the provider supports them, distinguishes provider notices from missing coverage, and requires manual verification for critical gaps.

Before launch, test representative passenger-car, box-truck, RV, and towing profiles. Compare the results with official agency sources and posted restrictions. Never convert a lack of HERE notices into “guaranteed safe.”

## National Weather Service

The NWS API requires no API key. Set `NWS_USER_AGENT` to a descriptive product/version and a monitored contact, for example:

```text
MoveAtlas/1.0 (support@your-real-domain.com)
```

The weather adapter resolves sampled U.S. route points, retrieves hourly forecasts and grid details, and checks official alerts. It uses provider timestamps and caches broader forecast work more heavily than active alerts.

NWS coverage is U.S.-specific. Do not silently reuse it for international routes. During an outage or outside coverage, display weather as unavailable. Forecast and alert facts must not be overwritten by assistant prose.

Monitor the contact address supplied in the User-Agent. Respect NWS rate guidance and do not disable caching or increase polling frequency without reviewing provider policy.

## U.S. Census Bureau

Set `CENSUS_API_KEY` to an operator-managed Census API key. No user key is required.

The current area adapter uses ACS 5-year data and resolves supported selections to a Census place, county, or ZIP Code Tabulation Area. It exposes the official geography, reference year, retrieval date, coverage, and caveats. A neighborhood may resolve only to broader city context; the UI must say so.

ACS values are survey estimates. They are not:

- current home or rental listings,
- a property appraisal,
- a prediction about a block or household,
- real-time population or market data.

Missing metrics are excluded from the weighted denominator. Do not substitute zero or a national default.

## Providers not connected at launch

The following are intentionally unavailable until an authorized, tested adapter exists:

- live fuel-station prices,
- Zillow, Realtor.com, Redfin, MLS, or other listing inventory,
- BLS employment evidence,
- FEMA hazard evidence,
- EPA air-quality evidence,
- NCES and state school-performance evidence,
- FHFA home-price trends,
- FBI CDE or local-agency reported-crime feeds,
- OpenAI-backed assistant responses,
- external error monitoring.

The application does not scrape listing or mapping websites. Manually saved homes and rentals are user records, not claims of current inventory.

For a new provider:

1. Confirm license, data-use, attribution, caching, and redistribution terms.
2. Add a typed adapter under `src/lib/providers`.
3. Validate every external response at runtime.
4. Add timeout, bounded retry, cache, stale, and structured unavailable behavior.
5. Preserve source, observation/retrieval time, geography, coverage, and caveats.
6. Put the private credential in a server-only variable.
7. Add parsing, outage, stale-data, and authorization tests.
8. Update Privacy, Terms, Safety, this document, and the launch checklist.
9. Only then remove the corresponding unavailable label.
