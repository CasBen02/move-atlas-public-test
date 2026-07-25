import type { NextRequest } from "next/server";
import { movePlanInputSchema } from "@/lib/data/schemas";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";

export async function GET(request: NextRequest) {
  const auth = await authorizeApiRequest(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("move_plans")
    .select(
      "id,name,status,is_current,origin,destination,move_date,household_summary,created_at,updated_at",
    )
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false });

  if (error) return noStoreJson({ error: "Move plans could not be loaded." }, { status: 503 });
  return noStoreJson({ plans: data });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 12 });
  if (!auth.ok) return auth.response;

  const parsed = movePlanInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(
      { error: "Check the setup details.", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { data, error } = await auth.supabase.rpc("create_move_plan", {
    plan_name: parsed.data.name,
    initial: {
      status: "planning",
      makeCurrent: true,
      moveDate: parsed.data.targetDate,
      origin: { label: parsed.data.originLabel },
      destination: { label: parsed.data.destinationLabel },
      householdSummary: {
        label: parsed.data.household,
        personName: parsed.data.personName,
        moveType: parsed.data.moveType,
        timeframe: parsed.data.timeframe,
        housingIntent: parsed.data.housingIntent,
        housingMaxCents: parsed.data.housingMaxCents,
        savingsCents: parsed.data.savingsCents,
        moveFundTargetCents: parsed.data.moveFundTargetCents,
        onboardingCompletedAt: new Date().toISOString(),
      },
      setupPreferences: {
        householdSize: 1,
        childrenTraveling: /child|family/i.test(parsed.data.household),
        petsTraveling: parsed.data.pets.length > 0,
        desiredHomeTypes: parsed.data.propertyTypes,
        accessibilityNeeds: parsed.data.accessibilityNeeds,
        movePriorities: {
          priorityTags: parsed.data.priorityTags,
          dailyNeeds: parsed.data.dailyNeeds,
          commuteMode: parsed.data.commuteMode,
          maxCommuteMinutes: parsed.data.maxCommuteMinutes,
          bedrooms: parsed.data.bedrooms,
          bathrooms: parsed.data.bathrooms,
          pets: parsed.data.pets,
          weights: parsed.data.weights,
        },
        routePreferences: {},
        completed: true,
      },
    },
  });

  if (error || typeof data !== "string") {
    return noStoreJson({ error: "Your move plan could not be created." }, { status: 503 });
  }

  return noStoreJson({ id: data }, { status: 201 });
}
