import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  cacheKey,
  readProviderCache,
  writeProviderCache,
} from "@/lib/cache/provider-cache";
import {
  NwsWeatherProvider,
  type NwsPointWeather,
  type ProviderResult,
} from "@/lib/providers";
import {
  bearingDegrees,
  crosswindComponentMph,
  sampleTimedRoute,
  vehicleWindRiskThresholds,
  windRiskSeverity,
  type GeoPoint,
  type RouteTravelSchedule,
  type RouteWindProfile,
} from "@/lib/domain/weather";

function fahrenheitToCelsius(value: number) {
  return ((value - 32) * 5) / 9;
}

function temperatureC(value: number, unit: string) {
  return unit.toUpperCase() === "F" ? fahrenheitToCelsius(value) : value;
}

function mphToKph(value: number | null) {
  return value === null ? null : value * 1.609344;
}

function crosswindFor(
  weather: NwsPointWeather,
  routeSamples: ReturnType<typeof sampleTimedRoute>,
  index: number,
  windProfile?: RouteWindProfile,
) {
  const windSpeed =
    weather.gridConditions?.windGustMph ??
    weather.conditions.sustainedWindMph;
  const windFrom = weather.conditions.windFromDegrees;
  if (windSpeed === null || windFrom === null) return null;
  const from = routeSamples[Math.max(0, index - 1)];
  const to = routeSamples[Math.min(routeSamples.length - 1, index + 1)];
  if (!from || !to || (from.lat === to.lat && from.lng === to.lng)) return null;
  const component = crosswindComponentMph({
    windSpeedMph: windSpeed,
    windFromDegrees: windFrom,
    routeBearingDegrees: bearingDegrees(from, to),
  });
  return {
    componentMph: component,
    severity: windRiskSeverity(
      component,
      vehicleWindRiskThresholds(windProfile),
    ),
    source:
      "Move Atlas derived concern using NWS wind, route bearing, and the entered vehicle profile",
  };
}

export interface DerivedRouteWindRisk {
  sampleIndex: number;
  point: GeoPoint;
  expectedArrival: string;
  componentMph: number;
  severity: "low" | "moderate" | "high" | "severe";
  source: string;
}

export async function refreshRouteWeather(input: {
  userId: string;
  movePlanId: string;
  routePlanId: string;
  points: readonly GeoPoint[];
  departureTime: string;
  durationSeconds: number;
  travelSchedule?: RouteTravelSchedule;
  windProfile?: RouteWindProfile;
  force?: boolean;
}) {
  const routeSamples = sampleTimedRoute({
    points: input.points,
    departureTime: input.departureTime,
    totalDurationSeconds: input.durationSeconds,
    intervalMiles: 100,
    maximumSamples: 10,
    travelSchedule: input.travelSchedule,
  });
  const key = cacheKey({
    samples: routeSamples.map(({ lat, lng, expectedArrival }) => ({
      lat: Number(lat.toFixed(4)),
      lng: Number(lng.toFixed(4)),
      expectedArrival,
    })),
  });
  const cached = input.force
    ? null
    : await readProviderCache<ProviderResult<NwsPointWeather>[]>({
      provider: "National Weather Service",
      operation: "route-weather",
      key,
      userId: input.userId,
    });
  let results: ProviderResult<NwsPointWeather>[];
  let cacheState: "recently_updated" | "cached" | "stale";
  if (cached?.state === "cached") {
    results = cached.value;
    cacheState = "cached";
  } else {
    const refreshed = await new NwsWeatherProvider({
      userAgent: process.env.NWS_USER_AGENT,
    }).routeWeather(routeSamples, 3);
    const refreshedHasData = refreshed.some(
      (result) => result.status === "available",
    );
    const staleHasData = cached?.value.some(
      (result) => result.status === "available",
    );
    if (!refreshedHasData && cached?.state === "stale" && staleHasData) {
      results = cached.value;
      cacheState = "stale";
    } else {
      results = refreshed;
      cacheState = "recently_updated";
      await writeProviderCache({
        provider: "National Weather Service",
        operation: "route-weather",
        key,
        value: results,
        ttlSeconds: refreshedHasData ? 20 * 60 : 60,
        staleSeconds: refreshedHasData ? 2 * 60 * 60 : 4 * 60,
        userId: input.userId,
        movePlanId: input.movePlanId,
      });
    }
  }

  const windRisks: DerivedRouteWindRisk[] = results.flatMap(
    (result, index) => {
      if (result.status === "unavailable") return [];
      const risk = crosswindFor(
        result.data,
        routeSamples,
        index,
        input.windProfile,
      );
      if (!risk) return [];
      return [
        {
          sampleIndex: index,
          point: {
            lat: result.data.point.lat,
            lng: result.data.point.lng,
          },
          expectedArrival: result.data.expectedArrival,
          ...risk,
        },
      ];
    },
  );

  const admin = createAdminClient();
  if (!admin) {
    return {
      results,
      cacheState,
      windRisks,
      persistence: "unavailable" as const,
      persistenceMessage:
        "Weather was retrieved but could not be saved to this route.",
    };
  }
  const availableResults = results.filter(
    (
      result,
    ): result is Extract<
      ProviderResult<NwsPointWeather>,
      { status: "available" }
    > => result.status === "available",
  );
  const now = new Date();
  const status =
    availableResults.length === 0
      ? "unavailable"
      : availableResults.length === results.length
        ? "available"
        : "partial";
  const validTimes = availableResults
    .map((result) => Date.parse(result.data.conditions.endTime))
    .filter(Number.isFinite);
  const validUntil = validTimes.length
    ? new Date(Math.max(...validTimes)).toISOString()
    : null;
  const { data: snapshot, error: snapshotError } = await admin
    .from("route_weather_snapshots")
    .insert({
      user_id: input.userId,
      move_plan_id: input.movePlanId,
      route_plan_id: input.routePlanId,
      source_name: "National Weather Service",
      status,
      checked_at: now.toISOString(),
      stale_after: new Date(now.getTime() + 20 * 60 * 1_000).toISOString(),
      valid_until: validUntil,
      unavailable_reason:
        status === "unavailable"
          ? "National Weather Service forecast data is unavailable for the sampled route."
          : null,
      coverage_note:
        `ETA-aware ${cacheState.replaceAll("_", " ")} samples along the selected route; point sampling cannot prove that every route segment is unaffected.`,
    })
    .select("id")
    .single();
  if (snapshotError || !snapshot) {
    return {
      results,
      cacheState,
      windRisks,
      persistence: "unavailable" as const,
      persistenceMessage:
        "Weather was retrieved but could not be saved to this route.",
    };
  }

  const points = results.flatMap((result, index) => {
    if (result.status === "unavailable") return [];
    const weather = result.data;
    const crosswind = windRisks.find((risk) => risk.sampleIndex === index);
    return [
      {
        user_id: input.userId,
        move_plan_id: input.movePlanId,
        route_plan_id: input.routePlanId,
        weather_snapshot_id: snapshot.id,
        sample_order: index,
        route_distance_m: Math.round(
          routeSamples[index]?.cumulativeDistanceMeters ?? 0,
        ),
        latitude: weather.point.lat,
        longitude: weather.point.lng,
        expected_arrival_at: weather.expectedArrival,
        valid_from: weather.conditions.startTime,
        valid_until: weather.conditions.endTime,
        temperature_c: temperatureC(
          weather.conditions.temperature,
          weather.conditions.temperatureUnit,
        ),
        precipitation_probability:
          weather.gridConditions?.precipitationProbabilityPercent ??
          weather.conditions.precipitationProbabilityPercent,
        sustained_wind_kph: mphToKph(weather.conditions.sustainedWindMph),
        gust_wind_kph: mphToKph(weather.gridConditions?.windGustMph ?? null),
        wind_direction_degrees: weather.conditions.windFromDegrees,
        crosswind_severity: crosswind?.severity ?? "unavailable",
        visibility_m:
          weather.gridConditions?.visibilityMiles === null ||
          weather.gridConditions?.visibilityMiles === undefined
            ? null
            : Math.round(weather.gridConditions.visibilityMiles * 1_609.344),
        short_forecast: weather.conditions.condition,
        snow_or_ice_concern: Boolean(
          (weather.gridConditions?.snowfallInches ?? 0) > 0 ||
            (weather.gridConditions?.iceAccumulationInches ?? 0) > 0,
        ),
        source_forecast_url: null,
        issued_at: weather.forecastIssuedAt,
        retrieved_at: result.meta.retrievedAt,
      },
    ];
  });
  const { error: pointsError } = points.length
    ? await admin.from("route_weather_points").insert(points)
    : { error: null };

  const seenAlerts = new Set<string>();
  const alerts = results.flatMap((result, resultIndex) => {
    if (result.status === "unavailable") return [];
    return result.data.alerts.flatMap((alert) => {
      if (seenAlerts.has(alert.id)) return [];
      seenAlerts.add(alert.id);
      const sample = routeSamples[resultIndex];
      return [
        {
          user_id: input.userId,
          move_plan_id: input.movePlanId,
          route_plan_id: input.routePlanId,
          weather_snapshot_id: snapshot.id,
          provider_alert_id: alert.id,
          affected_segment_start: resultIndex,
          affected_segment_end: resultIndex,
          event_name: alert.event,
          severity: alert.severity,
          urgency: alert.urgency,
          certainty: alert.certainty,
          headline: alert.headline,
          description: alert.description,
          instruction: alert.instruction,
          affected_area: alert.areaDescription,
          sent_at: alert.sent,
          effective_at: alert.effective,
          onset_at: alert.onset,
          expires_at: alert.expires,
          ends_at: alert.ends,
          expected_user_arrival_at: sample?.expectedArrival ?? null,
          official_url:
            alert.officialUrl ??
            `https://api.weather.gov/alerts/${encodeURIComponent(alert.id)}`,
          retrieved_at: result.meta.retrievedAt,
        },
      ];
    });
  });
  const { error: alertsError } = alerts.length
    ? await admin.from("route_weather_alerts").insert(alerts)
    : { error: null };
  const persistence =
    pointsError || alertsError ? ("partial" as const) : ("saved" as const);
  return {
    results,
    cacheState,
    windRisks,
    persistence,
    persistenceMessage:
      persistence === "partial"
        ? "Some weather details could not be saved; the displayed provider response is still available for this session."
        : null,
  };
}
