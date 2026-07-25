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

function validPath(moveId: string, resource: string, recordId: string) {
  return (
    z.uuid().safeParse(moveId).success &&
    z.uuid().safeParse(recordId).success &&
    isResourceName(resource)
  );
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ moveId: string; resource: string; recordId: string }> },
) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 90 });
  if (!auth.ok) return auth.response;
  const { moveId, resource, recordId } = await params;
  if (!validPath(moveId, resource, recordId) || !isResourceName(resource)) {
    return noStoreJson({ error: "Record not found." }, { status: 404 });
  }

  const parsed = recordDefinitions[resource].schema
    .partial()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return noStoreJson({ error: "No valid changes supplied." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from(recordDefinitions[resource].table)
    .update(toDatabaseRecord(resource, parsed.data))
    .eq("id", recordId)
    .eq("move_plan_id", moveId)
    .eq("user_id", auth.user.id)
    .select("*")
    .single();

  if (error) return noStoreJson({ error: "Record could not be updated." }, { status: 404 });
  return noStoreJson({
    record: normalizeRecord(resource, data as Record<string, unknown>),
  });
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ moveId: string; resource: string; recordId: string }> },
) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 40 });
  if (!auth.ok) return auth.response;
  const { moveId, resource, recordId } = await params;
  if (!validPath(moveId, resource, recordId) || !isResourceName(resource)) {
    return noStoreJson({ error: "Record not found." }, { status: 404 });
  }

  const { count, error } = await auth.supabase
    .from(recordDefinitions[resource].table)
    .delete({ count: "exact" })
    .eq("id", recordId)
    .eq("move_plan_id", moveId)
    .eq("user_id", auth.user.id);

  if (error || count !== 1) {
    return noStoreJson({ error: "Record was not found." }, { status: 404 });
  }
  return noStoreJson({ deleted: true });
}
