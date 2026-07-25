import { describe, expect, it } from "vitest";

import {
  buildEstimatedItinerary,
  itineraryDistanceMiles,
} from "../../src/lib/domain/itinerary";

describe("estimated multi-day itinerary", () => {
  it("splits real route distance and duration at the preferred daily limit", () => {
    const itinerary = buildEstimatedItinerary({
      distanceMeters: 1_200 * 1_609.344,
      durationSeconds: 20 * 3_600,
      departureTime: "2026-08-01T13:00:00.000Z",
      maxDrivingHoursPerDay: 8,
      stopFrequencyHours: 2,
      expectedFuelStops: 4,
      children: true,
      pets: true,
      drivers: 2,
    });

    expect(itinerary.days).toHaveLength(3);
    expect(itinerary.days.map((day) => day.drivingSeconds / 3_600)).toEqual([
      8, 8, 4,
    ]);
    expect(
      itinerary.days.reduce((sum, day) => sum + itineraryDistanceMiles(day), 0),
    ).toBeCloseTo(1_200);
    expect(itinerary.days.reduce((sum, day) => sum + day.fuelStops, 0)).toBe(4);
    expect(itinerary.days[0].restBreaks).toBe(3);
    expect(itinerary.assumptions.hotelLocationsSelected).toBe(false);
  });

  it("keeps a short route to one day without inventing overnight stops", () => {
    const itinerary = buildEstimatedItinerary({
      distanceMeters: 240 * 1_609.344,
      durationSeconds: 4 * 3_600,
      departureTime: "2026-08-01T13:00:00.000Z",
      maxDrivingHoursPerDay: 8,
      stopFrequencyHours: 2,
    });

    expect(itinerary.days).toHaveLength(1);
    expect(itinerary.days[0].overnightAfter).toBe(false);
    expect(itinerary.days[0].restBreaks).toBe(1);
  });
});
