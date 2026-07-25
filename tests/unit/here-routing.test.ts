import { describe, expect, it } from "vitest";

import { feetAndInchesToMeters } from "../../src/lib/domain/units";
import type { MetricVehicleProfile } from "../../src/lib/domain/vehicle";
import {
  buildHereRoutingUrl,
  flattenHereRouteGeometry,
  parseHereRoutingResponse,
} from "../../src/lib/providers/here-routing";
import hereFixture from "./fixtures/here-route.json";

const vehicle: MetricVehicleProfile = {
  category: "moving_truck_towing",
  heightMeters: feetAndInchesToMeters(13, 6),
  widthMeters: feetAndInchesToMeters(8, 6),
  lengthMeters: feetAndInchesToMeters(46, 0),
  grossWeightKilograms: 11_340,
  currentWeightKilograms: 10_433,
  weightPerAxleKilograms: 3_000,
  trailerCount: 1,
  trailerLengthMeters: feetAndInchesToMeters(20, 0),
};

describe("HERE Routing v8 adapter", () => {
  it("submits truck dimensions and the preferred clearance buffer in provider units", () => {
    const url = buildHereRoutingUrl({
      apiKey: "server-secret",
      origin: { lat: 41.8781, lng: -87.6298 },
      destination: { lat: 39.7392, lng: -104.9903 },
      vehicle,
      clearanceBufferMeters: feetAndInchesToMeters(0, 6),
      avoid: {
        tollRoads: true,
        ferries: true,
        difficultTurns: true,
      },
    });

    expect(url.searchParams.get("transportMode")).toBe("truck");
    expect(url.searchParams.get("spans")).toContain("notices");
    expect(url.searchParams.get("spans")).toContain("incidents");
    expect(url.searchParams.has("traffic[mode]")).toBe(false);
    expect(url.searchParams.get("vehicle[height]")).toBe("427");
    expect(url.searchParams.get("vehicle[width]")).toBe("260");
    expect(url.searchParams.get("vehicle[length]")).toBe("1403");
    expect(url.searchParams.get("vehicle[grossWeight]")).toBe("11340");
    expect(url.searchParams.get("vehicle[currentWeight]")).toBe("10433");
    expect(url.searchParams.get("vehicle[weightPerAxle]")).toBe("3000");
    expect(url.searchParams.get("vehicle[trailerCount]")).toBe("1");
    expect(url.searchParams.get("vehicle[trailerLength]")).toBe("610");
    expect(url.searchParams.get("avoid[features]")).toBe("tollRoad,ferry,difficultTurns");
  });

  it("submits atypical passenger-car height and keeps a towing car in car mode", () => {
    const url = buildHereRoutingUrl({
      apiKey: "server-secret",
      origin: { lat: 41.8781, lng: -87.6298 },
      destination: { lat: 39.7392, lng: -104.9903 },
      vehicle: {
        category: "car_towing_trailer",
        heightMeters: feetAndInchesToMeters(7, 0),
        lengthMeters: feetAndInchesToMeters(30, 0),
        trailerLengthMeters: feetAndInchesToMeters(12, 0),
        trailerCount: 1,
      },
      clearanceBufferMeters: feetAndInchesToMeters(0, 3),
    });
    expect(url.searchParams.get("transportMode")).toBe("car");
    expect(url.searchParams.get("vehicle[height]")).toBe("221");
    expect(url.searchParams.get("vehicle[trailerCount]")).toBe("1");
    expect(url.searchParams.get("vehicle[trailerLength]")).toBe("366");
  });

  it("parses geometry, instructions, tolls, and provider restriction notices", () => {
    const plan = parseHereRoutingResponse(hereFixture, {
      vehicle,
      clearanceBufferMeters: feetAndInchesToMeters(0, 6),
    });
    const route = plan.routes[0];
    expect(route.lengthMeters).toBe(160_934);
    expect(route.durationSeconds).toBe(7_200);
    expect(route.typicalDurationSeconds).toBe(7_050);
    expect(route.sections[0].encodedFlexiblePolyline).toBe(
      "BFoz5xJ67i1B1B7PzIhaxL7Y",
    );
    expect(route.sections[0].geometry).toHaveLength(4);
    expect(flattenHereRouteGeometry(route).at(-1)).toEqual({
      lat: 50.09878,
      lng: 8.68752,
    });
    expect(route.sections[0].actions[0].instruction).toBe("Head north");
    expect(route.tollTotalsByCurrency).toEqual({ USD: 12.5 });
    expect(route.notices.map((notice) => notice.kind)).toEqual([
      "height_or_clearance",
      "truck_access",
    ]);
    expect(route.notices[0].knownLimits.maximumHeightMeters).toBe(4.2);
    expect(route.notices[0].clearanceAssessment?.status).toBe("narrow_margin");
    expect(route.notices[1].spanOffsets).toEqual([0]);
    expect(route.sections[0].incidents[0]).toMatchObject({
      type: "construction",
      criticality: "major",
      description: "Road construction",
      spanOffsets: [0],
    });
    expect(route.sections[0].restrictionCoverage.manualVerificationRequired).toBe(true);
    expect(plan.vehicleEvaluation.submittedHeightMeters).toBeGreaterThan(
      plan.vehicleEvaluation.actualHeightMeters,
    );
    expect(plan.vehicleEvaluation.coverageMessage).toContain("not proof of clearance");
  });

  it("accepts documented scalar and value-object vehicle restriction limits", () => {
    const restrictionResponse = {
      routes: [
        {
          id: "restriction-variants",
          notices: [
            {
              code: "max-height-object",
              details: [{ maxHeight: { value: 420, type: "maximum" } }],
            },
            {
              code: "max-weight-object",
              details: [{ maxWeight: { value: 9_000, type: "gross" } }],
            },
            {
              code: "max-weight-scalar",
              details: [{ maxWeight: 8_500 }],
            },
            {
              code: "max-width-object",
              details: [{ maxWidth: { value: 260, type: "maximum" } }],
            },
            {
              code: "max-width-scalar",
              details: [{ maxWidth: 250 }],
            },
            {
              code: "max-length-object",
              details: [{ maxLength: { value: 1_400, type: "maximum" } }],
            },
            {
              code: "max-length-scalar",
              details: [{ maxLength: 1_300 }],
            },
          ],
          sections: [
            {
              id: "restriction-section",
              departure: {},
              arrival: {},
              summary: { duration: 60, length: 1_000 },
              polyline: "BFoz5xJ67i1B1B7PzIhaxL7Y",
            },
          ],
        },
      ],
    };

    const notices = parseHereRoutingResponse(restrictionResponse, {
      vehicle,
      clearanceBufferMeters: 0,
    }).routes[0].notices;

    expect(notices.map((notice) => notice.kind)).toEqual([
      "height_or_clearance",
      "weight_or_axle",
      "weight_or_axle",
      "width_or_length",
      "width_or_length",
      "width_or_length",
      "width_or_length",
    ]);
    expect(notices[0].knownLimits.maximumHeightMeters).toBe(4.2);
    expect(notices[1].knownLimits.maximumWeightKilograms).toBe(9_000);
    expect(notices[2].knownLimits.maximumWeightKilograms).toBe(8_500);
    expect(notices[3].knownLimits.maximumWidthMeters).toBe(2.6);
    expect(notices[4].knownLimits.maximumWidthMeters).toBe(2.5);
    expect(notices[5].knownLimits.maximumLengthMeters).toBe(14);
    expect(notices[6].knownLimits.maximumLengthMeters).toBe(13);
  });

  it("uses the highest alternative payment fare without summing alternatives", () => {
    const tollResponse = {
      routes: [
        {
          id: "toll-alternatives",
          sections: [
            {
              id: "toll-section-a",
              departure: {},
              arrival: {},
              summary: { duration: 60, length: 1_000 },
              polyline: "BFoz5xJ67i1B1B7PzIhaxL7Y",
              tolls: [
                {
                  fares: [
                    {
                      id: "fare-paid-once",
                      name: "Transponder",
                      price: { type: "value", currency: "USD", value: 8 },
                      paymentMethods: ["transponder"],
                    },
                    {
                      id: "fare-paid-once",
                      name: "Cash",
                      price: { type: "value", currency: "USD", value: 13 },
                      paymentMethods: ["cash"],
                    },
                    {
                      id: "card-option",
                      name: "Credit card",
                      price: { type: "value", currency: "USD", value: 11 },
                      paymentMethods: ["creditCard"],
                    },
                  ],
                },
                {
                  fares: [
                    {
                      id: "second-toll",
                      price: { type: "value", currency: "EUR", value: 4 },
                      convertedPrice: { type: "value", currency: "USD", value: 5 },
                      paymentMethods: ["cash"],
                    },
                  ],
                },
              ],
            },
            {
              id: "toll-section-b",
              departure: {},
              arrival: {},
              summary: { duration: 60, length: 1_000 },
              polyline: "BFoz5xJ67i1B1B7PzIhaxL7Y",
              tolls: [
                {
                  fares: [
                    {
                      id: "fare-paid-once",
                      name: "Cash",
                      price: { type: "value", currency: "USD", value: 13 },
                      paymentMethods: ["cash"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const route = parseHereRoutingResponse(tollResponse, {
      vehicle,
      clearanceBufferMeters: 0,
    }).routes[0];

    expect(route.sections[0].tolls[0]).toMatchObject({
      amount: 13,
      currency: "USD",
      name: "Cash",
      paymentMethods: ["cash"],
      selection: "highest_alternative_fare_for_toll_currency",
      alternativeFareCount: 3,
    });
    expect(route.tollTotalsByCurrency).toEqual({ USD: 18 });
    expect(route.tollEstimateSemantics).toMatchObject({
      selection: "highest_fare_per_toll_and_currency",
      duplicateFareIdsCountedOnce: true,
    });
    expect(route.tollEstimateSemantics?.description).toContain(
      "alternative fares",
    );
  });
});
