import { describe, expect, it } from "vitest";

import {
  buildCensusAcsUrl,
  parseCensusAcsProfile,
  parseCensusEstimate,
} from "../../src/lib/providers/census-acs";
import censusFixture from "./fixtures/census-acs.json";

describe("Census ACS adapter", () => {
  it("treats Census sentinel and missing estimates as unavailable, not zero", () => {
    expect(parseCensusEstimate("-666666666")).toBeNull();
    expect(parseCensusEstimate("-999999999")).toBeNull();
    expect(parseCensusEstimate("")).toBeNull();
    expect(parseCensusEstimate("0")).toBe(0);
  });

  it("builds a server-managed Census geography request", () => {
    const url = buildCensusAcsUrl({
      year: 2024,
      geography: { kind: "place", stateFips: "17", placeFips: "12345" },
      apiKey: "operator-key",
    });
    expect(url.pathname).toBe("/data/2024/acs/acs5");
    expect(url.searchParams.get("for")).toBe("place:12345");
    expect(url.searchParams.get("in")).toBe("state:17");
    expect(url.searchParams.get("get")).toContain("B25077_001E");
  });

  it("parses official measures and transparent derived rates", () => {
    const profile = parseCensusAcsProfile({
      raw: censusFixture,
      geography: { kind: "place", stateFips: "17", placeFips: "12345" },
      year: 2024,
      retrievedAt: "2026-08-01T12:00:00.000Z",
    });
    const measures = Object.fromEntries(
      profile.measures.map((measure) => [measure.id, measure]),
    );
    expect(profile.name).toBe("Example city, Example State");
    expect(measures.population.rawValue).toBe(250_000);
    expect(measures.vacancy_rate.rawValue).toBeCloseTo(5);
    expect(measures.owner_occupancy_rate.rawValue).toBeCloseTo(63.158, 3);
    expect(measures.mean_commute_minutes.rawValue).toBeCloseTo(30);
    expect(measures.broadband_subscription_rate.rawValue).toBeCloseTo(80);
    expect(measures.median_home_value.caveats.join(" ")).toContain(
      "not current listing inventory",
    );
  });
});
