import { describe, expect, it, vi } from "vitest";

import {
  NwsWeatherProvider,
  parseNwsAlerts,
  parseWindSpeedMph,
  selectGridConditions,
  selectHourlyConditions,
} from "../../src/lib/providers/nws";
import alertsFixture from "./fixtures/nws-alerts.json";
import gridFixture from "./fixtures/nws-grid.json";
import hourlyFixture from "./fixtures/nws-hourly.json";

describe("National Weather Service parsing", () => {
  it("selects the forecast period covering expected route arrival", () => {
    const result = selectHourlyConditions(hourlyFixture, "2026-08-01T13:30:00Z");
    expect(result.issuedAt).toBe("2026-08-01T10:00:00Z");
    expect(result.conditions).toMatchObject({
      temperature: 82,
      temperatureUnit: "F",
      condition: "Chance Thunderstorms",
      precipitationProbabilityPercent: 35,
      relativeHumidityPercent: 61,
      sustainedWindMph: 18,
      windDirection: "SW",
      windFromDegrees: 225,
    });
  });

  it("does not substitute a nearest period outside forecast coverage", () => {
    expect(() =>
      selectHourlyConditions(hourlyFixture, "2026-08-01T12:59:59Z"),
    ).toThrow(/outside the available NWS hourly forecast periods/i);
    expect(() =>
      selectHourlyConditions(hourlyFixture, "2026-08-01T15:00:00Z"),
    ).toThrow(/outside the available NWS hourly forecast periods/i);
  });

  it("requires a period that actually covers arrival, including forecast gaps", () => {
    const forecastWithGap = structuredClone(hourlyFixture);
    forecastWithGap.properties.periods[1].startTime = "2026-08-01T15:00:00Z";
    forecastWithGap.properties.periods[1].endTime = "2026-08-01T16:00:00Z";

    expect(() =>
      selectHourlyConditions(forecastWithGap, "2026-08-01T14:30:00Z"),
    ).toThrow(/outside the available NWS hourly forecast periods/i);
    expect(
      selectHourlyConditions(hourlyFixture, "2026-08-01T14:00:00Z").conditions
        .temperature,
    ).toBe(83);
  });

  it("parses common NWS wind ranges", () => {
    expect(parseWindSpeedMph("5 to 10 mph")).toEqual({ minimum: 5, maximum: 10 });
    expect(parseWindSpeedMph("20 mph")).toEqual({ minimum: 20, maximum: 20 });
    expect(parseWindSpeedMph("Calm")).toBeNull();
  });

  it("selects and converts digital forecast grid values", () => {
    const result = selectGridConditions(gridFixture, "2026-08-01T13:30:00Z");
    expect(result.windGustMph).toBeCloseTo(40, 3);
    expect(result.visibilityMiles).toBeCloseTo(1, 5);
    expect(result.snowfallInches).toBeCloseTo(1, 5);
    expect(result.iceAccumulationInches).toBeCloseTo(0.1, 5);
    expect(result.precipitationProbabilityPercent).toBe(65);
  });

  it("preserves official alert facts and source URL", () => {
    const alerts = parseNwsAlerts(alertsFixture);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      event: "Severe Thunderstorm Warning",
      severity: "Severe",
      urgency: "Immediate",
      certainty: "Likely",
      sent: "2026-08-01T11:00:00Z",
      officialUrl: "https://api.weather.gov/alerts/urn:oid:example",
    });
    expect(alerts[0].description).toBe("Official example alert description.");
  });
});

describe("National Weather Service forecast coverage", () => {
  it("returns a structured unavailable result when arrival is beyond the forecast horizon", async () => {
    const pointsResponse = {
      properties: {
        gridId: "LOT",
        gridX: 75,
        gridY: 73,
        forecastHourly:
          "https://api.weather.gov/gridpoints/LOT/75,73/forecast/hourly",
        forecastGridData: "https://api.weather.gov/gridpoints/LOT/75,73",
      },
    };
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.startsWith("/points/")) {
        return new Response(JSON.stringify(pointsResponse), { status: 200 });
      }
      if (url.pathname.endsWith("/forecast/hourly")) {
        return new Response(JSON.stringify(hourlyFixture), { status: 200 });
      }
      if (url.pathname === "/gridpoints/LOT/75,73") {
        return new Response(JSON.stringify(gridFixture), { status: 200 });
      }
      if (url.pathname === "/alerts/active") {
        return new Response(JSON.stringify(alertsFixture), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const provider = new NwsWeatherProvider({
      userAgent: "Move Atlas (support@example.com)",
      fetchImplementation,
    });

    const result = await provider.pointWeather({
      lat: 41.8781,
      lng: -87.6298,
      expectedArrival: "2026-08-10T13:30:00Z",
      routePointIndex: 1,
      cumulativeDistanceMeters: 50_000,
      cumulativeDurationSeconds: 3_600,
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("insufficient_coverage");
      expect(result.meta.coverage).toContain("did not cover");
    }
  });
});

describe("National Weather Service active-alert polling", () => {
  it("fetches only active alerts with the identifying application User-Agent", async () => {
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        expect(url.pathname).toBe("/alerts/active");
        expect(url.searchParams.get("point")).toBe("41.8781,-87.6298");
        expect(new Headers(init?.headers).get("user-agent")).toBe(
          "Move Atlas (support@example.com)",
        );
        return new Response(JSON.stringify(alertsFixture), { status: 200 });
      },
    ) as unknown as typeof fetch;
    const provider = new NwsWeatherProvider({
      userAgent: "Move Atlas (support@example.com)",
      fetchImplementation,
    });
    const result = await provider.activeAlerts({ lat: 41.8781, lng: -87.6298 });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.data[0].event).toBe("Severe Thunderstorm Warning");
      expect(result.meta.provider).toBe("National Weather Service alerts");
      expect(result.meta.coverage).toContain("Active NWS alerts");
    }
  });

  it("does not make a request when the operator contact identifier is missing", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const provider = new NwsWeatherProvider({ fetchImplementation });
    const result = await provider.activeAlerts({ lat: 41.8781, lng: -87.6298 });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("not_configured");
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("accepts an HTTPS operator contact identifier", async () => {
    const fetchImplementation = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("user-agent")).toBe(
          "Move Atlas (https://move-atlas.example/support)",
        );
        return new Response(JSON.stringify(alertsFixture), { status: 200 });
      },
    ) as unknown as typeof fetch;
    const provider = new NwsWeatherProvider({
      userAgent: "Move Atlas (https://move-atlas.example/support)",
      fetchImplementation,
    });
    const result = await provider.activeAlerts({ lat: 41.8781, lng: -87.6298 });
    expect(result.status).toBe("available");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
