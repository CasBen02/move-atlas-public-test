import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`;
}

export function cacheKey(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export async function readProviderCache<T>(input: {
  provider: string;
  operation: string;
  key: string;
  userId?: string;
}) {
  const admin = createAdminClient();
  if (!admin) return null;
  let query = admin
    .from("provider_cache")
    .select("id,response_payload,retrieved_at,expires_at,stale_until")
    .eq("provider_name", input.provider)
    .eq("operation_name", input.operation)
    .eq("cache_key_hash", input.key);
  query = input.userId
    ? query.eq("cache_scope", "user").eq("owner_user_id", input.userId)
    : query.eq("cache_scope", "shared").is("owner_user_id", null);
  const { data } = await query.maybeSingle();
  if (!data) return null;
  const now = Date.now();
  const expires = Date.parse(data.expires_at);
  const staleUntil = data.stale_until ? Date.parse(data.stale_until) : expires;
  if (!Number.isFinite(staleUntil) || now > staleUntil) return null;
  return {
    id: data.id as string,
    value: data.response_payload as T,
    state: now <= expires ? ("cached" as const) : ("stale" as const),
    retrievedAt: data.retrieved_at as string,
  };
}

export async function writeProviderCache(input: {
  provider: string;
  operation: string;
  key: string;
  value: unknown;
  ttlSeconds: number;
  staleSeconds: number;
  userId?: string;
  movePlanId?: string;
  sourceIssuedAt?: string | null;
}) {
  const admin = createAdminClient();
  if (!admin) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1_000);
  const staleUntil = new Date(
    expiresAt.getTime() + input.staleSeconds * 1_000,
  );
  let query = admin
    .from("provider_cache")
    .select("id")
    .eq("provider_name", input.provider)
    .eq("operation_name", input.operation)
    .eq("cache_key_hash", input.key);
  query = input.userId
    ? query.eq("cache_scope", "user").eq("owner_user_id", input.userId)
    : query.eq("cache_scope", "shared").is("owner_user_id", null);
  const { data: existing } = await query.maybeSingle();
  const values = {
    provider_name: input.provider,
    operation_name: input.operation,
    cache_key_hash: input.key,
    cache_scope: input.userId ? "user" : "shared",
    owner_user_id: input.userId ?? null,
    move_plan_id: input.movePlanId ?? null,
    response_payload: input.value,
    response_schema_version: 1,
    source_issued_at: input.sourceIssuedAt ?? null,
    retrieved_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    stale_until: staleUntil.toISOString(),
  };
  if (existing?.id) {
    await admin.from("provider_cache").update(values).eq("id", existing.id);
  } else {
    await admin.from("provider_cache").insert(values);
  }
}
