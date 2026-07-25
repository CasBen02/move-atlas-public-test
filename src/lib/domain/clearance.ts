export type ClearanceAssessmentStatus =
  | "confirmed_conflict"
  | "narrow_margin"
  | "data_unavailable"
  | "no_conflict_found";

export interface ClearanceAssessment {
  status: ClearanceAssessmentStatus;
  vehicleHeightMeters: number;
  preferredBufferMeters: number;
  requiredClearanceMeters: number;
  knownClearanceMeters: number | null;
  physicalMarginMeters: number | null;
  manualVerificationRequired: boolean;
  message: string;
}
function validDimension(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
}

export function assessClearance(input: {
  vehicleHeightMeters: number;
  preferredBufferMeters: number;
  knownClearanceMeters?: number | null;
}): ClearanceAssessment {
  validDimension(input.vehicleHeightMeters, "Vehicle height");
  if (!Number.isFinite(input.preferredBufferMeters) || input.preferredBufferMeters < 0) {
    throw new RangeError("Preferred clearance buffer must be a finite, non-negative number.");
  }

  const required = input.vehicleHeightMeters + input.preferredBufferMeters;
  const known = input.knownClearanceMeters;

  if (known === undefined || known === null) {
    return {
      status: "data_unavailable",
      vehicleHeightMeters: input.vehicleHeightMeters,
      preferredBufferMeters: input.preferredBufferMeters,
      requiredClearanceMeters: required,
      knownClearanceMeters: null,
      physicalMarginMeters: null,
      manualVerificationRequired: true,
      message: "Clearance data unavailable for this segment—manual verification required.",
    };
  }

  validDimension(known, "Known clearance");
  const physicalMargin = known - input.vehicleHeightMeters;

  if (physicalMargin <= 0) {
    return {
      status: "confirmed_conflict",
      vehicleHeightMeters: input.vehicleHeightMeters,
      preferredBufferMeters: input.preferredBufferMeters,
      requiredClearanceMeters: required,
      knownClearanceMeters: known,
      physicalMarginMeters: physicalMargin,
      manualVerificationRequired: true,
      message: "Confirmed clearance conflict in available provider data.",
    };
  }

  if (known < required) {
    return {
      status: "narrow_margin",
      vehicleHeightMeters: input.vehicleHeightMeters,
      preferredBufferMeters: input.preferredBufferMeters,
      requiredClearanceMeters: required,
      knownClearanceMeters: known,
      physicalMarginMeters: physicalMargin,
      manualVerificationRequired: true,
      message: "Known clearance is above the vehicle height but below the preferred buffer.",
    };
  }

  return {
    status: "no_conflict_found",
    vehicleHeightMeters: input.vehicleHeightMeters,
    preferredBufferMeters: input.preferredBufferMeters,
    requiredClearanceMeters: required,
    knownClearanceMeters: known,
    physicalMarginMeters: physicalMargin,
    manualVerificationRequired: true,
    message:
      "No conflict was found in available provider data. This is not a safety guarantee; verify posted restrictions.",
  };
}
