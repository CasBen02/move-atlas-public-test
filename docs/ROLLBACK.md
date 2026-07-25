# Rollback and recovery

Prepare rollback before every production release. Application rollback and database recovery are separate decisions; reverting only the web deployment can be unsafe when a schema contract changed.

## Before release

Record:

- release commit and previous known-good commit,
- Vercel deployment IDs,
- migrations about to be applied,
- Supabase backup or point-in-time recovery checkpoint,
- environment-variable changes,
- provider-key changes,
- any local-data import or data transformation included in the release.

Apply migrations to staging and run the production check suite before production.

## Application-only rollback

Use when the schema remains backward-compatible:

1. Stop promotion of the failed deployment.
2. In Vercel, promote the previous known-good deployment.
3. Confirm `/api/health`.
4. Test sign-in, one user-owned read/write, route unavailable handling, and account isolation.
5. Record the incident and affected commit.

Do not assume a green health endpoint verifies every provider.

## Database-related rollback

The migrations are forward-only. Do not edit or delete a migration that has already run.

Preferred recovery order:

1. Disable traffic or put the application in an operator-controlled maintenance state.
2. Determine whether the defect can be repaired with a new forward migration.
3. If restoration is required, follow the Supabase project’s documented backup/PITR process.
4. Restore into a separate recovery project when possible and validate record counts, ownership, RLS, RPCs, and authentication before cutover.
5. Point the application to recovered credentials only after the restored system passes isolation and smoke tests.

Never run destructive SQL, drop user tables, or restore over production without a verified recovery point and explicit operator approval.

If an older application cannot understand the current schema, keep the newer deployment isolated until a compatibility migration or patched build is ready. Do not blindly promote an incompatible previous build.

## Provider incident rollback

If a provider adapter is faulty:

1. preserve user planning records,
2. disable or remove only the affected server credential,
3. allow the product to show its structured unavailable state,
4. purge only affected cached responses after identifying them by provider and operation,
5. deploy the repaired adapter,
6. test source, timestamps, coverage, and stale behavior before restoring access.

Do not substitute mock facts during the incident.

## Credential exposure

If a private credential is exposed:

1. revoke or rotate it at the provider immediately,
2. replace it in Vercel and any controlled non-production environments,
3. redeploy,
4. inspect logs and provider usage without copying sensitive payloads,
5. remove the value from Git history and caches using an approved secret-removal process,
6. verify the browser bundle and API responses,
7. document scope and notify affected parties when required.

For a leaked HERE browser key, rotate it and correct domain/product restrictions. For a leaked Supabase service-role key, treat all server-authorized data access as potentially affected.

## Data import recovery

Legacy import is one-time and idempotent. Do not rerun or manually reset an import receipt until:

- the sanitized payload is retained only in the user’s browser,
- imported record counts are compared with expected counts,
- duplicate consequences are understood,
- the recovery action is tested against a copy of the data.

The application must never store the raw legacy payload as an import receipt.

## Exit criteria

Traffic can resume only when:

- `/api/health` returns `200`,
- authentication and a user-owned write succeed,
- two-account isolation succeeds,
- affected migrations or providers are verified,
- no private credential is visible to the browser,
- unavailable or stale data is labeled accurately,
- the incident and final release state are recorded.
