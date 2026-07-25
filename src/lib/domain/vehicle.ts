import {
  feetAndInchesToMeters,
  metersToCentimeters,
  poundsToKilograms,
} from "./units";

export type VehicleCategory =
  | "passenger_car"
  | "suv"
  | "pickup"
  | "cargo_van"
  | "moving_truck"
  | "moving_truck_towing"
  | "car_towing_trailer"
  | "rv"
  | "oversized";

export interface UsVehicleProfile {
  category: VehicleCategory;
  heightFeet: number;
  heightInches: number;
  widthFeet?: number;
  widthInches?: number;
  lengthFeet?: number;
  lengthInches?: number;
  grossWeightPounds?: number;
  currentWeightPounds?: number;
  weightPerAxlePounds?: number;
  loadedState?: "loaded" | "unloaded" | "unknown";
  trailer?: {
    enabled: boolean;
    heightFeet?: number;
    heightInches?: number;
    widthFeet?: number;
    widthInches?: number;
    lengthFeet?: number;
    lengthInches?: number;
    weightPounds?: number;
  };
}

export interface MetricVehicleProfile {
  category: VehicleCategory;
  heightMeters: number;
  widthMeters?: number;
  lengthMeters?: number;
  grossWeightKilograms?: number;
  currentWeightKilograms?: number;
  weightPerAxleKilograms?: number;
  trailerCount: number;
  trailerLengthMeters?: number;
  trailerHeightMeters?: number;
  trailerWidthMeters?: number;
  trailerWeightKilograms?: number;
  loadedState?: "loaded" | "unloaded" | "unknown";
}

function optionalDimension(
  feet: number | undefined,
  inches: number | undefined,
): number | undefined {
  if (feet === undefined && inches === undefined) return undefined;
  return feetAndInchesToMeters(feet ?? 0, inches ?? 0);
}

/**
 * Normalizes a U.S.-customary UI profile into the SI values used internally.
 * Overall dimensions include the enabled trailer where it changes the envelope.
 */
export function normalizeVehicleProfile(profile: UsVehicleProfile): MetricVehicleProfile {
  const trailer = profile.trailer?.enabled ? profile.trailer : undefined;
  const vehicleHeight = feetAndInchesToMeters(profile.heightFeet, profile.heightInches);
  const trailerHeight = trailer
    ? optionalDimension(trailer.heightFeet, trailer.heightInches)
    : undefined;
  const vehicleWidth = optionalDimension(profile.widthFeet, profile.widthInches);
  const trailerWidth = trailer
    ? optionalDimension(trailer.widthFeet, trailer.widthInches)
    : undefined;
  const vehicleLength = optionalDimension(profile.lengthFeet, profile.lengthInches);
  const trailerLength = trailer
    ? optionalDimension(trailer.lengthFeet, trailer.lengthInches)
    : undefined;
  const vehicleWeight =
    profile.grossWeightPounds === undefined
      ? undefined
      : poundsToKilograms(profile.grossWeightPounds);
  const trailerWeight =
    trailer?.weightPounds === undefined ? undefined : poundsToKilograms(trailer.weightPounds);

  const currentVehicleWeight =
    profile.currentWeightPounds === undefined
      ? undefined
      : poundsToKilograms(profile.currentWeightPounds);

  return {
    category: profile.category,
    heightMeters: Math.max(vehicleHeight, trailerHeight ?? 0),
    widthMeters:
      vehicleWidth === undefined && trailerWidth === undefined
        ? undefined
        : Math.max(vehicleWidth ?? 0, trailerWidth ?? 0),
    lengthMeters:
      vehicleLength === undefined && trailerLength === undefined
        ? undefined
        : (vehicleLength ?? 0) + (trailerLength ?? 0),
    grossWeightKilograms:
      vehicleWeight === undefined ? undefined : vehicleWeight + (trailerWeight ?? 0),
    currentWeightKilograms:
      currentVehicleWeight === undefined
        ? undefined
        : currentVehicleWeight + (trailerWeight ?? 0),
    weightPerAxleKilograms:
      profile.weightPerAxlePounds === undefined
        ? undefined
        : poundsToKilograms(profile.weightPerAxlePounds),
    trailerCount: trailer ? 1 : 0,
    trailerLengthMeters: trailerLength,
    trailerHeightMeters: trailerHeight,
    trailerWidthMeters: trailerWidth,
    trailerWeightKilograms: trailerWeight,
    loadedState: profile.loadedState,
  };
}

export function toHereVehicleDimensions(profile: MetricVehicleProfile): {
  heightCentimeters: number;
  widthCentimeters?: number;
  lengthCentimeters?: number;
  grossWeightKilograms?: number;
  currentWeightKilograms?: number;
  weightPerAxleKilograms?: number;
  trailerCount: number;
  trailerLengthCentimeters?: number;
} {
  return {
    heightCentimeters: metersToCentimeters(profile.heightMeters),
    widthCentimeters:
      profile.widthMeters === undefined ? undefined : metersToCentimeters(profile.widthMeters),
    lengthCentimeters:
      profile.lengthMeters === undefined ? undefined : metersToCentimeters(profile.lengthMeters),
    grossWeightKilograms:
      profile.grossWeightKilograms === undefined
        ? undefined
        : Math.round(profile.grossWeightKilograms),
    currentWeightKilograms:
      profile.currentWeightKilograms === undefined
        ? undefined
        : Math.round(profile.currentWeightKilograms),
    weightPerAxleKilograms:
      profile.weightPerAxleKilograms === undefined
        ? undefined
        : Math.round(profile.weightPerAxleKilograms),
    trailerCount: profile.trailerCount,
    trailerLengthCentimeters:
      profile.trailerLengthMeters === undefined
        ? undefined
        : metersToCentimeters(profile.trailerLengthMeters),
  };
}

export function requiresTruckRouting(category: VehicleCategory): boolean {
  return [
    "cargo_van",
    "moving_truck",
    "moving_truck_towing",
    "rv",
    "oversized",
  ].includes(category);
}
