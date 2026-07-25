# Move Atlas database

This directory contains the Supabase/PostgreSQL production schema. Apply migrations in filename order, then apply `seed.sql`.

`config.toml` contains only local-development defaults and the committed seed path. Linking a remote project stores its reference in the CLI-managed `.temp` directory; do not commit that directory or a database password.

For a linked Supabase project:

```sh
supabase db push --include-seed
```

For a local Supabase stack:

```sh
supabase db reset
```

No credentials belong in these files. The service-role key must remain in protected server-only environment variables and must never be sent to a browser.

## Data model

- `user_profiles`, `move_plans`, and `setup_preferences`
- User-owned move tools: `tasks`, `areas`, `properties`, `career_opportunities`, `budget_items`, `packing_boxes`, `mover_quotes`, `utilities`, `address_change_items`, `document_checklist_items`, and `settling_in_tasks`
- `route_profiles` stores canonical metric vehicle dimensions, weight, trailer, fuel, and clearance-buffer values
- Provider-derived records: `area_snapshots`, `area_metrics`, `saved_route_plans`, `route_stops`, `route_restrictions`, and route weather snapshots, points, and alerts
- Optional planning-assistant conversations and messages
- `local_data_imports` stores only one-time import receipts, never raw browser data
- Service-only `provider_cache` and hashed fixed-window `api_rate_limits`
- Public, read-only `curated_templates` for the clearly labeled demo and starter checklist

Every move child has a composite `(user_id, move_plan_id)` ownership reference. Every application table has both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Authenticated clients can mutate only their own user-managed rows. Provider-derived facts are client-readable but server-writable only. Provider cache and rate-limit rows have no browser policy or grant.

Deleting a user through the protected Supabase Admin API deletes all application data through `ON DELETE CASCADE`. Do not expose an account-deletion SQL function to browser clients.

## RPCs

The server/application integration uses these exact signatures:

```sql
create_move_plan(plan_name text, initial jsonb) returns uuid
set_active_move_plan(plan_id uuid) returns void
import_legacy_v1(sanitized_payload jsonb, payload_fingerprint text) returns jsonb
check_rate_limit(bucket_key text, max_requests integer, window_seconds integer) returns boolean
```

The first three resolve the owner exclusively from `auth.uid()`. `check_rate_limit` is executable only by `service_role`; its caller supplies an application-scoped bucket such as `route:<user-id>`, and only a SHA-256 digest is stored.

`create_move_plan` accepts optional `origin`, `destination`, `moveDate`, `householdSummary`, `status`, `makeCurrent`, and `setupPreferences`. Locations may be structured JSON objects or legacy labels. Only allowlisted setup fields are stored.

`import_legacy_v1` is atomic and limited to a 2 MB, one-time payload. The preferred sanitized shape is:

```json
{
  "profile": {"displayName": "Mover"},
  "plans": [
    {
      "name": "My move",
      "isCurrent": true,
      "origin": "Chicago, IL",
      "destination": "Portland, OR",
      "date": "2026-10-15",
      "setupPreferences": {},
      "tasks": [],
      "areas": [],
      "properties": [],
      "careerOpportunities": [],
      "budgetItems": [],
      "packingBoxes": [],
      "moverQuotes": [],
      "utilities": [],
      "addressChangeItems": [],
      "documentChecklistItems": [],
      "settlingTasks": [],
      "routeProfile": {}
    }
  ]
}
```

For compatibility it also recognizes the prototype’s `moveLibrary`, `activeMoveId`, `move`, `housing`, `career`, `budget`, `operations.*`, `documentChecklist`, `travel`, and `assistant.messages` keys, either at the payload root or beneath `account`. The application must sanitize the browser object before calling the RPC and compute `payload_fingerprint` as lowercase SHA-256 hex. Password fields, email labels, legacy provider keys, bundled “official” snapshots, mock route results, and document contents are ignored by design. Vehicle setup is imported, but prototype route, restriction, weather, and area-provider results are not.

## Operational notes

- Apply provider writes with a user ID verified by the server; never trust a client-supplied owner.
- Cache only validated provider responses. Never cache credentials, authorization headers, or sensitive logs.
- Use `shared` cache scope only for non-personal public observations. Geocoding exact addresses, route requests, and other user-specific inputs must use `user` scope.
- Purge expired `provider_cache` and `api_rate_limits` rows with a scheduled database job or protected maintenance task.
- A public demo template is not an Auth user and has no password. It remains isolated from real accounts and contains no seeded live-provider facts.
- Document Center stores checklist metadata only. File contents, government IDs, financial account numbers, passwords, and API credentials are outside this launch schema.
