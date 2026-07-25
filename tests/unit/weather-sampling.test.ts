import { describe, expect, it } from "vitest";

import {
  crosswindComponentMph,
  sampleTimedRoute,
  scheduledElapsedSeconds,
  vehicleWindRiskThresholds,
  windRiskSeverity,
} from "../../src/lib/domain/weather";

describe("route weather sampling", () => {
  it("includes the origin and destination with time-aligned arrivals", () => {
    const samples = sampleTimedRoute({
      points: [
        { lat: 41.8781, lng: -87.6298 },
        { lat: 41.0, lng: -90.0 },
        { lat: 39.7392, lng: -104.9903 },
      ],
      departureTime: "2026-08-01T12:00:00Z",
      totalDurationSeconds: 36_000,
      intervalMiles: 150,
      maximumSamples: 8,
    });
    expect(samples[0].routePointIndex).toBe(0);
    expect(samples.at(-1)?.routePointIndex).toBe(2);
    expect(samples.at(-1)?.expectedArrival).toBe("2026-08-01T22:00:00.000Z");
  });

  it("computes vehicle-relevant crosswind without making a safety guarantee", () => {
    expect(
      crosswindComponentMph({
        windSpeedMph: 30,
        windFromDegrees: 90,
        routeBearingDegrees: 0,
      }),
    ).toBeCloseTo(30);
    expect(windRiskSeverity(30)).toBe("high");
  });

  it("includes household breaks and overnights in later route ETAs", () => {
    const schedule = {
      maxDrivingHoursPerDay: 8,
      stopFrequencyHours: 2,
      children: true,
      pets: false,
    };
    expect(scheduledElapsedSeconds(8 * 3_600, schedule)).toBe(
      8 * 3_600 + 3 * 30 * 60,
    );
    expect(scheduledElapsedSeconds(9 * 3_600, schedule)).toBe(
      9 * 3_600 + 3 * 30 * 60 + 12 * 3_600,
    );

    const samples = sampleTimedRoute({
      points: [
        { lat: 30.2672, lng: -97.7431, cumulativeDurationSeconds: 0 },
        {
          lat: 32.7767,
          lng: -96.797,
          cumulativeDurationSeconds: 9 * 3_600,
        },
      ],
      departureTime: "2026-08-01T12:00:00Z",
      totalDurationSeconds: 9 * 3_600,
      travelSchedule: schedule,
    });
    expect(samples.at(-1)?.expectedArrival).toBe(
      "2026-08-02T10:30:00.000Z",
    );
  });

  it("uses lower concern thresholds for lightly loaded high-profile vehicles", () => {
    expect(
      vehicleWindRiskThresholds({
        vehicleCategory: "moving_truck",
        loadedStatus: "lightly_loaded",
        trailerEnabled: false,
      }),
    ).toEqual({ moderate: 12, high: 20, severe: 30 });
    expect(
      vehicleWindRiskThresholds({
        vehicleCategory: "passenger_car",
        loadedStatus: "loaded",
        trailerEnabled: false,
      }),
    ).toEqual({ moderate: 20, high: 30, severe: 45 });
  });
});
