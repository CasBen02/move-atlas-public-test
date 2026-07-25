import { describe, expect, it, vi } from "vitest";

import type { HerePlace } from "../../src/lib/providers/here-geocoding";
import {
  CensusGeographyResolver,
  exactCensusGeographyMatch,
  parseCensusGeographyRows,
  stateCodeToFips,
} from "../../src/lib/providers/census-geography";

const chicago: HerePlace = {
  id: "here:cm:namedplace:example",
  title: "Lincoln Park, Chicago, IL",
  resultType: "locality",
  position: { lat: 41.9214, lng: -87.6513 },
  accessPoints: [],
  address: {
    label: "Lincoln Park, Chicago, IL, United States",
    countryCode: "USA",
    stateCode: "US-IL",
    state: "Illinois",
    county: "Cook County",
    city: "Chicago",
    district: "Lincoln Park",
    postalCode: "60614",
  },
  distanceMeters: null,
  categories: [],
  providerDetails: {
    contactsAvailable: false,
    openingHoursAvailable: false,
  },
  unverifiedFields: [],
};

describe("official Census geography resolution", () => {
  it("maps U.S. postal codes to official state FIPS codes", () => {
    expect(stateCodeToFips("IL")).toBe("17");
    expect(stateCodeToFips("US-IL")).toBe("17");
    expect(stateCodeToFips("unknown")).toBeNull();
  });

  it("matches official place suffixes without fuzzy cross-geography guesses", () => {
    const rows = parseCensusGeographyRows(
      [
        ["NAME", "state", "place"],
        ["Chicago city, Illinois", "17", "14000"],
        ["Chicago Heights city, Illinois", "17", "14026"],
      ],
      "place",
    );
    expect(exactCensusGeographyMatch(rows, "Chicago")).toEqual({
      name: "Chicago city, Illinois",
      stateFips: "17",
      code: "14000",
    });
    expect(exactCensusGeographyMatch(rows, "Chica")).toBeNull();
  });

  it("labels a neighborhood selection as containing-city context", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        JSON.stringify([
          ["NAME", "state", "place"],
          ["Chicago city, Illinois", "17", "14000"],
        ]),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const resolver = new CensusGeographyResolver({
      year: 2024,
      fetchImplementation,
    });
    const result = await resolver.resolve(chicago, "neighborhood");
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.data.geography).toEqual({
        kind: "place",
        stateFips: "17",
        placeFips: "14000",
      });
      expect(result.data.resolution).toBe("city_context_for_neighborhood");
      expect(result.data.representsSelectedPlaceDirectly).toBe(false);
      expect(result.data.contextMessage).toContain(
        "Neighborhood-level Census evidence was not inferred",
      );
      expect(result.meta.caveats.join(" ")).toContain(
        "must not be interpreted as neighborhood",
      );
    }
  });

  it("resolves an explicit ZIP selection to a ZCTA without a provider list call", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const resolver = new CensusGeographyResolver({ fetchImplementation });
    const result = await resolver.resolve(
      { ...chicago, title: "60614", resultType: "postalCodePoint" },
      "auto",
    );
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.data.geography).toEqual({ kind: "zip", zipCode: "60614" });
      expect(result.data.contextMessage).toContain("may not exactly match USPS");
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
