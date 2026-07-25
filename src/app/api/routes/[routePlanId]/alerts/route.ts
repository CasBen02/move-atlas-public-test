import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  cacheKey,
  readProviderCache,
  writeProviderCache,
} from "@/lib/cache/provider-cache";
import { decodeHereFlexiblePolyline } from "@/lib/domain/polyline";
import { sampleTimedRoute, type TimedRouteSample } from "@/lib/domain/weather";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import {
  NwsWeatherProvider,
  type NwsAlert,
  type ProviderResult,
} from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

const summarySchema = z
  .object({
    sectionPolylines: z.array(z.string().min(1).max(5_000_000)).min(1).max(100),
    travelSchedule: z
      .object({
        maxDrivingHoursPerDay: z.number().positive().max(24),
        stopFrequencyHours: z.number().positive().max(8),
        children: z.boolean().optional(),
        pets: z.boolean().optional(),
        minutesPerBreak: z.number().positive().max(240).optional(),
        overnightRestHours: z.number().positive().max(24).optional(),
      })
      .optional(),
  })
  .passthrough();

const allowedSeverity = new Set([
  "Extreme",
  "Severe",
  "Moderate",
  "Minor",
  "Unknown",
]);
const allowedUrgency = new Set([
  "Immediate",
  "Expected",
  "Future",
  "Past",
  "Unknown",
]);
const allowedCertainty = new Set([
  "Observed",
  "Likely",
  "Possible",
  "Unlikely",
  "Unknown",
]);

function enumOrUnknown(value: string, allowed: Set<string>) {
  return allowed.has(value) ? value : "Unknown";
}

function arrivalOverlapsAlert(alert: NwsAlert, arrivals: string[]) {
  const start = Date.parse(alert.onset ?? alert.effective);
  const end = Date.parse(alert.ends ?? alert.expires);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return arrivals.some((arrival) => {
    const value = Date.parse(arrival);
    return Number.isFinite(value) && value >= start && value <= end;
  });
}

function routeSamples(input: {
  summary: unknown;
  departureTime: string;
  durationSeconds: number;
}) {
  const summary = summarySchema.parse(input.summary);
  const points: { lat: number; lng: number }[] = [];
  for (const encoded of summary.sectionPolylines) {
    const decoded = decodeHereFlexiblePolyline(encoded, {
      maximumPoints: 100_000,
    }).points;
    for (const point of decoded) {
      const previous = points.at(-1);
      if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) {
        points.push({ lat: point.lat, lng: point.lng });
      }
      if (points.length > 250_000) {
        throw new RangeError("Saved route geometry is too large.");
      }
    }
  }
  return sampleTimedRoute({
    points,
    departureTime: input.departureTime,
    totalDurationSeconds: input.durationSeconds,
    intervalMiles: 200,
    maximumSamples: 6,
    travelSchedule: summary.travelSchedule,
  });
}

async function refreshPointAlerts(input: {
  provider: NwsWeatherProvider;
  sample: TimedRouteSample;
  userId: string;
  movePlanId: string;
}) {
  const point = {
    lat: Number(input.sample.lat.toFixed(4)),
    lng: Number(input.sample.lng.toFixed(4)),
  };
  const key = cacheKey(point);
  const cached = await readProviderCache<ProviderResult<NwsAlert[]>>({
    provider: "National Weather Service alerts",
    operation: "active-route-alerts",
    key,
    userId: input.userId,
  });
  if (cached) {
    return cached.value.status === "available"
      ? {
          ...cached.value,
          meta: { ...cached.value.meta, freshness: cached.state },
        }
      : cached.value;
  }
  const result = await input.provider.activeAlerts(point);
  await writeProviderCache({
    provider: "National Weather Service alerts",
    operation: "active-route-alerts",
    key,
    value: result,
    ttlSeconds: 45,
    staleSeconds: 15,
    userId: input.userId,
    movePlanId: input.movePlanId,
    sourceIssuedAt:
      result.status === "available" ? result.meta.observedAt ?? null : null,
  });
  return result;
}

async function refreshWithConcurrency(input: {
  provider: NwsWeatherProvider;
  samples: TimedRouteSample[];
  userId: string;
  movePlanId: string;
}) {
  const results: ProviderResult<NwsAlert[]>[] = new Array(input.samples.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < input.samples.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await refreshPointAlerts({
        provider: input.provider,
        sample: input.samples[index],
        userId: input.userId,
        movePlanId: input.movePlanId,
      });
    }
  };
  await Promise.all(Array.from({ length: 3 }, () => worker()));
  return results;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ routePlanId: string }> },
) {
  const auth = await authorizeApiRequest(request, { limit: 20 });
  if (!auth.ok) return auth.response;
  const { routePlanId } = await params;
  if (!z.uuid().safeParse(routePlanId).success) {
    return noStoreJson({ error: "Saved route not found." }, { status: 404 });
  }
  const { data: route } = await auth.supabase
    .from("saved_route_plans")
    .select("id,move_plan_id,summary,planned_departure_at,duration_seconds")
    .eq("id", routePlanId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!route) {
    return noStoreJson({ error: "Saved route not found." }, { status: 404 });
  }
  if (!route.duration_seconds || !route.planned_departure_at) {
    return noStoreJson(
      {
        status: "unavailable",
        message: "This saved route does not contain enough timing data to refresh alerts.",
      },
      { status: 422 },
    );
  }

  let samples: TimedRouteSample[];
  try {
    samples = routeSamples({
      summary: route.summary,
      departureTime: route.planned_departure_at,
      durationSeconds: route.duration_seconds,
    });
  } catch {
    return noStoreJson(
      {
        status: "unavailable",
        message: "This saved route does not contain usable route geometry for alert checks.",
      },
      { status: 422 },
    );
  }

  const checkedAt = new Date().toISOString();
  const results = await refreshWithConcurrency({
    provider: new NwsWeatherProvider({ userAgent: process.env.NWS_USER_AGENT }),
    samples,
    userId: auth.user.id,
    movePlanId: route.move_plan_id,
  });
  const availableCount = results.filter(
    (result) => result.status === "available",
  ).length;
  if (availableCount === 0) {
    const firstFailure = results.find(
      (result) => result.status === "unavailable",
    );
    return noStoreJson(
      {
        status: "unavailable",
        checkedAt,
        source: "National Weather Service",
        message:
          firstFailure?.status === "unavailable"
            ? firstFailure.message
            : "Active NWS alerts are temporarily unavailable.",
        samples: results,
      },
      { status: firstFailure?.status === "unavailable" && firstFailure.retryable ? 503 : 422 },
    );
  }

  const alertsById = new Map<
    string,
    {
      alert: NwsAlert;
      affectedSampleIndexes: number[];
      expectedArrivals: string[];
      retrievedAt: string;
    }
  >();
  results.forEach((result, index) => {
    if (result.status === "unavailable") return;
    for (const alert of result.data) {
      const existing = alertsById.get(alert.id);
      if (existing) {
        existing.affectedSampleIndexes.push(index);
        existing.expectedArrivals.push(samples[index].expectedArrival);
      } else {
        alertsById.set(alert.id, {
          alert,
          affectedSampleIndexes: [index],
          expectedArrivals: [samples[index].expectedArrival],
          retrievedAt: result.meta.retrievedAt,
        });
      }
    }
  });
  const activeAlerts = [...alertsById.values()].map((item) => ({
    ...item,
    arrivalWindowMatch: arrivalOverlapsAlert(
      item.alert,
      item.expectedArrivals,
    ),
  }));

  const admin = createAdminClient();
  if (admin && activeAlerts.length) {
    const { data: snapshot } = await admin
      .from("route_weather_snapshots")
      .select("id")
      .eq("route_plan_id", route.id)
      .eq("user_id", auth.user.id)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshot) {
      const rows = activeAlerts.flatMap((item) => {
        if (!item.alert.officialUrl) return [];
        return [
          {
            user_id: auth.user.id,
            move_plan_id: route.move_plan_id,
            route_plan_id: route.id,
            weather_snapshot_id: snapshot.id,
            provider_alert_id: item.alert.id,
            affected_segment_start: Math.min(...item.affectedSampleIndexes),
            affected_segment_end: Math.max(...item.affectedSampleIndexes),
            event_name: item.alert.event,
            severity: enumOrUnknown(item.alert.severity, allowedSeverity),
            urgency: enumOrUnknown(item.alert.urgency, allowedUrgency),
            certainty: enumOrUnknown(item.alert.certainty, allowedCertainty),
            headline: item.alert.headline,
            description: item.alert.description,
            instruction: item.alert.instruction,
            affected_area: item.alert.areaDescription,
            sent_at: item.alert.sent,
            effective_at: item.alert.effective,
            onset_at: item.alert.onset,
            expires_at: item.alert.expires,
            ends_at: item.alert.ends,
            expected_user_arrival_at: item.expectedArrivals[0],
            official_url: item.alert.officialUrl,
            retrieved_at: item.retrievedAt,
          },
        ];
      });
      if (rows.length) {
        await admin
          .from("route_weather_alerts")
          .upsert(rows, {
            onConflict: "weather_snapshot_id,provider_alert_id",
          });
      }
    }
  }

  return noStoreJson({
    status: "available",
    source: "National Weather Service",
    sourceUrl: "https://www.weather.gov/documentation/services-web-api",
    checkedAt,
    coverage:
      "Active NWS alerts checked at sampled points along the saved U.S. route; point sampling cannot prove every segment is unaffected.",
    freshness:
      results.some(
        (result) =>
          result.status === "available" && result.meta.freshness === "stale",
      )
        ? "stale"
        : results.some(
              (result) =>
                result.status === "available" &&
                result.meta.freshness === "cached",
            )
          ? "cached"
          : "recently_updated",
    partial: availableCount !== results.length,
    sampleCount: samples.length,
    availableSampleCount: availableCount,
    alerts: activeAlerts,
  });
}
