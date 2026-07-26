import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import {
  cacheKey,
  readProviderCache,
  writeProviderCache,
} from "@/lib/cache/provider-cache";
import {
  HereGeocodingProvider,
  HereRoutingProvider,
  type ProviderResult,
  type HereRoutePlan,
  flattenHereRouteGeometry,
  unavailable,
} from "@/lib/providers";
import {
  normalizeVehicleProfile,
  type VehicleCategory,
} from "@/lib/domain/vehicle";
import {
  inchesToMeters,
  milesPerKwhToKwhPer100Km,
  poundsToKilograms,
} from "@/lib/domain/units";
import { refreshRouteWeather } from "@/lib/services/route-weather";
import {
  rankRouteAlternatives,
  routeStrategyDisclosure,
} from "@/lib/domain/route-selection";

const vehicleCategories = [
  "passenger_car",
  "suv",
  "pickup",
  "cargo_van",
  "moving_truck",
  "moving_truck_towing",
  "car_towing_trailer",
  "rv",
  "oversized",
] as const;

const requestSchema = z.object({
  movePlanId: z.uuid(),
  origin: z.string().trim().min(2).max(300),
  destination: z.string().trim().min(2).max(300),
  departureTime: z.iso.datetime(),
  strategy: z.enum([
    "fastest",
    "shortest",
    "fuel_conscious",
    "truck_suitable",
    "weather_aware",
    "custom",
  ]),
  alternatives: z.coerce.number().int().min(0).max(4).default(2),
  selectedAlternativeIndex: z.coerce.number().int().min(0).max(4).default(0),
  waypoints: z
    .array(
      z.object({
        providerPlaceId: z.string().trim().min(1).max(500),
        name: z.string().trim().min(1).max(500),
        address: z.string().trim().max(1_000).nullable(),
        position: z.object({
          lat: z.coerce.number().min(-90).max(90),
          lng: z.coerce.number().min(-180).max(180),
        }),
        stopType: z.enum([
          "fuel",
          "travel_center",
          "hotel",
          "food",
          "rest_area",
          "park",
          "pet_break",
          "urgent_care",
          "veterinary",
          "repair",
          "towing",
          "attraction",
        ]),
        providerRetrievedAt: z.iso.datetime().nullable().default(null),
      }),
    )
    .max(8)
    .default([]),
  vehicle: z.object({
    category: z.enum(vehicleCategories),
    heightFeet: z.coerce.number().int().min(2).max(30),
    heightInches: z.coerce.number().min(0).max(11.99),
    widthFeet: z.coerce.number().min(0).max(30).optional(),
    widthInches: z.coerce.number().min(0).max(11.99).optional(),
    lengthFeet: z.coerce.number().min(4).max(196).optional(),
    lengthInches: z.coerce.number().min(0).max(11.99).optional(),
    grossWeightPounds: z.coerce.number().min(1).max(440_924).optional(),
    weightPerAxlePounds: z.coerce.number().min(1).max(220_462).optional(),
    loadedStatus: z.enum(["unloaded", "lightly_loaded", "loaded", "unknown"]),
    heightVerified: z.boolean(),
  }),
  trailer: z
    .object({
      enabled: z.boolean(),
      heightFeet: z.coerce.number().min(0).max(30).optional(),
      heightInches: z.coerce.number().min(0).max(11.99).optional(),
      widthFeet: z.coerce.number().min(0).max(30).optional(),
      widthInches: z.coerce.number().min(0).max(11.99).optional(),
      lengthFeet: z.coerce.number().min(0).max(131).optional(),
      lengthInches: z.coerce.number().min(0).max(11.99).optional(),
      weightPounds: z.coerce.number().min(0).max(220_462).optional(),
    })
    .superRefine((value, context) => {
      if (value.enabled && !value.lengthFeet && !value.lengthInches) {
        context.addIssue({
          code: "custom",
          message: "Enter the attached trailer or towed-vehicle length.",
          path: ["lengthFeet"],
        });
      }
    }),
  clearanceBufferInches: z.coerce.number().min(0).max(118).default(6),
  fuel: z.object({
    type: z.enum([
      "regular_gasoline",
      "midgrade_gasoline",
      "premium_gasoline",
      "diesel",
      "electric",
    ]),
    efficiency: z.coerce.number().positive().max(500),
    capacity: z.coerce.number().positive().max(1_000),
    startingPercent: z.coerce.number().min(0).max(100),
    reservePercent: z.coerce.number().min(0).max(100),
    expectedPricePerUnit: z.coerce.number().min(0).max(1_000),
    emergencyBufferPercent: z.coerce.number().min(0).max(100),
  }),
  party: z.object({
    drivers: z.coerce.number().int().min(1).max(20),
    maxHoursPerDay: z.coerce.number().min(1).max(24),
    children: z.boolean(),
    pets: z.boolean(),
    stopFrequencyHours: z.coerce.number().min(0.5).max(8),
  }),
  avoid: z.object({
    tollRoads: z.boolean(),
    ferries: z.boolean(),
    controlledAccessHighways: z.boolean(),
    difficultTurns: z.boolean(),
    tunnels: z.boolean(),
    dirtRoads: z.boolean(),
  }),
}).superRefine((value, context) => {
  const lengthMeters =
    (value.vehicle.lengthFeet ?? 0) * 0.3048 +
    (value.vehicle.lengthInches ?? 0) * 0.0254 +
    (value.trailer.enabled
      ? (value.trailer.lengthFeet ?? 0) * 0.3048 +
        (value.trailer.lengthInches ?? 0) * 0.0254
      : 0);
  if (value.vehicle.lengthFeet !== undefined && lengthMeters > 60) {
    context.addIssue({
      code: "custom",
      message:
        "Combined vehicle and trailer length must not exceed the supported 60-meter limit.",
      path: ["vehicle", "lengthFeet"],
    });
  }
  const vehicleWidthMeters =
    (value.vehicle.widthFeet ?? 0) * 0.3048 +
    (value.vehicle.widthInches ?? 0) * 0.0254;
  if (
    value.vehicle.widthFeet !== undefined &&
    vehicleWidthMeters > 0 &&
    vehicleWidthMeters < 0.5
  ) {
    context.addIssue({
      code: "custom",
      message: "Entered vehicle width must be at least 0.5 meters.",
      path: ["vehicle", "widthFeet"],
    });
  }
  if (value.trailer.enabled) {
    const trailerLengthMeters =
      (value.trailer.lengthFeet ?? 0) * 0.3048 +
      (value.trailer.lengthInches ?? 0) * 0.0254;
    if (trailerLengthMeters < 0.5 || trailerLengthMeters > 40) {
      context.addIssue({
        code: "custom",
        message: "Trailer length must be between 0.5 and 40 meters.",
        path: ["trailer", "lengthFeet"],
      });
    }
    for (const [feet, inches, field] of [
      [
        value.trailer.heightFeet,
        value.trailer.heightInches,
        "heightFeet",
      ],
      [value.trailer.widthFeet, value.trailer.widthInches, "widthFeet"],
    ] as const) {
      const meters = (feet ?? 0) * 0.3048 + (inches ?? 0) * 0.0254;
      if (meters > 0 && meters < 0.2) {
        context.addIssue({
          code: "custom",
          message: "Entered trailer dimensions must be at least 0.2 meters.",
          path: ["trailer", field],
        });
      }
    }
  }
  const axle = value.vehicle.weightPerAxlePounds;
  const gross = value.vehicle.grossWeightPounds;
  if (axle !== undefined && gross !== undefined && axle > gross) {
    context.addIssue({
      code: "custom",
      message: "Axle weight cannot exceed gross vehicle weight.",
      path: ["vehicle", "weightPerAxlePounds"],
    });
  }
  const combinedWeight =
    (gross ?? 0) +
    (value.trailer.enabled ? value.trailer.weightPounds ?? 0 : 0);
  if (combinedWeight > 440_924) {
    context.addIssue({
      code: "custom",
      message:
        "Combined vehicle and trailer weight exceeds the supported database limit.",
      path: ["vehicle", "grossWeightPounds"],
    });
  }
});

function routeProfileCategory(category: VehicleCategory) {
  if (category === "moving_truck_towing") return "moving_truck_towing_vehicle";
  if (category === "oversized") return "oversized_vehicle";
  return category;
}

function dataState(result: Extract<ProviderResult<HereRoutePlan>, { status: "available" }>) {
  return result.meta.freshness === "cached" || result.meta.freshness === "stale"
    ? result.meta.freshness
    : result.meta.freshness === "live"
      ? "live"
      : "recently_updated";
}

export async function POST(request: NextRequest) {
  const auth = await authorizeApiRequest(request, { mutation: true, limit: 12 });
  if (!auth.ok) return auth.response;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(
     {
  error: parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join(" "),
  issues: parsed.error.flatten().fieldErrors,
},
      { status: 400 },
    );
  }
  const input = parsed.data;
  if (!input.vehicle.heightVerified) {
    return noStoreJson(
      {
        error:
          "Verify the exact vehicle height from the vehicle documentation before calculating a route.",
      },
      { status: 400 },
    );
  }
  if (input.movePlanId !== request.nextUrl.searchParams.get("movePlanId") &&
      request.nextUrl.searchParams.has("movePlanId")) {
    return noStoreJson({ error: "Move plan mismatch." }, { status: 400 });
  }

  const { data: ownedPlan } = await auth.supabase
    .from("move_plans")
    .select("id")
    .eq("id", input.movePlanId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!ownedPlan) return noStoreJson({ error: "Move plan not found." }, { status: 404 });

  const serverKey = process.env.HERE_SERVER_API_KEY;
  const cacheHash = cacheKey({
    origin: input.origin,
    destination: input.destination,
    departureTime: input.departureTime,
    strategy: input.strategy,
    alternatives: input.alternatives,
    waypoints: input.waypoints.map(({ position }) => position),
    vehicle: input.vehicle,
    trailer: input.trailer,
    clearanceBufferInches: input.clearanceBufferInches,
    avoid: input.avoid,
  });
  const cached = await readProviderCache<ProviderResult<HereRoutePlan>>({
    provider: "HERE Routing API v8",
    operation: "route",
    key: cacheHash,
    userId: auth.user.id,
  });

  let routeResult: ProviderResult<HereRoutePlan>;
  let originPlace: Awaited<ReturnType<HereGeocodingProvider["search"]>> | null = null;
  let destinationPlace: Awaited<ReturnType<HereGeocodingProvider["search"]>> | null =
    null;
  const vehicle = normalizeVehicleProfile({
    category: input.vehicle.category as VehicleCategory,
    heightFeet: input.vehicle.heightFeet,
    heightInches: input.vehicle.heightInches,
    widthFeet: input.vehicle.widthFeet,
    widthInches: input.vehicle.widthInches,
    lengthFeet: input.vehicle.lengthFeet,
    lengthInches: input.vehicle.lengthInches,
    grossWeightPounds: input.vehicle.grossWeightPounds,
    weightPerAxlePounds: input.vehicle.weightPerAxlePounds,
    loadedState:
      input.vehicle.loadedStatus === "lightly_loaded"
        ? "loaded"
        : input.vehicle.loadedStatus,
    trailer: input.trailer,
  });

  const requestFreshRoute = async (): Promise<ProviderResult<HereRoutePlan>> => {
    const geocoder = new HereGeocodingProvider({ apiKey: serverKey });
    [originPlace, destinationPlace] = await Promise.all([
      geocoder.search({ kind: "geocode", query: input.origin, limit: 1 }),
      geocoder.search({ kind: "geocode", query: input.destination, limit: 1 }),
    ]);
    if (
      originPlace.status === "unavailable" ||
      destinationPlace.status === "unavailable" ||
      !originPlace.data[0]?.position ||
      !destinationPlace.data[0]?.position
    ) {
      const firstFailure =
        originPlace.status === "unavailable"
          ? originPlace
          : destinationPlace.status === "unavailable"
            ? destinationPlace
            : null;
      return unavailable({
        reason: firstFailure?.reason ?? "not_found",
        message: "Origin or destination could not be resolved by HERE.",
        retryable: firstFailure?.retryable ?? false,
        meta: {
          provider: "HERE Geocoding and Search v7",
          source:
            firstFailure?.meta.source ??
            "https://www.here.com/docs/bundle/geocoding-and-search-api-v7-api-reference",
          checkedAt: new Date().toISOString(),
          coverage: "The requested route endpoints were not both resolved.",
          caveats: ["Review the entered origin and destination."],
        },
      });
    }

    const provider = new HereRoutingProvider({ apiKey: serverKey });
    return provider.route({
      origin: originPlace.data[0].position,
      destination: destinationPlace.data[0].position,
      via: input.waypoints.map((waypoint) => waypoint.position),
      departureTime: input.departureTime,
      alternatives: input.alternatives,
      routingMode: input.strategy === "shortest" ? "short" : "fast",
      vehicle,
      clearanceBufferMeters: inchesToMeters(input.clearanceBufferInches),
      avoid: input.avoid,
    });
  };

  if (
    cached?.state === "cached" &&
    cached.value.status === "available"
  ) {
    routeResult = {
      ...cached.value,
      meta: { ...cached.value.meta, freshness: "cached" },
    };
  } else {
    const refreshed = await requestFreshRoute();
    if (
      refreshed.status === "unavailable" &&
      cached?.state === "stale" &&
      cached.value.status === "available"
    ) {
      routeResult = {
        ...cached.value,
        meta: {
          ...cached.value.meta,
          freshness: "stale",
          caveats: [
            ...cached.value.meta.caveats,
            `The provider refresh failed (${refreshed.reason}); this is the most recent usable cached route.`,
          ],
        },
      };
    } else {
      routeResult = refreshed;
    }
    await writeProviderCache({
      provider: "HERE Routing API v8",
      operation: "route",
      key: cacheHash,
      value: refreshed,
      ttlSeconds: refreshed.status === "available" ? 15 * 60 : 30,
      staleSeconds: refreshed.status === "available" ? 2 * 60 * 60 : 90,
      userId: auth.user.id,
      movePlanId: input.movePlanId,
      sourceIssuedAt:
        refreshed.status === "available" ? refreshed.meta.observedAt ?? null : null,
    });
  }

  if (routeResult.status === "unavailable") {
    return noStoreJson(routeResult, { status: routeResult.retryable ? 503 : 422 });
  }
  routeResult = {
    ...routeResult,
    data: {
      ...routeResult.data,
      routes: rankRouteAlternatives(routeResult.data.routes, input.strategy),
    },
  };
  if (input.selectedAlternativeIndex >= routeResult.data.routes.length) {
    return noStoreJson(
      { error: "That route alternative is no longer available. Compare routes again." },
      { status: 409 },
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return noStoreJson({ error: "Route persistence is unavailable." }, { status: 503 });
  }
  const { data: profile, error: profileError } = await auth.supabase
    .from("route_profiles")
    .insert({
      user_id: auth.user.id,
      move_plan_id: input.movePlanId,
      name: `${input.vehicle.category.replaceAll("_", " ")} route profile`,
      vehicle_category: routeProfileCategory(input.vehicle.category),
      display_unit_system: "us",
      vehicle_height_m: vehicle.heightMeters,
      vehicle_width_m: vehicle.widthMeters ?? null,
      vehicle_length_m: vehicle.lengthMeters ?? null,
      gross_weight_kg: vehicle.grossWeightKilograms ?? null,
      axle_weight_kg: vehicle.weightPerAxleKilograms ?? null,
      trailer_enabled: input.trailer.enabled,
      trailer_height_m:
        input.trailer.enabled &&
        (input.trailer.heightFeet || input.trailer.heightInches)
          ? (input.trailer.heightFeet ?? 0) * 0.3048 +
            (input.trailer.heightInches ?? 0) * 0.0254
          : null,
      trailer_width_m:
        input.trailer.enabled &&
        (input.trailer.widthFeet || input.trailer.widthInches)
          ? (input.trailer.widthFeet ?? 0) * 0.3048 +
            (input.trailer.widthInches ?? 0) * 0.0254
          : null,
      trailer_length_m: input.trailer.enabled
        ? (input.trailer.lengthFeet ?? 0) * 0.3048 +
          (input.trailer.lengthInches ?? 0) * 0.0254
        : null,
      trailer_weight_kg:
        input.trailer.enabled && input.trailer.weightPounds
          ? poundsToKilograms(input.trailer.weightPounds)
          : null,
      loaded_status: input.vehicle.loadedStatus,
      fuel_type: input.fuel.type,
      tank_or_battery_capacity: input.fuel.capacity,
      capacity_unit: input.fuel.type === "electric" ? "kwh" : "us_gallon",
      efficiency_value:
        input.fuel.type === "electric"
          ? milesPerKwhToKwhPer100Km(input.fuel.efficiency)
          : input.fuel.efficiency,
      efficiency_unit: input.fuel.type === "electric" ? "kwh_per_100km" : "mpg_us",
      starting_capacity_percent: input.fuel.startingPercent,
      preferred_minimum_percent: input.fuel.reservePercent,
      clearance_buffer_m: inchesToMeters(input.clearanceBufferInches),
      avoidance_preferences: input.avoid,
      party_preferences: input.party,
      hotel_preferences: {},
    })
    .select("id")
    .single();

  if (profileError || !profile) {
    return noStoreJson(
      { error: "The real route was calculated but its vehicle profile could not be saved." },
      { status: 503 },
    );
  }

  const selected = routeResult.data.routes[input.selectedAlternativeIndex];
  const lastSection = selected.sections.at(-1);
  const originPosition = selected.sections[0]?.geometry[0] ?? null;
  const destinationPosition =
    selected.sections.at(-1)?.geometry.at(-1) ?? null;
  const strategyDisclosure = routeStrategyDisclosure(
    input.strategy,
    routeResult.data.vehicleEvaluation.transportMode,
  );
  const routeSnapshot = {
    ...selected,
    sections: selected.sections.map((section) => ({
      ...section,
      geometry: [],
    })),
  };
  const travelSchedule = {
    maxDrivingHoursPerDay: input.party.maxHoursPerDay,
    stopFrequencyHours: input.party.stopFrequencyHours,
    children: input.party.children,
    pets: input.party.pets,
  };
  const { data: saved, error: saveError } = await admin
    .from("saved_route_plans")
    .insert({
      user_id: auth.user.id,
      move_plan_id: input.movePlanId,
      route_profile_id: profile.id,
      name: `${input.origin} to ${input.destination}`.slice(0, 200),
      provider_name: "HERE Routing API",
      provider_route_id: selected.id,
      provider_api_version: "v8",
      route_mode: routeResult.data.vehicleEvaluation.transportMode,
      route_strategy: input.strategy,
      origin: { label: input.origin, position: originPosition },
      destination: { label: input.destination, position: destinationPosition },
      waypoints: input.waypoints,
      flexible_polyline:
        selected.sections.length === 1
          ? selected.sections[0].encodedFlexiblePolyline
          : null,
      distance_m: Math.round(selected.lengthMeters),
      duration_seconds: Math.round(selected.durationSeconds),
      base_duration_seconds:
        selected.baseDurationSeconds === null
          ? null
          : Math.round(selected.baseDurationSeconds),
      traffic_duration_seconds: Math.round(selected.durationSeconds),
      estimated_arrival_at: lastSection?.arrivalTime ?? null,
      planned_departure_at: input.departureTime,
      toll_amount: selected.tollTotalsByCurrency.USD ?? null,
      toll_currency: selected.tollTotalsByCurrency.USD === undefined ? null : "USD",
      selected_alternative_index: input.selectedAlternativeIndex,
      summary: {
        alternativeCount: routeResult.data.routes.length,
        sectionPolylines: selected.sections.map(
          (section) => section.encodedFlexiblePolyline,
        ).filter((value): value is string => Boolean(value)),
        vehicleEvaluation: routeResult.data.vehicleEvaluation,
        routeSnapshot,
        strategyDisclosure,
        travelSchedule,
        calculationInput: input,
      },
      restriction_coverage: "partial",
      data_state: dataState(routeResult),
      provider_retrieved_at: routeResult.meta.retrievedAt,
      stale_after: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
    })
    .select("id")
    .single();

  if (saveError || !saved) {
    await admin
      .from("route_profiles")
      .delete()
      .eq("id", profile.id)
      .eq("user_id", auth.user.id);
    return noStoreJson(
      { error: "The real route was calculated but could not be saved." },
      { status: 503 },
    );
  }

  if (input.waypoints.length) {
    const { error: stopsError } = await admin.from("route_stops").insert(
      input.waypoints.map((waypoint, index) => ({
        user_id: auth.user.id,
        move_plan_id: input.movePlanId,
        route_plan_id: saved.id,
        stop_order: index,
        stop_type:
          waypoint.stopType === "travel_center"
            ? "waypoint"
            : waypoint.stopType,
        provider_place_id: waypoint.providerPlaceId,
        name: waypoint.name,
        address: waypoint.address,
        latitude: waypoint.position.lat,
        longitude: waypoint.position.lng,
        planned_arrival_at: null,
        planned_duration_minutes: null,
        route_deviation_m: null,
        additional_drive_seconds: null,
        details: {
          originalStopType: waypoint.stopType,
          missingDetailsRemainUnverified: true,
        },
        verification_state: "unverified",
        provider_retrieved_at: waypoint.providerRetrievedAt,
      })),
    );
    if (stopsError) {
      await admin
        .from("route_profiles")
        .delete()
        .eq("id", profile.id)
        .eq("user_id", auth.user.id);
      return noStoreJson(
        { error: "The route was calculated, but its selected stops could not be saved." },
        { status: 503 },
      );
    }
  }

  const notices: Record<string, unknown>[] = selected.notices.flatMap(
    (notice, index) => {
      const assessment = notice.clearanceAssessment;
      const findings: {
        type: string;
        entered: number | null;
        known: number | null;
        unit: "m" | "kg";
      }[] =
        notice.kind === "height_or_clearance"
          ? [
              {
                type: "clearance",
                entered: assessment?.vehicleHeightMeters ?? vehicle.heightMeters,
                known: assessment?.knownClearanceMeters ?? null,
                unit: "m",
              },
            ]
          : notice.kind === "width_or_length"
            ? [
                ...(notice.knownLimits.maximumWidthMeters === null
                  ? []
                  : [
                      {
                        type: "width",
                        entered: vehicle.widthMeters ?? null,
                        known: notice.knownLimits.maximumWidthMeters,
                        unit: "m" as const,
                      },
                    ]),
                ...(notice.knownLimits.maximumLengthMeters === null
                  ? []
                  : [
                      {
                        type: "length",
                        entered: vehicle.lengthMeters ?? null,
                        known: notice.knownLimits.maximumLengthMeters,
                        unit: "m" as const,
                      },
                    ]),
              ]
            : notice.kind === "weight_or_axle"
              ? [
                  ...(notice.knownLimits.maximumWeightKilograms === null
                    ? []
                    : [
                        {
                          type: "weight",
                          entered: vehicle.grossWeightKilograms ?? null,
                          known: notice.knownLimits.maximumWeightKilograms,
                          unit: "kg" as const,
                        },
                      ]),
                  ...(notice.knownLimits.maximumWeightPerAxleKilograms === null
                    ? []
                    : [
                        {
                          type: "axle_weight",
                          entered: vehicle.weightPerAxleKilograms ?? null,
                          known:
                            notice.knownLimits.maximumWeightPerAxleKilograms,
                          unit: "kg" as const,
                        },
                      ]),
                ]
              : [
                  {
                    type:
                      notice.kind === "trailer"
                        ? "trailer"
                        : notice.kind === "truck_access"
                          ? "truck_prohibition"
                          : "coverage",
                    entered: null,
                    known: null,
                    unit: "kg",
                  },
                ];
      const normalizedFindings = findings.length
        ? findings
        : [{ type: "coverage", entered: null, known: null, unit: "m" as const }];
      return normalizedFindings.map((finding) => ({
        user_id: auth.user.id,
        move_plan_id: input.movePlanId,
        route_plan_id: saved.id,
        segment_index: index,
        restriction_type: finding.type,
        finding:
          assessment?.status === "no_conflict_found"
            ? "no_conflict_in_available_data"
            : assessment?.status ?? "restriction_notice",
        severity:
          notice.severity?.toLowerCase() === "critical" ? "severe" : "high",
        provider_description: notice.title,
        location_name: null,
        entered_vehicle_value: finding.entered,
        known_restriction_value: finding.known,
        safety_buffer_value: assessment?.preferredBufferMeters ?? null,
        measurement_unit: finding.unit,
        source_name: "HERE Routing API v8",
        source_reference:
          "https://www.here.com/docs/bundle/routing-api-v8-api-reference",
        coverage_note:
          assessment?.message ??
          "Provider restriction notice; verify official agencies and posted road signs.",
        provider_retrieved_at: routeResult.meta.retrievedAt,
      }));
    },
  );
  notices.push({
    user_id: auth.user.id,
    move_plan_id: input.movePlanId,
    route_plan_id: saved.id,
    segment_index: null,
    restriction_type: "coverage",
    finding: "data_unavailable",
    severity: "moderate",
    provider_description: "Restriction coverage is not enumerated for every route segment.",
    location_name: null,
    entered_vehicle_value: vehicle.heightMeters,
    known_restriction_value: null,
    safety_buffer_value: inchesToMeters(input.clearanceBufferInches),
    measurement_unit: "m",
    source_name: "HERE Routing API v8",
    source_reference: "https://www.here.com/docs/bundle/routing-api-v8-api-reference",
    coverage_note:
      "Clearance data unavailable for any segment not covered by a provider notice—manual verification required.",
    provider_retrieved_at: routeResult.meta.retrievedAt,
  });
  const { error: restrictionsError } = await admin
    .from("route_restrictions")
    .insert(notices);
  if (restrictionsError) {
    const { error: rollbackError } = await admin
      .from("route_profiles")
      .delete()
      .eq("id", profile.id)
      .eq("user_id", auth.user.id);
    return noStoreJson(
      {
        error:
          rollbackError === null
            ? "The route was calculated, but its restriction evidence could not be saved. No route was activated."
            : "The route restriction save failed and cleanup is incomplete. Recalculate before relying on this route.",
      },
      { status: 503 },
    );
  }

  let weather: Awaited<ReturnType<typeof refreshRouteWeather>> | null = null;
  try {
    const points = flattenHereRouteGeometry(selected, 250_000);
    weather = await refreshRouteWeather({
      userId: auth.user.id,
      movePlanId: input.movePlanId,
      routePlanId: saved.id,
      points,
      departureTime: input.departureTime,
      durationSeconds: selected.durationSeconds,
      travelSchedule,
      windProfile: {
        vehicleCategory: input.vehicle.category,
        loadedStatus: input.vehicle.loadedStatus,
        trailerEnabled: input.trailer.enabled,
      },
    });
  } catch {
    weather = null;
  }

  return noStoreJson({
    ...routeResult,
    savedRoutePlanId: saved.id,
    routeProfileId: profile.id,
    savedAlternativeIndex: input.selectedAlternativeIndex,
    strategy: input.strategy,
    strategyDisclosure,
    stops: input.waypoints,
    persistedRestrictions: notices,
    weather,
  });
}
