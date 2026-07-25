import { describe, expect, it } from "vitest";

import { assessClearance } from "../../src/lib/domain/clearance";
import {
  feetAndInchesToMeters,
  kwhPer100KmToMilesPerKwh,
  metersToFeetAndInches,
  milesPerKwhToKwhPer100Km,
  poundsToKilograms,
} from "../../src/lib/domain/units";
import {
  normalizeVehicleProfile,
  toHereVehicleDimensions,
} from "../../src/lib/domain/vehicle";

describe("vehicle unit conversion", () => {
  it("converts exact U.S. customary dimensions to SI and back", () => {
    const meters = feetAndInchesToMeters(13, 6);
    expect(meters).toBeCloseTo(4.1148, 6);
    expect(metersToFeetAndInches(meters)).toEqual({ feet: 13, inches: 6 });
    expect(poundsToKilograms(10_000)).toBeCloseTo(4_535.9237, 4);
  });

  it("uses the largest height/width and combined towing length and weight", () => {
    const normalized = normalizeVehicleProfile({
      category: "moving_truck_towing",
      heightFeet: 12,
      heightInches: 6,
      widthFeet: 8,
      widthInches: 0,
      lengthFeet: 26,
      lengthInches: 0,
      grossWeightPounds: 20_000,
      currentWeightPounds: 18_000,
      loadedState: "loaded",
      trailer: {
        enabled: true,
        heightFeet: 13,
        heightInches: 0,
        widthFeet: 8,
        widthInches: 6,
        lengthFeet: 20,
        lengthInches: 0,
        weightPounds: 5_000,
      },
    });

    expect(normalized.heightMeters).toBeCloseTo(feetAndInchesToMeters(13, 0));
    expect(normalized.widthMeters).toBeCloseTo(feetAndInchesToMeters(8, 6));
    expect(normalized.lengthMeters).toBeCloseTo(feetAndInchesToMeters(46, 0));
    expect(normalized.grossWeightKilograms).toBeCloseTo(poundsToKilograms(25_000));
    expect(normalized.currentWeightKilograms).toBeCloseTo(poundsToKilograms(23_000));
    expect(normalized.trailerLengthMeters).toBeCloseTo(feetAndInchesToMeters(20, 0));
    expect(normalized.loadedState).toBe("loaded");
    expect(toHereVehicleDimensions(normalized)).toMatchObject({
      heightCentimeters: 396,
      widthCentimeters: 259,
      lengthCentimeters: 1402,
      grossWeightKilograms: 11340,
      currentWeightKilograms: 10433,
      trailerCount: 1,
      trailerLengthCentimeters: 610,
    });
  });

  it("round-trips EV efficiency between UI and persisted units", () => {
    const persisted = milesPerKwhToKwhPer100Km(3.5);
    expect(persisted).toBeCloseTo(17.753, 3);
    expect(kwhPer100KmToMilesPerKwh(persisted)).toBeCloseTo(3.5, 8);
  });
});

describe("clearance buffer logic", () => {
  const vehicleHeightMeters = feetAndInchesToMeters(13, 6);
  const preferredBufferMeters = feetAndInchesToMeters(0, 6);

  it("reports a confirmed physical conflict", () => {
    const result = assessClearance({
      vehicleHeightMeters,
      preferredBufferMeters,
      knownClearanceMeters: feetAndInchesToMeters(13, 4),
    });
    expect(result.status).toBe("confirmed_conflict");
    expect(result.manualVerificationRequired).toBe(true);
  });

  it("reports a narrow margin when physical clearance is below the user's buffer", () => {
    const result = assessClearance({
      vehicleHeightMeters,
      preferredBufferMeters,
      knownClearanceMeters: feetAndInchesToMeters(13, 9),
    });
    expect(result.status).toBe("narrow_margin");
    expect(result.physicalMarginMeters).toBeCloseTo(feetAndInchesToMeters(0, 3));
  });

  it("never interprets missing data as proof of clearance", () => {
    const result = assessClearance({
      vehicleHeightMeters,
      preferredBufferMeters,
      knownClearanceMeters: null,
    });
    expect(result.status).toBe("data_unavailable");
    expect(result.message).toBe(
      "Clearance data unavailable for this segment—manual verification required.",
    );
  });
});
