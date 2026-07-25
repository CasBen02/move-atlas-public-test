import { describe, expect, it } from "vitest";

import { calculateBudget } from "../../src/lib/domain/budget";
import { calculateFuel } from "../../src/lib/domain/fuel";

describe("fuel calculations", () => {
  it("applies distance, load, towing, city, weather, idling, and emergency factors", () => {
    const result = calculateFuel({
      routeMiles: 1_000,
      efficiencyMilesPerUnit: 10,
      fuelType: "diesel",
      tankCapacityUnits: 50,
      startingFuelUnits: 20,
      preferredMinimumRemainingUnits: 5,
      expectedPricePerUnit: 4,
      lowPricePerUnit: 3.5,
      highPricePerUnit: 5,
      towingPenaltyPercent: 10,
      loadPenaltyPercent: 5,
      cityDrivingShare: 0.2,
      cityPenaltyPercent: 20,
      elevationPenaltyPercent: 2,
      weatherPenaltyPercent: 1,
      detourPercent: 10,
      expectedIdlingUnits: 1,
      emergencyBufferPercent: 10,
    });

    expect(result.adjustedDistanceMiles).toBeCloseTo(1_100);
    expect(result.assumptions.efficiencyPenaltyPercent).toBe(22);
    expect(result.unbufferedUnitsRequired).toBeCloseTo(135.2);
    expect(result.expectedUnitsRequired).toBeCloseTo(148.72);
    expect(result.expectedStops).toBe(3);
    expect(result.cost).toEqual({
      bestCase: 520.52,
      expected: 594.88,
      highCase: 743.6,
    });
    expect(result.assumptions.priceSource).toBe("user_or_regional_estimate");
  });

  it("supports energy units without claiming a live charging price", () => {
    const result = calculateFuel({
      routeMiles: 200,
      efficiencyMilesPerUnit: 3,
      fuelType: "electric",
      tankCapacityUnits: 80,
      startingFuelUnits: 80,
      preferredMinimumRemainingUnits: 10,
      expectedPricePerUnit: 0.2,
    });
    expect(result.unit).toBe("kWh");
    expect(result.expectedStops).toBe(0);
    expect(result.assumptions.priceSource).toBe("user_or_regional_estimate");
  });
});
describe("budget calculations", () => {
  it("uses actual amounts where known and estimated amounts otherwise", () => {
    expect(
      calculateBudget([
        { estimatedAmount: 1_000, actualAmount: 1_200, paidAmount: 500 },
        { estimatedAmount: 500, paidAmount: 100 },
      ]),
    ).toEqual({
      estimatedTotal: 1_500,
      actualOrEstimatedTotal: 1_700,
      paidTotal: 600,
      remainingToPay: 1_100,
      varianceFromEstimate: 200,
      overEstimateBy: 200,
    });
  });
});
