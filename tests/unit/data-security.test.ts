import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  accountExportColumns,
  sanitizeAccountExportRows,
  type AccountExportTable,
} from "../../src/lib/data/account-export";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("account export", () => {
  it("uses only columns that exist in the production migrations", () => {
    const sql = [
      read("supabase/migrations/202607240001_core.sql"),
      read("supabase/migrations/202607240002_provider_data.sql"),
    ].join("\n");

    for (const [table, columns] of Object.entries(accountExportColumns)) {
      const start = sql.indexOf(`create table public.${table} (`);
      expect(start, `${table} table exists`).toBeGreaterThanOrEqual(0);
      const end = sql.indexOf("\n);", start);
      const definition = sql.slice(start, end);
      for (const column of columns) {
        expect(
          new RegExp(`^\\s+${column}\\s`, "m").test(definition),
          `${table}.${column} exists`,
        ).toBe(true);
      }
    }
  });

  it("strips fields outside each table's explicit allowlist", () => {
    const output = sanitizeAccountExportRows("assistant_messages", [
      {
        id: "message-1",
        move_plan_id: "move-1",
        conversation_id: "conversation-1",
        role: "user",
        content: "Pack the kitchen",
        provider_name: null,
        created_at: "2026-07-24T00:00:00Z",
        user_id: "private-owner-id",
        provider_request_id: "provider-trace-id",
        password: "never-export",
        token: "never-export",
      },
    ]);

    expect(output).toEqual([
      {
        id: "message-1",
        move_plan_id: "move-1",
        conversation_id: "conversation-1",
        role: "user",
        content: "Pack the kitchen",
        provider_name: null,
        created_at: "2026-07-24T00:00:00Z",
      },
    ]);
  });

  it("never selects auth, session, secret, or raw provider-cache fields", () => {
    const selected = Object.entries(accountExportColumns)
      .flatMap(([table, columns]) =>
        columns.map((column) => `${table}.${column}`.toLowerCase()),
      )
      .join("\n");

    for (const forbidden of [
      "password",
      "password_hash",
      "session",
      "api_key",
      "service_role",
      "provider_request_id",
      "response_payload",
      "source_fingerprint",
    ]) {
      expect(selected).not.toContain(forbidden);
    }
    expect(accountExportColumns).not.toHaveProperty("provider_cache");
    expect(accountExportColumns).not.toHaveProperty("api_rate_limits");
  });

  it("returns no data for malformed row collections", () => {
    expect(
      sanitizeAccountExportRows(
        "move_plans" satisfies AccountExportTable,
        null,
      ),
    ).toEqual([]);
  });
});

describe("user isolation and protected routes", () => {
  it("enables and forces RLS for every exported user table", () => {
    const rls = read("supabase/migrations/202607240004_row_level_security.sql");
    expect(rls).toContain("enable row level security");
    expect(rls).toContain("force row level security");

    for (const table of Object.keys(accountExportColumns)) {
      expect(rls, `${table} participates in the RLS table lists`).toContain(
        `'${table}'`,
      );
    }
    expect(rls).toContain(
      'using ((select auth.uid()) = user_id)',
    );
    expect(rls).toContain(
      'with check ((select auth.uid()) = user_id)',
    );
  });

  it("protects every non-health API route with the shared authorization gate", () => {
    const apiRoot = join(root, "src/app/api");
    const unprotected = routeFiles(apiRoot)
      .filter((path) => !path.endsWith("/health/route.ts"))
      .filter((path) => !path.endsWith("/maintenance/cleanup/route.ts"))
      .filter((path) => !readFileSync(path, "utf8").includes("authorizeApiRequest"))
      .map((path) => relative(root, path));
    expect(unprotected).toEqual([]);

    const maintenance = read("src/app/api/maintenance/cleanup/route.ts");
    expect(maintenance).toContain("CRON_SECRET");
    expect(maintenance).toContain("timingSafeEqual");
    expect(maintenance).toContain('from("provider_cache")');
    expect(maintenance).toContain('from("api_rate_limits")');
  });

  it("scopes direct record mutations to both move and authenticated user", () => {
    for (const path of [
      "src/app/api/move-plans/[moveId]/route.ts",
      "src/app/api/move-plans/[moveId]/records/[resource]/route.ts",
      "src/app/api/move-plans/[moveId]/records/[resource]/[recordId]/route.ts",
    ]) {
      const source = read(path);
      expect(source, path).toContain('.eq("user_id", auth.user.id)');
    }
  });

  it("switches one owned move plan at a time", () => {
    const core = read("supabase/migrations/202607240001_core.sql");
    const rpc = read("supabase/migrations/202607240003_account_rpcs.sql");

    expect(core).toMatch(
      /create unique index move_plans_one_current_per_user_idx[\s\S]*where is_current;/,
    );
    expect(rpc).toMatch(
      /where id = plan_id and user_id = v_user_id/,
    );
    expect(rpc).toMatch(
      /set is_current = false[\s\S]*where user_id = v_user_id[\s\S]*set is_current = true[\s\S]*where user_id = v_user_id[\s\S]*and id = plan_id;/,
    );
  });

  it("promotes a remaining plan when the current plan is deleted", () => {
    const rpc = read("supabase/migrations/202607240003_account_rpcs.sql");
    const endpoint = read("src/app/api/move-plans/[moveId]/route.ts");
    const rls = read("supabase/migrations/202607240004_row_level_security.sql");

    expect(rpc).toMatch(
      /create or replace function public\.delete_move_plan[\s\S]*delete from public\.move_plans[\s\S]*returning is_current into v_was_current[\s\S]*set is_current = true/,
    );
    expect(endpoint).toMatch(/\.rpc\(\s*"delete_move_plan"/);
    expect(rls).toContain(
      "revoke insert, update, delete on table public.move_plans from authenticated;",
    );
    expect(rls).toContain("grant update (");
  });

  it("reauthenticates before deleting the cascading auth identity", () => {
    const endpoint = read("src/app/api/account/route.ts");
    expect(endpoint.indexOf("signInWithPassword")).toBeGreaterThanOrEqual(0);
    expect(endpoint.indexOf("deleteUser")).toBeGreaterThan(
      endpoint.indexOf("signInWithPassword"),
    );

    const core = read("supabase/migrations/202607240001_core.sql");
    expect(core).toContain(
      "user_id uuid primary key references auth.users(id) on delete cascade",
    );
    expect(core).toContain(
      "user_id uuid not null default auth.uid() references auth.users(id) on delete cascade",
    );
  });

  it("backfills application profiles for pre-existing Supabase Auth users", () => {
    const core = read("supabase/migrations/202607240001_core.sql");

    expect(core).toMatch(
      /insert into public\.user_profiles \(user_id, display_name\)[\s\S]*from auth\.users as users[\s\S]*on conflict \(user_id\) do nothing;/,
    );
  });

  it("retains official raw area evidence when a personal fit cannot be calculated", () => {
    const provider = read(
      "supabase/migrations/202607240002_provider_data.sql",
    );
    const service = read("src/lib/services/area-evidence.ts");

    expect(provider).toMatch(
      /availability = 'available'[\s\S]*raw_value is not null[\s\S]*normalized_fit_score is null[\s\S]*applied_weight is null/,
    );
    expect(service).toMatch(
      /item\.measure\?\.rawValue !== null && item\.measure\?\.rawValue !== undefined[\s\S]*\? "available"/,
    );
  });

  it("does not activate a route when restriction evidence fails to persist", () => {
    const calculate = read("src/app/api/routes/calculate/route.ts");
    const insertIndex = calculate.indexOf(
      '.from("route_restrictions")',
    );
    const errorIndex = calculate.indexOf("if (restrictionsError)", insertIndex);
    const rollbackIndex = calculate.indexOf(
      '.from("route_profiles")',
      errorIndex,
    );
    const successIndex = calculate.indexOf("persistedRestrictions: notices");

    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(errorIndex).toBeGreaterThan(insertIndex);
    expect(rollbackIndex).toBeGreaterThan(errorIndex);
    expect(successIndex).toBeGreaterThan(rollbackIndex);
    expect(calculate.slice(errorIndex, successIndex)).toContain(
      "No route was activated",
    );
  });

  it("restores persisted route restrictions with the saved route", () => {
    const latest = read("src/app/api/routes/latest/route.ts");
    const interfaceSource = read(
      "src/components/workspace/sections/route-command-center.tsx",
    );

    expect(latest).toContain('.from("route_restrictions")');
    expect(latest).toContain("restrictionsError");
    expect(latest).toContain("persistedRestrictions: restrictions ?? []");
    expect(interfaceSource).toContain("result.persistedRestrictions?.length");
    expect(interfaceSource).toContain("restriction.coverage_note");
  });
});
