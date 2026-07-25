import { z } from "zod";

import { assessClearance, type ClearanceAssessment } from "../domain/clearance";
import { decodeHereFlexiblePolyline } from "../domain/polyline";
import type { MetricVehicleProfile } from "../domain/vehicle";
import { requiresTruckRouting } from "../domain/vehicle";
import { safeFetchJson } from "./safe-fetch";
import type { ProviderResult } from "./result";
import { unavailable } from "./result";

export const HERE_ROUTING_SOURCE = "https://www.here.com/docs/bundle/routing-api-v8-api-reference";
const HERE_ROUTING_ENDPOINT = "https://router.hereapi.com/v8/routes";

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type GeoPoint = z.infer<typeof pointSchema>;

export interface HereRouteRequest {
  apiKey: string;
  origin: GeoPoint;
  destination: GeoPoint;
  via?: GeoPoint[];
  departureTime?: string;
  alternatives?: number;
  routingMode?: "fast" | "short";
  vehicle: MetricVehicleProfile;
  clearanceBufferMeters?: number;
  avoid?: {
    tollRoads?: boolean;
    ferries?: boolean;
    controlledAccessHighways?: boolean;
    difficultTurns?: boolean;
    tunnels?: boolean;
    dirtRoads?: boolean;
  };
}

const hereScalarLimitSchema = z.number().finite().nonnegative();
const hereScalarOrValueLimitSchema = z.union([
  hereScalarLimitSchema,
  z
    .object({
      value: hereScalarLimitSchema,
    })
    .passthrough(),
]);

const hereNoticeSchema = z
  .object({
    title: z.string().optional(),
    code: z.string(),
    severity: z.string().optional(),
    details: z
      .array(
        z
          .object({
            type: z.string().optional(),
            cause: z.string().optional(),
            maxHeight: hereScalarOrValueLimitSchema.optional(),
            maxWidth: hereScalarOrValueLimitSchema.optional(),
            maxLength: hereScalarOrValueLimitSchema.optional(),
            maxWeight: hereScalarOrValueLimitSchema.optional(),
            maxGrossWeight: hereScalarOrValueLimitSchema.optional(),
            maxWeightPerAxle: hereScalarOrValueLimitSchema.optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const hereActionSchema = z
  .object({
    action: z.string().optional(),
    duration: z.number().nonnegative().optional(),
    length: z.number().nonnegative().optional(),
    instruction: z.string().optional(),
    offset: z.number().int().nonnegative().optional(),
    direction: z.string().optional(),
    severity: z.string().optional(),
  })
  .passthrough();

const hereSpanSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    length: z.number().nonnegative().optional(),
    duration: z.number().nonnegative().optional(),
    roadAttributes: z.array(z.string()).optional(),
    truckAttributes: z.array(z.string()).optional(),
    notices: z.array(z.number().int().nonnegative()).optional(),
    incidents: z.array(z.number().int().nonnegative()).optional(),
  })
  .passthrough();

const hereTollSchema = z
  .object({
    countryCode: z.string().optional(),
    tollSystem: z.string().optional(),
    fares: z
      .array(
        z
          .object({
            id: z.string().optional(),
            name: z.string().optional(),
            price: z
              .object({
                type: z.string().optional(),
                currency: z.string(),
                value: z.number().nonnegative(),
              })
              .optional(),
            convertedPrice: z
              .object({
                type: z.string().optional(),
                currency: z.string(),
                value: z.number().nonnegative(),
              })
              .optional(),
            reason: z.string().optional(),
            paymentMethods: z.array(z.string()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    paymentMethods: z.array(z.string()).optional(),
  })
  .passthrough();

const hereIncidentSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    criticality: z.string(),
    validFrom: z.string().optional(),
    validUntil: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const hereSectionSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    departure: z
      .object({
        time: z.string().optional(),
        place: z.unknown().optional(),
      })
      .passthrough(),
    arrival: z
      .object({
        time: z.string().optional(),
        place: z.unknown().optional(),
      })
      .passthrough(),
    summary: z
      .object({
        duration: z.number().nonnegative(),
        length: z.number().nonnegative(),
        baseDuration: z.number().nonnegative().optional(),
        typicalDuration: z.number().nonnegative().optional(),
      })
      .passthrough(),
    travelSummary: z
      .object({
        duration: z.number().nonnegative().optional(),
        length: z.number().nonnegative().optional(),
        baseDuration: z.number().nonnegative().optional(),
        consumption: z.number().optional(),
      })
      .passthrough()
      .optional(),
    polyline: z.string().min(1),
    actions: z.array(hereActionSchema).optional(),
    spans: z.array(hereSpanSchema).optional(),
    notices: z.array(hereNoticeSchema).optional(),
    tolls: z.array(hereTollSchema).optional(),
    incidents: z.array(hereIncidentSchema).optional(),
  })
  .passthrough();

const hereRouteSchema = z
  .object({
    id: z.string(),
    sections: z.array(hereSectionSchema).min(1),
    notices: z.array(hereNoticeSchema).optional(),
  })
  .passthrough();

export const hereRoutingResponseSchema = z
  .object({
    routes: z.array(hereRouteSchema),
  })
  .passthrough();

type RawHereRoutingResponse = z.infer<typeof hereRoutingResponseSchema>;
type RawNotice = z.infer<typeof hereNoticeSchema>;
type RawToll = z.infer<typeof hereTollSchema>;

export type HereRestrictionNoticeKind =
  | "height_or_clearance"
  | "width_or_length"
  | "weight_or_axle"
  | "truck_access"
  | "trailer"
  | "general";

export interface HereRestrictionNotice {
  code: string;
  title: string;
  severity: string | null;
  kind: HereRestrictionNoticeKind;
  routeSectionId: string | null;
  spanOffsets: number[];
  knownLimits: {
    maximumHeightMeters: number | null;
    maximumWidthMeters: number | null;
    maximumLengthMeters: number | null;
    maximumWeightKilograms: number | null;
    maximumWeightPerAxleKilograms: number | null;
  };
  clearanceAssessment: ClearanceAssessment | null;
  providerText: true;
}

export interface HereRouteSection {
  id: string;
  encodedFlexiblePolyline: string;
  geometry: { lat: number; lng: number }[];
  lengthMeters: number;
  durationSeconds: number;
  baseDurationSeconds: number | null;
  typicalDurationSeconds: number | null;
  departureTime: string | null;
  arrivalTime: string | null;
  actions: {
    instruction: string | null;
    action: string | null;
    offset: number | null;
    lengthMeters: number | null;
    durationSeconds: number | null;
  }[];
  notices: HereRestrictionNotice[];
  tolls: {
    currency: string;
    amount: number;
    name: string | null;
    paymentMethods: string[];
    fareId: string | null;
    selection: "highest_alternative_fare_for_toll_currency";
    alternativeFareCount: number;
  }[];
  incidents: {
    id: string;
    type: string;
    criticality: string;
    validFrom: string | null;
    validUntil: string | null;
    description: string | null;
    spanOffsets: number[];
    providerText: true;
  }[];
  restrictionCoverage: {
    status: "provider_evaluated_coverage_not_enumerated";
    manualVerificationRequired: true;
    message: string;
  };
}

export interface HereRouteAlternative {
  id: string;
  lengthMeters: number;
  durationSeconds: number;
  baseDurationSeconds: number | null;
  typicalDurationSeconds: number | null;
  sections: HereRouteSection[];
  notices: HereRestrictionNotice[];
  tollTotalsByCurrency: Record<string, number>;
  tollEstimateSemantics?: {
    selection: "highest_fare_per_toll_and_currency";
    duplicateFareIdsCountedOnce: true;
    description: string;
  };
}

export function flattenHereRouteGeometry(
  route: Pick<HereRouteAlternative, "sections">,
  maximumPoints = 250_000,
): { lat: number; lng: number }[] {
  if (!Number.isInteger(maximumPoints) || maximumPoints < 2 || maximumPoints > 1_000_000) {
    throw new RangeError("Maximum flattened route point count is invalid.");
  }
  const flattened: { lat: number; lng: number }[] = [];
  for (const section of route.sections) {
    for (const point of section.geometry) {
      const previous = flattened.at(-1);
      if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) {
        if (flattened.length >= maximumPoints) {
          throw new RangeError("Route geometry exceeds the configured point limit.");
        }
        flattened.push(point);
      }
    }
  }
  return flattened;
}

export interface HereRoutePlan {
  routes: HereRouteAlternative[];
  vehicleEvaluation: {
    transportMode: "car" | "truck";
    actualHeightMeters: number;
    submittedHeightMeters: number;
    clearanceBufferMeters: number;
    dimensionsApplied: boolean;
    manualVerificationRequired: true;
    coverageMessage: string;
  };
}

function coordinate(point: GeoPoint): string {
  pointSchema.parse(point);
  return `${point.lat},${point.lng}`;
}

function positiveOptional(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
  return value;
}

/**
 * Builds a HERE Routing v8 request. The returned URL contains the server API
 * credential and must never be logged, stored, or returned to a browser.
 */
export function buildHereRoutingUrl(input: HereRouteRequest): URL {
  if (!input.apiKey.trim()) throw new Error("HERE server routing credential is required.");
  const clearanceBuffer = input.clearanceBufferMeters ?? 0;
  if (!Number.isFinite(clearanceBuffer) || clearanceBuffer < 0) {
    throw new RangeError("Clearance buffer must be a finite, non-negative number.");
  }
  const alternatives = input.alternatives ?? 2;
  if (!Number.isInteger(alternatives) || alternatives < 0 || alternatives > 6) {
    throw new RangeError("HERE alternatives must be an integer between zero and six.");
  }
  if (
    !Number.isInteger(input.vehicle.trailerCount) ||
    input.vehicle.trailerCount < 0 ||
    input.vehicle.trailerCount > 4
  ) {
    throw new RangeError("Trailer count must be an integer between zero and four.");
  }
  if (
    input.vehicle.currentWeightKilograms !== undefined &&
    input.vehicle.grossWeightKilograms !== undefined &&
    input.vehicle.currentWeightKilograms > input.vehicle.grossWeightKilograms
  ) {
    throw new RangeError("Current vehicle weight cannot exceed gross vehicle weight.");
  }

  const url = new URL(HERE_ROUTING_ENDPOINT);
  const truck = requiresTruckRouting(input.vehicle.category);
  url.searchParams.set("apiKey", input.apiKey);
  url.searchParams.set("transportMode", truck ? "truck" : "car");
  url.searchParams.set("routingMode", input.routingMode ?? "fast");
  url.searchParams.set("origin", coordinate(input.origin));
  url.searchParams.set("destination", coordinate(input.destination));
  for (const via of input.via ?? []) url.searchParams.append("via", coordinate(via));
  url.searchParams.set("alternatives", String(alternatives));
  url.searchParams.set(
    "return",
    "polyline,summary,actions,instructions,travelSummary,typicalDuration,tolls,incidents",
  );
  url.searchParams.set(
    "spans",
    "notices,incidents,truckAttributes,roadAttributes,length,duration",
  );
  url.searchParams.set("units", "imperial");
  if (input.departureTime) {
    const time = new Date(input.departureTime);
    if (Number.isNaN(time.getTime())) throw new RangeError("Departure time must be valid.");
    url.searchParams.set("departureTime", time.toISOString());
  }

  const avoided: string[] = [];
  if (input.avoid?.tollRoads) avoided.push("tollRoad");
  if (input.avoid?.ferries) avoided.push("ferry");
  if (input.avoid?.controlledAccessHighways) avoided.push("controlledAccessHighway");
  if (input.avoid?.difficultTurns) avoided.push("difficultTurns");
  if (input.avoid?.tunnels) avoided.push("tunnel");
  if (input.avoid?.dirtRoads) avoided.push("dirtRoad");
  if (avoided.length) url.searchParams.set("avoid[features]", avoided.join(","));

  const submittedHeightMeters = input.vehicle.heightMeters + clearanceBuffer;
  positiveOptional(submittedHeightMeters, "Vehicle height");
  url.searchParams.set("vehicle[height]", String(Math.ceil(submittedHeightMeters * 100)));
  if (input.vehicle.widthMeters !== undefined) {
    positiveOptional(input.vehicle.widthMeters, "Vehicle width");
    url.searchParams.set("vehicle[width]", String(Math.ceil(input.vehicle.widthMeters * 100)));
  }
  if (input.vehicle.lengthMeters !== undefined) {
    positiveOptional(input.vehicle.lengthMeters, "Vehicle length");
    url.searchParams.set("vehicle[length]", String(Math.ceil(input.vehicle.lengthMeters * 100)));
  }
  if (input.vehicle.grossWeightKilograms !== undefined) {
    positiveOptional(input.vehicle.grossWeightKilograms, "Gross weight");
    url.searchParams.set(
      "vehicle[grossWeight]",
      String(Math.ceil(input.vehicle.grossWeightKilograms)),
    );
  }
  if (
    input.vehicle.currentWeightKilograms !== undefined &&
    input.vehicle.grossWeightKilograms !== undefined
  ) {
    positiveOptional(input.vehicle.currentWeightKilograms, "Current weight");
    url.searchParams.set(
      "vehicle[currentWeight]",
      String(Math.ceil(input.vehicle.currentWeightKilograms)),
    );
  }
  if (input.vehicle.weightPerAxleKilograms !== undefined) {
    positiveOptional(input.vehicle.weightPerAxleKilograms, "Weight per axle");
    url.searchParams.set(
      "vehicle[weightPerAxle]",
      String(Math.ceil(input.vehicle.weightPerAxleKilograms)),
    );
  }
  if (input.vehicle.trailerCount > 0) {
    url.searchParams.set("vehicle[trailerCount]", String(input.vehicle.trailerCount));
    if (input.vehicle.trailerLengthMeters !== undefined) {
      positiveOptional(input.vehicle.trailerLengthMeters, "Trailer length");
      url.searchParams.set(
        "vehicle[trailerLength]",
        String(Math.ceil(input.vehicle.trailerLengthMeters * 100)),
      );
    }
  }
  return url;
}

function noticeKind(notice: RawNotice): HereRestrictionNoticeKind {
  const text = `${notice.code} ${notice.title ?? ""}`.toLowerCase();
  if (notice.details?.some((detail) => detail.maxHeight !== undefined)) {
    return "height_or_clearance";
  }
  if (
    notice.details?.some(
      (detail) => detail.maxWidth !== undefined || detail.maxLength !== undefined,
    )
  ) {
    return "width_or_length";
  }
  if (
    notice.details?.some(
      (detail) =>
        detail.maxWeight !== undefined ||
        detail.maxGrossWeight !== undefined ||
        detail.maxWeightPerAxle !== undefined,
    )
  ) {
    return "weight_or_axle";
  }
  if (text.includes("height") || text.includes("clearance")) return "height_or_clearance";
  if (text.includes("width") || text.includes("length")) return "width_or_length";
  if (text.includes("weight") || text.includes("axle")) return "weight_or_axle";
  if (text.includes("trailer")) return "trailer";
  if (text.includes("truck") || text.includes("vehicle restriction")) return "truck_access";
  return "general";
}

function firstLimit(
  notice: RawNotice,
  key:
    | "maxHeight"
    | "maxWidth"
    | "maxLength"
    | "maxWeight"
    | "maxGrossWeight"
    | "maxWeightPerAxle",
): number | null {
  for (const detail of notice.details ?? []) {
    const value = detail[key];
    const scalar =
      typeof value === "number"
        ? value
        : value && typeof value === "object" && "value" in value
          ? value.value
          : null;
    if (typeof scalar === "number" && Number.isFinite(scalar) && scalar > 0) return scalar;
  }
  return null;
}

function selectConservativeTollFares(
  toll: RawToll,
): HereRouteSection["tolls"] {
  const candidates = (toll.fares ?? []).flatMap((fare) => {
    const price = fare.convertedPrice ?? fare.price;
    return price
      ? [
          {
            currency: price.currency,
            amount: price.value,
            name: fare.name ?? null,
            paymentMethods: fare.paymentMethods ?? toll.paymentMethods ?? [],
            fareId: fare.id ?? null,
          },
        ]
      : [];
  });
  const alternativesByCurrency = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const alternatives = alternativesByCurrency.get(candidate.currency) ?? [];
    alternatives.push(candidate);
    alternativesByCurrency.set(candidate.currency, alternatives);
  }

  return [...alternativesByCurrency.values()].map((alternatives) => {
    const selected = alternatives.reduce((highest, candidate) =>
      candidate.amount > highest.amount ? candidate : highest,
    );
    return {
      ...selected,
      selection: "highest_alternative_fare_for_toll_currency" as const,
      alternativeFareCount: alternatives.length,
    };
  });
}

function parseNotice(input: {
  notice: RawNotice;
  routeSectionId: string | null;
  spanOffsets: number[];
  vehicleHeightMeters: number;
  clearanceBufferMeters: number;
}): HereRestrictionNotice {
  const maximumHeightCentimeters = firstLimit(input.notice, "maxHeight");
  const maximumWeight =
    firstLimit(input.notice, "maxWeight") ?? firstLimit(input.notice, "maxGrossWeight");
  const knownHeightMeters =
    maximumHeightCentimeters === null ? null : maximumHeightCentimeters / 100;
  return {
    code: input.notice.code,
    title: input.notice.title ?? input.notice.code,
    severity: input.notice.severity ?? null,
    kind: noticeKind(input.notice),
    routeSectionId: input.routeSectionId,
    spanOffsets: input.spanOffsets,
    knownLimits: {
      maximumHeightMeters: knownHeightMeters,
      maximumWidthMeters:
        firstLimit(input.notice, "maxWidth") === null
          ? null
          : (firstLimit(input.notice, "maxWidth") ?? 0) / 100,
      maximumLengthMeters:
        firstLimit(input.notice, "maxLength") === null
          ? null
          : (firstLimit(input.notice, "maxLength") ?? 0) / 100,
      maximumWeightKilograms: maximumWeight,
      maximumWeightPerAxleKilograms: firstLimit(input.notice, "maxWeightPerAxle"),
    },
    clearanceAssessment:
      noticeKind(input.notice) === "height_or_clearance"
        ? assessClearance({
            vehicleHeightMeters: input.vehicleHeightMeters,
            preferredBufferMeters: input.clearanceBufferMeters,
            knownClearanceMeters: knownHeightMeters,
          })
        : null,
    providerText: true,
  };
}

export function parseHereRoutingResponse(
  raw: unknown,
  request: Pick<HereRouteRequest, "vehicle" | "clearanceBufferMeters">,
): HereRoutePlan {
  const parsed: RawHereRoutingResponse = hereRoutingResponseSchema.parse(raw);
  if (parsed.routes.length === 0) {
    throw new Error("HERE returned no route alternatives.");
  }
  const clearanceBuffer = request.clearanceBufferMeters ?? 0;
  const truck = requiresTruckRouting(request.vehicle.category);

  const routes = parsed.routes.map((route) => {
    const sections: HereRouteSection[] = route.sections.map((section) => {
      const notices = (section.notices ?? []).map((notice, noticeIndex) =>
        parseNotice({
          notice,
          routeSectionId: section.id,
          spanOffsets: (section.spans ?? [])
            .filter((span) => span.notices?.includes(noticeIndex))
            .map((span) => span.offset),
          vehicleHeightMeters: request.vehicle.heightMeters,
          clearanceBufferMeters: clearanceBuffer,
        }),
      );
      const tolls = section.tolls?.flatMap(selectConservativeTollFares) ?? [];
      const incidents =
        section.incidents?.map((incident, incidentIndex) => ({
          id: incident.id,
          type: incident.type,
          criticality: incident.criticality,
          validFrom: incident.validFrom ?? null,
          validUntil: incident.validUntil ?? null,
          description: incident.description ?? null,
          spanOffsets: (section.spans ?? [])
            .filter((span) => span.incidents?.includes(incidentIndex))
            .map((span) => span.offset),
          providerText: true as const,
        })) ?? [];

      return {
        id: section.id,
        encodedFlexiblePolyline: section.polyline,
        geometry: decodeHereFlexiblePolyline(section.polyline, {
          maximumPoints: 100_000,
        }).points.map(({ lat, lng }) => ({ lat, lng })),
        lengthMeters: section.summary.length,
        durationSeconds: section.summary.duration,
        baseDurationSeconds: section.summary.baseDuration ?? null,
        typicalDurationSeconds: section.summary.typicalDuration ?? null,
        departureTime: section.departure.time ?? null,
        arrivalTime: section.arrival.time ?? null,
        actions: (section.actions ?? []).map((action) => ({
          instruction: action.instruction ?? null,
          action: action.action ?? null,
          offset: action.offset ?? null,
          lengthMeters: action.length ?? null,
          durationSeconds: action.duration ?? null,
        })),
        notices,
        tolls,
        incidents,
        restrictionCoverage: {
          status: "provider_evaluated_coverage_not_enumerated",
          manualVerificationRequired: true,
          message:
            "HERE evaluated available route attributes, but does not certify that restriction or clearance coverage is complete for every segment.",
        },
      };
    });

    const allNotices = [
      ...(route.notices ?? []).map((notice) =>
        parseNotice({
          notice,
          routeSectionId: null,
          spanOffsets: [],
          vehicleHeightMeters: request.vehicle.heightMeters,
          clearanceBufferMeters: clearanceBuffer,
        }),
      ),
      ...sections.flatMap((section) => section.notices),
    ];
    const tollTotalsByCurrency: Record<string, number> = {};
    const countedFareIds = new Set<string>();
    for (const toll of sections.flatMap((section) => section.tolls)) {
      if (toll.fareId && countedFareIds.has(toll.fareId)) continue;
      if (toll.fareId) countedFareIds.add(toll.fareId);
      tollTotalsByCurrency[toll.currency] =
        (tollTotalsByCurrency[toll.currency] ?? 0) + toll.amount;
    }

    return {
      id: route.id,
      lengthMeters: sections.reduce((total, section) => total + section.lengthMeters, 0),
      durationSeconds: sections.reduce((total, section) => total + section.durationSeconds, 0),
      baseDurationSeconds: sections.some((section) => section.baseDurationSeconds === null)
        ? null
        : sections.reduce((total, section) => total + (section.baseDurationSeconds ?? 0), 0),
      typicalDurationSeconds: sections.some(
        (section) => section.typicalDurationSeconds === null,
      )
        ? null
        : sections.reduce(
            (total, section) => total + (section.typicalDurationSeconds ?? 0),
            0,
          ),
      sections,
      notices: allNotices,
      tollTotalsByCurrency,
      tollEstimateSemantics: {
        selection: "highest_fare_per_toll_and_currency",
        duplicateFareIdsCountedOnce: true,
        description:
          "HERE can return alternative fares for different payment methods. This estimate selects the highest available fare for each toll and currency, then counts repeated HERE fare IDs only once.",
      } as const,
    };
  });

  return {
    routes,
    vehicleEvaluation: {
      transportMode: truck ? "truck" : "car",
      actualHeightMeters: request.vehicle.heightMeters,
      submittedHeightMeters: request.vehicle.heightMeters + clearanceBuffer,
      clearanceBufferMeters: clearanceBuffer,
      dimensionsApplied: true,
      manualVerificationRequired: true,
      coverageMessage: `Entered vehicle dimensions were submitted to HERE ${truck ? "truck" : "car"} routing. Missing restriction data is not proof of clearance.`,
    },
  };
}

export class HereRoutingProvider {
  constructor(
    private readonly config: {
      apiKey?: string;
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async route(input: Omit<HereRouteRequest, "apiKey">): Promise<ProviderResult<HereRoutePlan>> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) {
      return unavailable({
        reason: "not_configured",
        message: "Routing is unavailable because the application owner has not configured HERE.",
        retryable: false,
        meta: {
          provider: "HERE Routing API v8",
          source: HERE_ROUTING_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "No provider request was made.",
          caveats: ["Users are never asked to supply provider credentials."],
        },
      });
    }

    let url: URL;
    try {
      url = buildHereRoutingUrl({ ...input, apiKey });
    } catch {
      return unavailable({
        reason: "provider_error",
        message: "The route request could not be created from the entered vehicle profile.",
        retryable: false,
        meta: {
          provider: "HERE Routing API v8",
          source: HERE_ROUTING_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "No provider request was made.",
          caveats: ["Review the entered coordinates and vehicle dimensions."],
        },
      });
    }

    const response = await safeFetchJson({
      provider: "HERE Routing API v8",
      source: HERE_ROUTING_SOURCE,
      url,
      parser: hereRoutingResponseSchema,
      timeoutMs: this.config.timeoutMs ?? 10_000,
      maximumAttempts: 3,
      coverage: "HERE road-network and restriction attributes available to the selected plan.",
      caveats: [
        "No route is guaranteed safe, legally permitted, or open.",
        "Verify official transportation sources, posted signs, rental guidance, and professional commercial routing.",
      ],
      fetchImplementation: this.config.fetchImplementation,
    });
    if (response.status === "unavailable") return response;
    if (response.data.routes.length === 0) {
      return unavailable({
        reason: "not_found",
        message: "HERE could not find a route for the entered locations and vehicle profile.",
        retryable: false,
        meta: {
          provider: "HERE Routing API v8",
          source: HERE_ROUTING_SOURCE,
          checkedAt: response.meta.retrievedAt,
          coverage: "No route alternative was returned.",
          caveats: [
            "Review waypoints and vehicle dimensions; do not reduce dimensions below the actual vehicle.",
          ],
        },
      });
    }
    try {
      return {
        ...response,
        data: parseHereRoutingResponse(response.data, input),
      };
    } catch {
      return unavailable({
        reason: "invalid_response",
        message: "HERE returned route geometry or restrictions in an unexpected format.",
        retryable: false,
        meta: {
          provider: "HERE Routing API v8",
          source: HERE_ROUTING_SOURCE,
          checkedAt: response.meta.retrievedAt,
          coverage: "The provider response could not be safely interpreted.",
          caveats: ["No route was presented as verified or usable."],
        },
      });
    }
  }
}
