import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  WorkspaceData,
} from "@/lib/data/types";
import {
  normalizeMovePlan,
  normalizePreferences,
  normalizeProfile,
  normalizeRecord,
} from "@/lib/data/normalizers";
import { assertWorkspaceSectionsLoaded } from "@/lib/data/workspace-result";

const recordTables = {
  tasks: "tasks",
  areas: "areas",
  properties: "properties",
  budget: "budget_items",
  boxes: "packing_boxes",
  movers: "mover_quotes",
  utilities: "utilities",
  address: "address_change_items",
  documents: "document_checklist_items",
  settling: "settling_in_tasks",
  career: "career_opportunities",
  routes: "saved_route_plans",
} as const;

export async function getWorkspace(moveId: string): Promise<WorkspaceData | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, plansResult, planResult, preferencesResult, importResult] =
    await Promise.all([
      supabase
        .from("user_profiles")
        .select("user_id,display_name,onboarding_completed_at")
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("move_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("move_plans")
        .select("*")
        .eq("id", moveId)
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("setup_preferences")
        .select(
          "desired_home_types,accessibility_needs,move_priorities,route_preferences,completed_at",
        )
        .eq("move_plan_id", moveId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("local_data_imports")
        .select("completed_at")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .maybeSingle(),
    ]);

  if (
    profileResult.error ||
    plansResult.error ||
    planResult.error ||
    !profileResult.data ||
    !planResult.data
  ) {
    return null;
  }

  const entries = await Promise.all(
    Object.entries(recordTables).map(async ([key, table]) => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("move_plan_id", moveId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      return { section: key, data, error };
    }),
  );
  assertWorkspaceSectionsLoaded(entries);
  const records = entries.map(({ section, data }) => [
    section,
    (data ?? []).map((row) =>
      normalizeRecord(section, row as Record<string, unknown>),
    ),
  ] as const);

  return {
    profile: normalizeProfile(
      profileResult.data as Record<string, unknown>,
      (importResult.data?.completed_at as string | null | undefined) ?? null,
    ),
    plans: (plansResult.data as Record<string, unknown>[]).map(normalizeMovePlan),
    plan: normalizeMovePlan(planResult.data as Record<string, unknown>),
    preferences: normalizePreferences(
      preferencesResult.data as Record<string, unknown> | null,
    ),
    records: Object.fromEntries(records),
  };
}

export async function getActiveMoveId() {
  const supabase = await createClient();
  if (!supabase) return { authenticated: false, moveId: null };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authenticated: false, moveId: null };

  const { data: profile } = await supabase
    .from("move_plans")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();

  if (profile?.id) {
    return { authenticated: true, moveId: profile.id as string };
  }

  const { data: first } = await supabase
    .from("move_plans")
    .select("id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { authenticated: true, moveId: (first?.id as string | undefined) ?? null };
}
