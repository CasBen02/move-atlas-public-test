import { z } from "zod";

import type { GeoPoint, TimedRouteSample } from "../domain/weather";
import type { ProviderResult, ProviderUnavailable } from "./result";
import { unavailable } from "./result";
import { safeFetchJson } from "./safe-fetch";

export const NWS_SOURCE = "https://www.weather.gov/documentation/services-web-api";
const NWS_API = "https://api.weather.gov";

const nullableValueSchema = z.object({
  unitCode: z.string().optional(),
  value: z.number().nullable(),
});

export const nwsPointsResponseSchema = z
  .object({
    properties: z
      .object({
        gridId: z.string(),
        gridX: z.number().int(),
        gridY: z.number().int(),
        forecast: z.string().url().optional(),
        forecastHourly: z.string().url(),
        forecastGridData: z.string().url(),
        timeZone: z.string().optional(),
        county: z.string().url().optional(),
        forecastZone: z.string().url().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const hourlyPeriodSchema = z
  .object({
    number: z.number().int(),
    name: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    isDaytime: z.boolean(),
    temperature: z.number(),
    temperatureUnit: z.string(),
    temperatureTrend: z.string().nullable().optional(),
    probabilityOfPrecipitation: nullableValueSchema,
    dewpoint: nullableValueSchema.optional(),
    relativeHumidity: nullableValueSchema.optional(),
    windSpeed: z.string(),
    windDirection: z.string(),
    icon: z.string().optional(),
    shortForecast: z.string(),
    detailedForecast: z.string().optional(),
  })
  .passthrough();

export const nwsHourlyForecastSchema = z
  .object({
    properties: z
      .object({
        updated: z.string().optional(),
        generatedAt: z.string().optional(),
        periods: z.array(hourlyPeriodSchema),
      })
      .passthrough(),
  })
  .passthrough();

const gridValueSchema = z
  .object({
    validTime: z.string(),
    value: z.number().nullable(),
  })
  .passthrough();

const gridPropertySchema = z
  .object({
    uom: z.string().optional(),
    values: z.array(gridValueSchema),
  })
  .passthrough();

export const nwsGridForecastSchema = z
  .object({
    properties: z
      .object({
        updateTime: z.string().optional(),
        validTimes: z.string().optional(),
        windGust: gridPropertySchema.optional(),
        visibility: gridPropertySchema.optional(),
        snowfallAmount: gridPropertySchema.optional(),
        iceAccumulation: gridPropertySchema.optional(),
        probabilityOfPrecipitation: gridPropertySchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

const nwsAlertFeatureSchema = z
  .object({
    id: z.string(),
    properties: z
      .object({
        id: z.string().optional(),
        areaDesc: z.string(),
        sent: z.string().optional(),
        effective: z.string(),
        onset: z.string().nullable().optional(),
        expires: z.string(),
        ends: z.string().nullable().optional(),
        status: z.string().optional(),
        messageType: z.string().optional(),
        category: z.string().optional(),
        severity: z.string(),
        certainty: z.string(),
        urgency: z.string(),
        event: z.string(),
        response: z.string().optional(),
        headline: z.string().nullable().optional(),
        description: z.string(),
        instruction: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const nwsAlertsSchema = z
  .object({
    features: z.array(nwsAlertFeatureSchema),
  })
  .passthrough();

type HourlyResponse = z.infer<typeof nwsHourlyForecastSchema>;
type GridResponse = z.infer<typeof nwsGridForecastSchema>;
type AlertsResponse = z.infer<typeof nwsAlertsSchema>;
type HourlyPeriod = z.infer<typeof hourlyPeriodSchema>;

export interface NwsHourlyConditions {
  startTime: string;
  endTime: string;
  temperature: number;
  temperatureUnit: string;
  condition: string;
  precipitationProbabilityPercent: number | null;
  relativeHumidityPercent: number | null;
  sustainedWindMph: number | null;
  windSpeedRangeMph: { minimum: number; maximum: number } | null;
  windDirection: string;
  windFromDegrees: number | null;
  detailedForecast: string | null;
}

export interface NwsGridConditions {
  windGustMph: number | null;
  visibilityMiles: number | null;
  snowfallInches: number | null;
  iceAccumulationInches: number | null;
  precipitationProbabilityPercent: number | null;
}

export interface NwsAlert {
  id: string;
  event: string;
  areaDescription: string;
  severity: string;
  urgency: string;
  certainty: string;
  sent: string | null;
  effective: string;
  onset: string | null;
  expires: string;
  ends: string | null;
  headline: string | null;
  description: string;
  instruction: string | null;
  officialUrl: string | null;
}

export interface NwsPointWeather {
  point: { lat: number; lng: number };
  expectedArrival: string;
  forecastIssuedAt: string | null;
  conditions: NwsHourlyConditions;
  gridConditions: NwsGridConditions | null;
  alerts: NwsAlert[];
  componentAvailability: {
    hourly: "available";
    grid: "available" | "unavailable";
    alerts: "available" | "unavailable";
  };
  componentFailures: ProviderUnavailable[];
}

const DIRECTION_DEGREES: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

export function parseWindSpeedMph(
  value: string,
): { minimum: number; maximum: number } | null {
  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (numbers.length === 0) return null;
  const unit = value.toLowerCase();
  const multiplier = unit.includes("km/h") || unit.includes("kmh") ? 0.621371 : unit.includes("m/s") ? 2.23694 : 1;
  const converted = numbers.map((number) => number * multiplier);
  return {
    minimum: Math.min(...converted),
    maximum: Math.max(...converted),
  };
}

export function selectHourlyConditions(
  raw: unknown,
  expectedArrival: string,
): { conditions: NwsHourlyConditions; issuedAt: string | null } {
  const parsed: HourlyResponse = nwsHourlyForecastSchema.parse(raw);
  const target = Date.parse(expectedArrival);
  if (!Number.isFinite(target)) throw new RangeError("Expected arrival must be valid.");
  const selected: HourlyPeriod | undefined = parsed.properties.periods.find((period) => {
    const start = Date.parse(period.startTime);
    const end = Date.parse(period.endTime);
    return Number.isFinite(start) && Number.isFinite(end) && target >= start && target < end;
  });
  if (!selected) {
    throw new RangeError(
      parsed.properties.periods.length === 0
        ? "NWS hourly forecast contained no periods."
        : "Expected arrival is outside the available NWS hourly forecast periods.",
    );
  }
  const range = parseWindSpeedMph(selected.windSpeed);
  return {
    conditions: {
      startTime: selected.startTime,
      endTime: selected.endTime,
      temperature: selected.temperature,
      temperatureUnit: selected.temperatureUnit,
      condition: selected.shortForecast,
      precipitationProbabilityPercent: selected.probabilityOfPrecipitation.value,
      relativeHumidityPercent: selected.relativeHumidity?.value ?? null,
      sustainedWindMph: range?.maximum ?? null,
      windSpeedRangeMph: range,
      windDirection: selected.windDirection,
      windFromDegrees: DIRECTION_DEGREES[selected.windDirection.toUpperCase()] ?? null,
      detailedForecast: selected.detailedForecast ?? null,
    },
    issuedAt: parsed.properties.updated ?? parsed.properties.generatedAt ?? null,
  };
}

function durationMilliseconds(value: string): number | null {
  const match = value.match(
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return null;
  return (
    (Number(match[1] ?? 0) * 86_400 +
      Number(match[2] ?? 0) * 3_600 +
      Number(match[3] ?? 0) * 60 +
      Number(match[4] ?? 0)) *
    1_000
  );
}

function gridValueAt(
  property: z.infer<typeof gridPropertySchema> | undefined,
  targetTime: number,
): { value: number; uom: string } | null {
  if (!property) return null;
  for (const item of property.values) {
    if (item.value === null) continue;
    const [startText, durationText] = item.validTime.split("/");
    const start = Date.parse(startText);
    const duration = durationText ? durationMilliseconds(durationText) : null;
    if (Number.isFinite(start) && duration !== null && targetTime >= start && targetTime < start + duration) {
      return { value: item.value, uom: property.uom ?? "" };
    }
  }
  return null;
}

function speedToMph(value: number, unit: string): number {
  if (unit.includes("km_h-1") || unit.includes("km/h")) return value * 0.621371;
  if (unit.includes("m_s-1") || unit.includes("m/s")) return value * 2.23694;
  return value;
}

function distanceToMiles(value: number, unit: string): number {
  if (unit.endsWith(":m") || unit === "m") return value / 1_609.344;
  if (unit.includes("km")) return value * 0.621371;
  return value;
}

function accumulationToInches(value: number, unit: string): number {
  if (unit.includes("mm")) return value / 25.4;
  if (unit.includes("cm")) return value / 2.54;
  if (unit.endsWith(":m") || unit === "m") return value * 39.3701;
  return value;
}

export function selectGridConditions(raw: unknown, expectedArrival: string): NwsGridConditions {
  const parsed: GridResponse = nwsGridForecastSchema.parse(raw);
  const target = Date.parse(expectedArrival);
  if (!Number.isFinite(target)) throw new RangeError("Expected arrival must be valid.");
  const wind = gridValueAt(parsed.properties.windGust, target);
  const visibility = gridValueAt(parsed.properties.visibility, target);
  const snow = gridValueAt(parsed.properties.snowfallAmount, target);
  const ice = gridValueAt(parsed.properties.iceAccumulation, target);
  const precipitation = gridValueAt(parsed.properties.probabilityOfPrecipitation, target);
  return {
    windGustMph: wind ? speedToMph(wind.value, wind.uom) : null,
    visibilityMiles: visibility ? distanceToMiles(visibility.value, visibility.uom) : null,
    snowfallInches: snow ? accumulationToInches(snow.value, snow.uom) : null,
    iceAccumulationInches: ice ? accumulationToInches(ice.value, ice.uom) : null,
    precipitationProbabilityPercent: precipitation?.value ?? null,
  };
}

function safeOfficialAlertUrl(id: string): string | null {
  try {
    const url = new URL(id);
    return url.protocol === "https:" && url.hostname === "api.weather.gov" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseNwsAlerts(raw: unknown): NwsAlert[] {
  const parsed: AlertsResponse = nwsAlertsSchema.parse(raw);
  return parsed.features.map((feature) => ({
    id: feature.properties.id ?? feature.id,
    event: feature.properties.event,
    areaDescription: feature.properties.areaDesc,
    severity: feature.properties.severity,
    urgency: feature.properties.urgency,
    certainty: feature.properties.certainty,
    sent: feature.properties.sent ?? null,
    effective: feature.properties.effective,
    onset: feature.properties.onset ?? null,
    expires: feature.properties.expires,
    ends: feature.properties.ends ?? null,
    headline: feature.properties.headline ?? null,
    description: feature.properties.description,
    instruction: feature.properties.instruction ?? null,
    officialUrl: safeOfficialAlertUrl(feature.id),
  }));
}

function nwsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.weather.gov") {
    throw new Error("NWS response referenced an unexpected host.");
  }
  return url;
}

export class NwsWeatherProvider {
  constructor(
    private readonly config: {
      userAgent?: string;
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  private headers(): HeadersInit | null {
    const userAgent = this.config.userAgent?.trim();
    if (
      !userAgent ||
      !/(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\/\S+)/.test(userAgent)
    ) {
      return null;
    }
    return {
      "user-agent": userAgent,
      accept: "application/geo+json",
    };
  }

  /**
   * Lightweight active-alert lookup for the approximately 60-second alert
   * polling loop. It intentionally does not resolve gridpoints or fetch forecast
   * products.
   */
  async activeAlerts(point: GeoPoint): Promise<ProviderResult<NwsAlert[]>> {
    const headers = this.headers();
    if (!headers) {
      return unavailable({
        reason: "not_configured",
        message: "Weather alerts are unavailable because the application owner has not configured the NWS contact identifier.",
        retryable: false,
        meta: {
          provider: "National Weather Service alerts",
          source: NWS_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "No provider request was made.",
          caveats: ["NWS coverage is limited to the United States and its territories."],
        },
      });
    }
    if (
      !Number.isFinite(point.lat) ||
      point.lat < -90 ||
      point.lat > 90 ||
      !Number.isFinite(point.lng) ||
      point.lng < -180 ||
      point.lng > 180
    ) {
      return unavailable({
        reason: "provider_error",
        message: "Weather-alert coordinates are invalid.",
        retryable: false,
        meta: {
          provider: "National Weather Service alerts",
          source: NWS_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "No provider request was made.",
          caveats: [],
        },
      });
    }

    const url = new URL("/alerts/active", NWS_API);
    url.searchParams.set("point", `${point.lat},${point.lng}`);
    const response = await safeFetchJson({
      provider: "National Weather Service alerts",
      source: NWS_SOURCE,
      url,
      init: { headers },
      parser: nwsAlertsSchema,
      timeoutMs: this.config.timeoutMs ?? 8_000,
      maximumAttempts: 2,
      coverage: "Active NWS alerts returned for the selected U.S. point.",
      caveats: [
        "An absence of active alerts is not a guarantee of safe travel conditions.",
        "Follow official alerts, transportation-agency restrictions, and road closures.",
      ],
      fetchImplementation: this.config.fetchImplementation,
    });
    if (response.status === "unavailable") return response;
    return {
      ...response,
      data: parseNwsAlerts(response.data),
    };
  }

  async pointWeather(sample: TimedRouteSample): Promise<ProviderResult<NwsPointWeather>> {
    const headers = this.headers();
    if (!headers) {
      return unavailable({
        reason: "not_configured",
        message: "Weather is unavailable because the application owner has not configured the NWS contact identifier.",
        retryable: false,
        meta: {
          provider: "National Weather Service",
          source: NWS_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "No provider request was made.",
          caveats: ["NWS coverage is limited to the United States and its territories."],
        },
      });
    }
    const pointUrl = new URL(`/points/${sample.lat.toFixed(4)},${sample.lng.toFixed(4)}`, NWS_API);
    const point = await safeFetchJson({
      provider: "National Weather Service",
      source: NWS_SOURCE,
      url: pointUrl,
      init: { headers },
      parser: nwsPointsResponseSchema,
      timeoutMs: this.config.timeoutMs ?? 8_000,
      maximumAttempts: 3,
      coverage: "NWS forecast grid covering this U.S. route point.",
      caveats: ["Forecasts and alerts can change; follow official warnings and road closures."],
      fetchImplementation: this.config.fetchImplementation,
    });
    if (point.status === "unavailable") {
      if (point.reason === "not_found") {
        return {
          ...point,
          reason: "unsupported_location",
          message: "National Weather Service forecast coverage is unavailable at this point.",
        };
      }
      return point;
    }

    let hourlyUrl: URL;
    let gridUrl: URL;
    try {
      hourlyUrl = nwsUrl(point.data.properties.forecastHourly);
      gridUrl = nwsUrl(point.data.properties.forecastGridData);
    } catch {
      return unavailable({
        reason: "invalid_response",
        message: "The National Weather Service returned an unexpected forecast link.",
        retryable: false,
        meta: {
          provider: "National Weather Service",
          source: NWS_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "The forecast-grid location was resolved, but forecast links were rejected.",
          caveats: [],
        },
      });
    }
    const alertsUrl = new URL("/alerts/active", NWS_API);
    alertsUrl.searchParams.set("point", `${sample.lat},${sample.lng}`);

    const [hourly, grid, alerts] = await Promise.all([
      safeFetchJson({
        provider: "National Weather Service hourly forecast",
        source: NWS_SOURCE,
        url: hourlyUrl,
        init: { headers },
        parser: nwsHourlyForecastSchema,
        timeoutMs: this.config.timeoutMs ?? 8_000,
        maximumAttempts: 3,
        coverage: "Hourly forecast period covering the expected route arrival.",
        caveats: [],
        fetchImplementation: this.config.fetchImplementation,
      }),
      safeFetchJson({
        provider: "National Weather Service digital forecast",
        source: NWS_SOURCE,
        url: gridUrl,
        init: { headers },
        parser: nwsGridForecastSchema,
        timeoutMs: this.config.timeoutMs ?? 8_000,
        maximumAttempts: 2,
        coverage: "NWS grid values available for this route point and time.",
        caveats: [],
        fetchImplementation: this.config.fetchImplementation,
      }),
      safeFetchJson({
        provider: "National Weather Service alerts",
        source: NWS_SOURCE,
        url: alertsUrl,
        init: { headers },
        parser: nwsAlertsSchema,
        timeoutMs: this.config.timeoutMs ?? 8_000,
        maximumAttempts: 2,
        coverage: "Active NWS alerts returned for this route point.",
        caveats: ["An absence of active alerts is not a guarantee of safe travel conditions."],
        fetchImplementation: this.config.fetchImplementation,
      }),
    ]);
    if (hourly.status === "unavailable") return hourly;

    let selected;
    try {
      selected = selectHourlyConditions(hourly.data, sample.expectedArrival);
    } catch {
      return unavailable({
        reason: "insufficient_coverage",
        message: "No hourly NWS period could be matched to the expected route arrival.",
        retryable: true,
        meta: {
          provider: "National Weather Service",
          source: NWS_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "Forecast horizon did not cover the expected arrival time.",
          caveats: ["Refresh closer to departure or after changing the itinerary."],
        },
      });
    }

    const failures = [grid, alerts].filter(
      (result): result is ProviderUnavailable => result.status === "unavailable",
    );
    return {
      status: "available",
      data: {
        point: { lat: sample.lat, lng: sample.lng },
        expectedArrival: sample.expectedArrival,
        forecastIssuedAt: selected.issuedAt,
        conditions: selected.conditions,
        gridConditions:
          grid.status === "available"
            ? selectGridConditions(grid.data, sample.expectedArrival)
            : null,
        alerts: alerts.status === "available" ? parseNwsAlerts(alerts.data) : [],
        componentAvailability: {
          hourly: "available",
          grid: grid.status,
          alerts: alerts.status,
        },
        componentFailures: failures,
      },
      meta: {
        provider: "National Weather Service",
        source: NWS_SOURCE,
        retrievedAt: hourly.meta.retrievedAt,
        observedAt: selected.issuedAt ?? undefined,
        validFrom: selected.conditions.startTime,
        validUntil: selected.conditions.endTime,
        freshness: "recently_updated",
        coverage: "U.S. forecast grid and active alerts for the sampled route point.",
        caveats: [
          "Forecast conditions are decision support, not a safety guarantee.",
          ...failures.map((failure) => failure.message),
        ],
      },
    };
  }

  async routeWeather(
    samples: readonly TimedRouteSample[],
    concurrency = 3,
  ): Promise<ProviderResult<NwsPointWeather>[]> {
    const results: ProviderResult<NwsPointWeather>[] = new Array(samples.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < samples.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await this.pointWeather(samples[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, 4)) }, () => worker()),
    );
    return results;
  }
}
