import { describe, expect, it } from "vitest";

import {
  rankRouteAlternatives,
  routeStrategyDisclosure,
} from "../../src/lib/domain/route-selection";
import type { HereRouteAlternative } from "../../src/lib/providers";

function route(id: string, lengthMeters: number, durationSeconds: number) {
  return {
    id,
    lengthMeters,
    durationSeconds,
    baseDurationSeconds: null,
    typicalDurationSeconds: null,
    sections: [],
    notices: [],
    tollTotalsByCurrency: {},
  } satisfies HereRouteAlternative;
}

describe("route alternative selection", () => {
  it("uses route distance as the disclosed fuel-conscious proxy", () => {
    expect(
      rankRouteAlternatives(
        [route("fast", 25_000, 1_000), route("short", 20_000, 1_300)],
        "fuel_conscious",
      ).map((item) => item.id),
    ).toEqual(["short", "fast"]);
  });

  it("does not silently reorder weather-aware alternatives", () => {
    expect(
      rankRouteAlternatives(
        [route("a", 25_000, 1_000), route("b", 20_000, 1_300)],
        "weather_aware",
      ).map((item) => item.id),
    ).toEqual(["a", "b"]);
    expect(
      routeStrategyDisclosure("weather_aware", "truck").enforcement,
    ).toBe("preference_only");
  });

  it("only calls truck suitability provider-enforced for truck mode", () => {
    expect(
      routeStrategyDisclosure("truck_suitable", "truck").enforcement,
    ).toBe("provider");
    expect(
      routeStrategyDisclosure("truck_suitable", "car").enforcement,
    ).toBe("preference_only");
  });
});
