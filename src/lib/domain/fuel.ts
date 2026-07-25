export type FuelType =
  | "regular"
  | "midgrade"
  | "premium"
  | "diesel"
  | "electric";

export interface FuelCalculationInput {
  routeMiles: number;
  efficiencyMilesPerUnit: number;
  fuelType: FuelType;
  tankCapacityUnits: number;
  startingFuelUnits: number;
  preferredMinimumRemainingUnits: number;
  expectedPricePerUnit: number;
  lowPricePerUnit?: number;
  highPricePerUnit?: number;
  towingPenaltyPercent?: number;
  loadPenaltyPercent?: number;
  cityDrivingShare?: number;
  cityPenaltyPercent?: number;
  elevationPenaltyPercent?: number;
  weatherPenaltyPercent?: number;
  detourPercent?: number;
  expectedIdlingUnits?: number;
  emergencyBufferPercent?: number;
}
export interface FuelCalculation {
  unit: "gallons" | "kWh";
  adjustedDistanceMiles: number;
  unbufferedUnitsRequired: number;
  expectedUnitsRequired: number;
  expectedStops: number;
  approximateDistanceBetweenStopsMiles: number | null;
  expectedRemainingAtArrivalUnits: number;
  usableRangeMiles: number;
  cost: {
    bestCase: number;
    expected: number;
    highCase: number;
  };
  assumptions: {
    efficiencyPenaltyPercent: number;
    emergencyBufferPercent: number;
    priceSource: "user_or_regional_estimate";
  };
}

function finiteAtLeast(value: number, minimum: number, label: string): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${label} must be a finite number of at least ${minimum}.`);
  }
  return value;
}

function percentage(value: number | undefined, label: string): number {
  const resolved = value ?? 0;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 100) {
    throw new RangeError(`${label} must be between 0 and 100.`);
  }
  return resolved;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateFuel(input: FuelCalculationInput): FuelCalculation {
  finiteAtLeast(input.routeMiles, 0, "Route distance");
  finiteAtLeast(input.efficiencyMilesPerUnit, Number.EPSILON, "Fuel efficiency");
  finiteAtLeast(input.tankCapacityUnits, Number.EPSILON, "Tank capacity");
  finiteAtLeast(input.startingFuelUnits, 0, "Starting fuel");
  finiteAtLeast(input.preferredMinimumRemainingUnits, 0, "Minimum remaining fuel");
  finiteAtLeast(input.expectedPricePerUnit, 0, "Expected fuel price");
  finiteAtLeast(input.expectedIdlingUnits ?? 0, 0, "Expected idling fuel");

  if (input.startingFuelUnits > input.tankCapacityUnits) {
    throw new RangeError("Starting fuel cannot exceed tank capacity.");
  }
  if (input.preferredMinimumRemainingUnits >= input.tankCapacityUnits) {
    throw new RangeError("Minimum remaining fuel must be less than tank capacity.");
  }

  const towing = percentage(input.towingPenaltyPercent, "Towing penalty");
  const load = percentage(input.loadPenaltyPercent, "Load penalty");
  const cityShare = percentage((input.cityDrivingShare ?? 0) * 100, "City-driving share") / 100;
  const cityPenalty = percentage(input.cityPenaltyPercent, "City-driving penalty");
  const elevation = percentage(input.elevationPenaltyPercent, "Elevation penalty");
  const weather = percentage(input.weatherPenaltyPercent, "Weather penalty");
  const detour = percentage(input.detourPercent, "Detour percentage");
  const emergencyBuffer = percentage(input.emergencyBufferPercent, "Emergency buffer");

  const adjustedDistance = input.routeMiles * (1 + detour / 100);
  const efficiencyPenalty = towing + load + cityShare * cityPenalty + elevation + weather;
  const travelUnits =
    (adjustedDistance / input.efficiencyMilesPerUnit) * (1 + efficiencyPenalty / 100);
  const unbufferedUnits = travelUnits + (input.expectedIdlingUnits ?? 0);
  const expectedUnits = unbufferedUnits * (1 + emergencyBuffer / 100);

  const usableTankUnits = input.tankCapacityUnits - input.preferredMinimumRemainingUnits;
  const initialUsableUnits = Math.max(
    0,
    input.startingFuelUnits - input.preferredMinimumRemainingUnits,
  );
  const additionalUsableUnits = Math.max(0, expectedUnits - initialUsableUnits);
  const expectedStops =
    additionalUsableUnits === 0 ? 0 : Math.ceil(additionalUsableUnits / usableTankUnits);
  const usableRange = usableTankUnits * input.efficiencyMilesPerUnit;
  const arrivalRemaining =
    expectedStops === 0
      ? Math.max(0, input.startingFuelUnits - expectedUnits)
      : input.preferredMinimumRemainingUnits;

  const lowPrice = input.lowPricePerUnit ?? input.expectedPricePerUnit * 0.9;
  const highPrice = input.highPricePerUnit ?? input.expectedPricePerUnit * 1.15;
  finiteAtLeast(lowPrice, 0, "Low fuel price");
  finiteAtLeast(highPrice, 0, "High fuel price");

  return {
    unit: input.fuelType === "electric" ? "kWh" : "gallons",
    adjustedDistanceMiles: adjustedDistance,
    unbufferedUnitsRequired: unbufferedUnits,
    expectedUnitsRequired: expectedUnits,
    expectedStops,
    approximateDistanceBetweenStopsMiles: expectedStops === 0 ? null : usableRange,
    expectedRemainingAtArrivalUnits: arrivalRemaining,
    usableRangeMiles: usableRange,
    cost: {
      bestCase: money(expectedUnits * Math.min(lowPrice, input.expectedPricePerUnit)),
      expected: money(expectedUnits * input.expectedPricePerUnit),
      highCase: money(expectedUnits * Math.max(highPrice, input.expectedPricePerUnit)),
    },
    assumptions: {
      efficiencyPenaltyPercent: efficiencyPenalty,
      emergencyBufferPercent: emergencyBuffer,
      priceSource: "user_or_regional_estimate",
    },
  };
}
