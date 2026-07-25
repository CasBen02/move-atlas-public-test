import type { NextRequest } from "next/server";
import { z } from "zod";

import { decodeHereFlexiblePolyline } from "@/lib/domain/polyline";
import {
  routeStrategyDisclosure,
  type RouteStrategy,
} from "@/lib/domain/route-selection";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import type {
  HereRouteAlternative,
  HereRoutePlan,
  ProviderFreshness,
} from "@/lib/providers";

const querySchema = z.object({ movePlanId: z.uuid() });

const summarySchema = z
  .object({
    sectionPolylines: z.array(z.string().min(1).max(5_000_000)).max(100),
    routeSnapshot: z.unknown().optional(),
    calculationInput: z.unknown().optional(),
    vehicleEvaluation: z
      .object({
        transportMode: z.enum(["car", "truck"]),
        actualHeightMeters: z.number().positive(),
        submittedHeightMeters: z.number().positive(),
        clearanceBufferMeters: z.number().nonnegative(),
        dimensionsApplied: z.boolean(),
        manualVerificationRequired: z.literal(true),
        coverageMessage: z.string(),
      })
      .optional(),
    strategyDisclosure: z
      .object({
        title: z.string(),
        explanation: z.string(),
        enforcement: z.enum([
          "provider",
          "provider_and_local_score",
          "preference_only",
        ]),
      })
      .optional(),
    travelSchedule: z
      .object({
        maxDrivingHoursPerDay: z.number().positive(),
        stopFrequencyHours: z.number().positive(),
        children: z.boolean().optional(),
        pets: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

const routeSnapshotSchema = z
  .object({
    id: z.string().min(1),
    lengthMeters: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    baseDurationSeconds: z.number().nonnegative().nullable(),
    typicalDurationSeconds: z.number().nonnegative().nullable(),
    sections: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    notices: z.array(z.unknown()),
    tollTotalsByCurrency: z.record(z.string(), z.number().nonnegative()),
  })
  .passthrough();

function restoreSnapshot(summary: z.infer<typeof summarySchema>) {
  const parsed = routeSnapshotSchema.safeParse(summary.routeSnapshot);
  if (!parsed.success) return null;
  const sections = parsed.data.sections.map((section, index) => {
    const encoded =
      typeof section.encodedFlexiblePolyline === "string"
        ? section.encodedFlexiblePolyline
        : summary.sectionPolylines[index] ?? null;
    if (!encoded) return null;
    const geometry = decodeHereFlexiblePolyline(encoded, {
      maximumPoints: 100_000,
    }).points.map(({ lat, lng }) => ({ lat, lng }));
    return {
      ...section,
      encodedFlexiblePolyline: encoded,
      geometry,
    };
  });
  if (sections.some((section) => section === null)) return null;
  return {
    ...parsed.data,
    sections,
  } as unknown as HereRouteAlternative;
}

function freshness(row: {
  data_state: string;
  stale_after: string | null;
}): ProviderFreshness {
  if (row.stale_after && Date.parse(row.stale_after) < Date.now()) return "stale";
  if (
    row.data_state === "live" ||
    row.data_state === "cached" ||
    row.data_state === "stale" ||
    row.data_state === "recently_updated"
  ) {
    return row.data_state;
  }
  return "recently_updated";
}

export async function GET(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { limit: 30 });
  if (!auth.ok) return auth.response;
  const parsed = querySchema.safeParse({
    movePlanId: request.nextUrl.searchParams.get("movePlanId"),
  });
  if (!parsed.success) {
    return noStoreJson({ error: "Choose a valid move plan." }, { status: 400 });
  }

  const { data: saved } = await auth.supabase
    .from("saved_route_plans")
    .select(
      "id,move_plan_id,route_profile_id,provider_name,provider_api_version,route_strategy,summary,data_state,provider_retrieved_at,stale_after,selected_alternative_index,created_at",
    )
    .eq("move_plan_id", parsed.data.movePlanId)
    .eq("user_id", auth.user.id)
    .neq("data_state", "unavailable")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!saved) {
    return noStoreJson(
      { status: "unavailable", message: "No saved route is available for this move." },
      { status: 404 },
    );
  }

  const summary = summarySchema.safeParse(saved.summary);
  if (!summary.success) {
    return noStoreJson(
      {
        status: "unavailable",
        message: "The latest saved route does not contain usable provider metadata.",
      },
      { status: 422 },
    );
  }
  let route: HereRouteAlternative | null = null;
  try {
    route = restoreSnapshot(summary.data);
  } catch {
    route = null;
  }
  if (!route || !summary.data.vehicleEvaluation) {
    return noStoreJson(
      {
        status: "unavailable",
        message:
          "The latest saved route predates geometry restoration. Compare routes again to save a reloadable route.",
      },
      { status: 422 },
    );
  }

  const [
    { data: stops, error: stopsError },
    { data: profile, error: profileError },
    { data: restrictions, error: restrictionsError },
  ] = await Promise.all([
    auth.supabase
      .from("route_stops")
      .select(
        "provider_place_id,name,address,latitude,longitude,stop_type,details,provider_retrieved_at",
      )
      .eq("route_plan_id", saved.id)
      .eq("user_id", auth.user.id)
      .order("stop_order", { ascending: true }),
    auth.supabase
      .from("route_profiles")
      .select(
        "fuel_type,tank_or_battery_capacity,efficiency_value,efficiency_unit,starting_capacity_percent,preferred_minimum_percent,trailer_enabled,loaded_status",
      )
      .eq("id", saved.route_profile_id)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    auth.supabase
      .from("route_restrictions")
      .select(
        "segment_index,restriction_type,finding,severity,provider_description,location_name,entered_vehicle_value,known_restriction_value,safety_buffer_value,measurement_unit,source_name,source_reference,coverage_note,provider_retrieved_at",
      )
      .eq("route_plan_id", saved.id)
      .eq("user_id", auth.user.id)
      .order("segment_index", { ascending: true, nullsFirst: false }),
  ]);
  if (stopsError || profileError || restrictionsError) {
    return noStoreJson(
      {
        status: "unavailable",
        message:
          "The saved route exists, but its stops, vehicle profile, or restriction evidence could not be restored.",
      },
      { status: 503 },
    );
  }
  const strategy = saved.route_strategy as RouteStrategy;
  const strategyDetails =
    summary.data.strategyDisclosure ??
    routeStrategyDisclosure(
      strategy,
      summary.data.vehicleEvaluation.transportMode,
    );
  const plan: HereRoutePlan = {
    routes: [route],
    vehicleEvaluation: summary.data.vehicleEvaluation,
  };
  return noStoreJson({
    status: "available",
    data: plan,
    meta: {
      provider: `${saved.provider_name} ${saved.provider_api_version ?? ""}`.trim(),
      source:
        "https://www.here.com/docs/bundle/routing-api-v8-api-reference",
      retrievedAt: saved.provider_retrieved_at ?? saved.created_at,
      freshness: freshness(saved),
      coverage:
        "Restored from the latest saved HERE route response for this move plan.",
      caveats: [
        "Saved route conditions may have changed; recalculate before departure.",
        "No saved route is a guarantee of safety, legality, clearance, or availability.",
      ],
    },
    savedRoutePlanId: saved.id,
    routeProfileId: saved.route_profile_id,
    savedAlternativeIndex: 0,
    providerAlternativeIndex: saved.selected_alternative_index,
    strategy,
    strategyDisclosure: strategyDetails,
    stops: (stops ?? []).map((stop) => {
      const details =
        stop.details &&
        typeof stop.details === "object" &&
        !Array.isArray(stop.details)
          ? (stop.details as Record<string, unknown>)
          : {};
      return {
        providerPlaceId: stop.provider_place_id,
        name: stop.name,
        address: stop.address,
        position: { lat: stop.latitude, lng: stop.longitude },
        stopType:
          typeof details.originalStopType === "string"
            ? details.originalStopType
            : stop.stop_type,
        providerRetrievedAt: stop.provider_retrieved_at,
      };
    }),
    persistedRestrictions: restrictions ?? [],
    fuelProfile: profile,
    travelSchedule: summary.data.travelSchedule ?? null,
    calculationInput: summary.data.calculationInput ?? null,
    weather: null,
    restored: true,
  });
}
