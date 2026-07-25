import "server-only";

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AuthorizedRequest =
  | { ok: true; user: User; supabase: NonNullable<Awaited<ReturnType<typeof createClient>>> }
  | { ok: false; response: NextResponse };

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export async function authorizeApiRequest(
  request: NextRequest,
  options: { mutation?: boolean; limit?: number } = {},
): Promise<AuthorizedRequest> {
  if (options.mutation && !sameOrigin(request)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cross-origin request rejected." },
        { status: 403 },
      ),
    };
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_100_000) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request is too large." }, { status: 413 }),
    };
  }

  const supabase = await createClient();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Account service unavailable." },
        { status: 503 },
      ),
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request protection unavailable." },
        { status: 503 },
      ),
    };
  }

  const bucket = createHash("sha256")
    .update(`${user.id}:${request.nextUrl.pathname}`)
    .digest("hex");
  const { data, error } = await admin.rpc("check_rate_limit", {
    bucket_key: bucket,
    max_requests: options.limit ?? 60,
    window_seconds: 60,
  });

  if (error || data !== true) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: error ? "Request protection unavailable." : "Too many requests." },
        {
          status: error ? 503 : 429,
          headers: { "Retry-After": "60" },
        },
      ),
    };
  }

  return { ok: true, user, supabase };
}

export function noStoreJson(
  value: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return NextResponse.json(value, { ...init, headers });
}
