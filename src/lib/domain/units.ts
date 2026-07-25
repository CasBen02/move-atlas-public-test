const METERS_PER_INCH = 0.0254;
const METERS_PER_FOOT = 0.3048;
const KILOGRAMS_PER_POUND = 0.45359237;
const KILOMETERS_PER_MILE = 1.609344;

function requireFiniteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number.`);
  }
  return value;
}

export function inchesToMeters(inches: number): number {
  return requireFiniteNonNegative(inches, "Inches") * METERS_PER_INCH;
}

export function feetToMeters(feet: number): number {
  return requireFiniteNonNegative(feet, "Feet") * METERS_PER_FOOT;
}

export function feetAndInchesToMeters(feet: number, inches: number): number {
  requireFiniteNonNegative(feet, "Feet");
  requireFiniteNonNegative(inches, "Inches");
  if (inches >= 12) {
    throw new RangeError("Inches must be less than 12 when feet are supplied separately.");
  }
  return feetToMeters(feet) + inchesToMeters(inches);
}

export function metersToFeetAndInches(meters: number): {
  feet: number;
  inches: number;
} {
  requireFiniteNonNegative(meters, "Meters");
  const totalInches = Math.round(meters / METERS_PER_INCH);
  return {
    feet: Math.floor(totalInches / 12),
    inches: totalInches % 12,
  };
}

export function metersToCentimeters(meters: number): number {
  return Math.round(requireFiniteNonNegative(meters, "Meters") * 100);
}

export function poundsToKilograms(pounds: number): number {
  return requireFiniteNonNegative(pounds, "Pounds") * KILOGRAMS_PER_POUND;
}

export function kilogramsToPounds(kilograms: number): number {
  return requireFiniteNonNegative(kilograms, "Kilograms") / KILOGRAMS_PER_POUND;
}

export function milesToKilometers(miles: number): number {
  return requireFiniteNonNegative(miles, "Miles") * KILOMETERS_PER_MILE;
}

export function kilometersToMiles(kilometers: number): number {
  return requireFiniteNonNegative(kilometers, "Kilometers") / KILOMETERS_PER_MILE;
}

export function milesToMeters(miles: number): number {
  return milesToKilometers(miles) * 1_000;
}

export function metersToMiles(meters: number): number {
  return kilometersToMiles(requireFiniteNonNegative(meters, "Meters") / 1_000);
}

export function milesPerHourToMetersPerSecond(mph: number): number {
  return requireFiniteNonNegative(mph, "Miles per hour") * 0.44704;
}

export function milesPerKwhToKwhPer100Km(milesPerKwh: number): number {
  if (!Number.isFinite(milesPerKwh) || milesPerKwh <= 0) {
    throw new RangeError("Miles per kWh must be greater than zero.");
  }
  return 62.1371192 / milesPerKwh;
}

export function kwhPer100KmToMilesPerKwh(kwhPer100Km: number): number {
  if (!Number.isFinite(kwhPer100Km) || kwhPer100Km <= 0) {
    throw new RangeError("kWh per 100 km must be greater than zero.");
  }
  return 62.1371192 / kwhPer100Km;
}
