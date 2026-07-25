import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import { sanitizeLegacyAccount } from "@/lib/migration/local-v1";

const requestSchema = z.object({
  schema: z.literal("move-atlas-local-v1"),
  sourceKey: z.literal("moveAtlasStudio_accounts_v1"),
  selectedLocalAccountId: z.string().max(200),
  account: z.unknown(),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 3 });
  if (!auth.ok) return auth.response;

  const incoming = requestSchema.safeParse(await request.json().catch(() => null));
  if (!incoming.success) {
    return noStoreJson({ error: "That local profile is not compatible." }, { status: 400 });
  }

  let sanitized: ReturnType<typeof sanitizeLegacyAccount>;
  try {
    sanitized = sanitizeLegacyAccount(incoming.data.account);
  } catch {
    return noStoreJson(
      { error: "The local profile could not be safely imported." },
      { status: 400 },
    );
  }

  const { data, error } = await auth.supabase.rpc("import_legacy_v1", {
    sanitized_payload: sanitized.payload,
    payload_fingerprint: sanitized.fingerprint,
  });

  if (error) {
    return noStoreJson(
      { error: "Import could not be completed. Your browser copy was not changed." },
      { status: error.code === "23505" ? 409 : 503 },
    );
  }

  return noStoreJson({
    import: data,
    counts: sanitized.counts,
    localDataWasRemoved: false,
  });
}
