import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ moveId: string }> },
) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 30 });
  if (!auth.ok) return auth.response;
  const { moveId } = await params;
  if (!z.uuid().safeParse(moveId).success) {
    return noStoreJson({ error: "Invalid move plan." }, { status: 400 });
  }

  const { error } = await auth.supabase.rpc("set_active_move_plan", {
    plan_id: moveId,
  });

  if (error) return noStoreJson({ error: "Move plan could not be selected." }, { status: 404 });
  return noStoreJson({ activeMovePlanId: moveId });
}
