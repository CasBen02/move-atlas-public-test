import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { noStoreJson } from "@/lib/http/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 24) return false;
  const supplied = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return noStoreJson({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return noStoreJson(
      { error: "Maintenance service unavailable." },
      { status: 503 },
    );
  }

  const now = new Date().toISOString();
  const [staleCache, expiredCache, rateLimits] = await Promise.all([
    admin
      .from("provider_cache")
      .delete({ count: "exact" })
      .lt("stale_until", now),
    admin
      .from("provider_cache")
      .delete({ count: "exact" })
      .is("stale_until", null)
      .lt("expires_at", now),
    admin
      .from("api_rate_limits")
      .delete({ count: "exact" })
      .lt("expires_at", now),
  ]);
  if (staleCache.error || expiredCache.error || rateLimits.error) {
    return noStoreJson(
      { error: "Maintenance cleanup could not be completed." },
      { status: 503 },
    );
  }

  return noStoreJson({
    cleanedAt: now,
    deleted: {
      providerCache:
        (staleCache.count ?? 0) + (expiredCache.count ?? 0),
      rateLimits: rateLimits.count ?? 0,
    },
  });
}
