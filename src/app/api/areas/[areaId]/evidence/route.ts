import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ areaId: string }> },
) {
  const auth = await authorizeApiRequest(request, { limit: 60 });
  if (!auth.ok) return auth.response;
  const { areaId } = await params;
  if (!z.uuid().safeParse(areaId).success) {
    return noStoreJson({ error: "Area not found." }, { status: 404 });
  }
  const { data: area } = await auth.supabase
    .from("areas")
    .select("id,display_name,personal_fit_rating")
    .eq("id", areaId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!area) return noStoreJson({ error: "Area not found." }, { status: 404 });

  const { data: snapshot } = await auth.supabase
    .from("area_snapshots")
    .select("*")
    .eq("area_id", areaId)
    .eq("user_id", auth.user.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snapshot) {
    return noStoreJson({
      area,
      status: "unavailable",
      message: "Reliable data is not currently available for this measure.",
      snapshot: null,
      metrics: [],
    });
  }
  const { data: metrics } = await auth.supabase
    .from("area_metrics")
    .select("*")
    .eq("snapshot_id", snapshot.id)
    .eq("user_id", auth.user.id)
    .order("measure_key");

  return noStoreJson({
    area,
    status: snapshot.status,
    freshness:
      Date.parse(snapshot.stale_after) < Date.now()
        ? "stale"
        : "recently_updated",
    snapshot,
    metrics: metrics ?? [],
  });
}
