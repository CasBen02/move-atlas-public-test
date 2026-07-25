import { describe, expect, it } from "vitest";

import { decodeHereFlexiblePolyline } from "../../src/lib/domain/polyline";

describe("HERE flexible polyline decoding", () => {
  it("decodes the published two-dimensional example", () => {
    const decoded = decodeHereFlexiblePolyline("BFoz5xJ67i1B1B7PzIhaxL7Y");
    expect(decoded.precision).toBe(5);
    expect(decoded.thirdDimension).toBe("absent");
    expect(decoded.points).toEqual([
      { lat: 50.10228, lng: 8.69821 },
      { lat: 50.10201, lng: 8.69567 },
      { lat: 50.10063, lng: 8.6915 },
      { lat: 50.09878, lng: 8.68752 },
    ]);
  });

  it("rejects malformed route geometry", () => {
    expect(() => decodeHereFlexiblePolyline("!")).toThrow();
    expect(() => decodeHereFlexiblePolyline("")).toThrow();
    expect(() =>
      decodeHereFlexiblePolyline("BFoz5xJ67i1B1B7PzIhaxL7Y", { maximumPoints: 2 }),
    ).toThrow("point limit");
  });
});
