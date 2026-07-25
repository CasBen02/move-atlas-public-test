import { NextResponse } from "next/server";

import { validateProductionEnvironment } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DependencyState = "available" | "misconfigured" | "unavailable";

async function checkDatabase(): Promise<{
  state: DependencyState;
  latencyMs: number;
}> {
  const startedAt = performance.now();
  const admin = createAdminClient();

  if (!admin) {
    return {
      state: "misconfigured",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  try {
    const { error } = await admin
      .from("curated_templates")
      .select("id", { count: "exact", head: true })
      .abortSignal(AbortSignal.timeout(3_000));

    return {
      state: error ? "unavailable" : "available",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      state: "unavailable",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const environment = validateProductionEnvironment();
  const database = await checkDatabase();
  const ready = environment.valid && database.state === "available";

  return NextResponse.json(
    {
      status: ready ? "healthy" : "degraded",
      checkedAt,
      version:
        process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
        process.env.npm_package_version ??
        "unknown",
      checks: {
        environment: {
          state: environment.valid ? "available" : "misconfigured",
          requiredValuesPresent: environment.valid,
        },
        database,
      },
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
