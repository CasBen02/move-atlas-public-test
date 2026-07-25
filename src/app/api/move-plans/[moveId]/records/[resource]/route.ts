import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  isResourceName,
  recordDefinitions,
} from "@/lib/data/schemas";
import {
  normalizeRecord,
  toDatabaseRecord,
} from "@/lib/data/normalizers";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";

export async function POST(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ moveId: string; resource: string }> },
) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 60 });
  if (!auth.ok) return auth.response;
  const { moveId, resource } = await params;

  if (!z.uuid().safeParse(moveId).success || !isResourceName(resource)) {
    return noStoreJson({ error: "Unknown record type." }, { status: 404 });
  }

  const definition = recordDefinitions[resource];
  const parsed = definition.schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(
      { error: "Check the record details.", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { data: plan } = await auth.supabase
    .from("move_plans")
    .select("id")
    .eq("id", moveId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!plan) return noStoreJson({ error: "Move plan not found." }, { status: 404 });

  const { data, error } = await auth.supabase
    .from(definition.table)
    .insert({
      ...toDatabaseRecord(resource, parsed.data),
      user_id: auth.user.id,
      move_plan_id: moveId,
    })
    .select("*")
    .single();

  if (error) return noStoreJson({ error: "The record could not be saved." }, { status: 503 });
  return noStoreJson(
    { record: normalizeRecord(resource, data as Record<string, unknown>) },
    { status: 201 },
  );
}
