import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    status: z
      .enum([
        "planning",
        "scheduled",
        "in_progress",
        "settling_in",
        "completed",
        "archived",
      ])
      .optional(),
    target_date: z.iso.date().nullable().optional(),
  })
  .strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ moveId: string }> },
) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 30 });
  if (!auth.ok) return auth.response;
  const { moveId } = await params;
  if (!z.uuid().safeParse(moveId).success) {
    return noStoreJson({ error: "Invalid move plan." }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return noStoreJson({ error: "No valid changes supplied." }, { status: 400 });
  }

  const { target_date, ...rest } = parsed.data;
  const databaseChanges = {
    ...rest,
    ...(target_date !== undefined ? { move_date: target_date } : {}),
  };
  const { data, error } = await auth.supabase
    .from("move_plans")
    .update(databaseChanges)
    .eq("id", moveId)
    .eq("user_id", auth.user.id)
    .select("id,name,status,move_date,updated_at")
    .single();

  if (error) return noStoreJson({ error: "Move plan could not be updated." }, { status: 404 });
  return noStoreJson({ plan: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ moveId: string }> },
) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 8 });
  if (!auth.ok) return auth.response;
  const { moveId } = await params;
  if (!z.uuid().safeParse(moveId).success) {
    return noStoreJson({ error: "Invalid move plan." }, { status: 400 });
  }

  const { data: replacementMovePlanId, error } = await auth.supabase.rpc(
    "delete_move_plan",
    { plan_id: moveId },
  );

  if (error) {
    return noStoreJson({ error: "Move plan was not found." }, { status: 404 });
  }

  return noStoreJson({ deleted: true, replacementMovePlanId });
}
