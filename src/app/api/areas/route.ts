import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import { normalizeRecord } from "@/lib/data/normalizers";
import { loadOfficialAreaEvidence } from "@/lib/services/area-evidence";

const placeSchema = z.object({
  id: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  resultType: z.string().max(100).nullable(),
  position: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  accessPoints: z.array(z.object({ lat: z.number(), lng: z.number() })).max(20),
  address: z.object({
    label: z.string().max(1000).nullable(),
    countryCode: z.string().max(8).nullable(),
    stateCode: z.string().max(8).nullable(),
    state: z.string().max(120).nullable(),
    county: z.string().max(240).nullable(),
    city: z.string().max(240).nullable(),
    district: z.string().max(240).nullable(),
    postalCode: z.string().max(20).nullable(),
  }),
  distanceMeters: z.number().nonnegative().nullable(),
  categories: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().max(200).nullable(),
        primary: z.boolean(),
      }),
    )
    .max(30),
  providerDetails: z.object({
    contactsAvailable: z.boolean(),
    openingHoursAvailable: z.boolean(),
  }),
  unverifiedFields: z.array(z.string().max(100)).max(30),
});

const requestSchema = z.object({
  movePlanId: z.uuid(),
  place: placeSchema,
  hint: z
    .enum(["auto", "zip", "place", "county", "neighborhood"])
    .default("auto"),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 20 });
  if (!auth.ok) return auth.response;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ error: "Choose a valid place result." }, { status: 400 });
  }

  const { data: plan } = await auth.supabase
    .from("move_plans")
    .select("id,household_summary")
    .eq("id", parsed.data.movePlanId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!plan) return noStoreJson({ error: "Move plan not found." }, { status: 404 });

  const { data: preferences } = await auth.supabase
    .from("setup_preferences")
    .select("move_priorities")
    .eq("move_plan_id", parsed.data.movePlanId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const priorities = (preferences?.move_priorities ?? {}) as Record<string, unknown>;
  const weights = (priorities.weights ?? {}) as Record<string, unknown>;
  const household = (plan.household_summary ?? {}) as Record<string, unknown>;

  const { data: area, error } = await auth.supabase
    .from("areas")
    .insert({
      user_id: auth.user.id,
      move_plan_id: parsed.data.movePlanId,
      search_query: parsed.data.place.title,
      display_name: parsed.data.place.title,
      place_reference: parsed.data.place.id,
      latitude: parsed.data.place.position.lat,
      longitude: parsed.data.place.position.lng,
      ranking_weights: {
        hereContext: {
          resultType: parsed.data.place.resultType,
          address: parsed.data.place.address,
        },
      },
    })
    .select("*")
    .single();
  if (error || !area) {
    return noStoreJson({ error: "The area could not be added." }, { status: 503 });
  }

  const evidence = await loadOfficialAreaEvidence({
    userId: auth.user.id,
    movePlanId: parsed.data.movePlanId,
    areaId: area.id,
    place: parsed.data.place,
    hint: parsed.data.hint,
    weights: {
      housing: Number(weights.housing ?? 50),
      reportedCrime: Number(weights.reportedCrime ?? 50),
      mobility: Number(weights.mobility ?? 50),
      market: Number(weights.market ?? 50),
      dailyLife: Number(weights.dailyLife ?? 50),
      schools: Number(weights.schools ?? 0),
    },
    housingIntent: String(household.housingIntent ?? "rent"),
    housingMonthlyCeilingDollars:
      Number(household.housingMaxCents ?? 0) / 100 || null,
    commuteCeilingMinutes:
      Number(priorities.maxCommuteMinutes ?? 0) || null,
  });

  return noStoreJson(
    {
      record: normalizeRecord("areas", area as Record<string, unknown>),
      evidence,
    },
    { status: 201 },
  );
}
