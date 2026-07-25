import { metersToMiles } from "./units";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RouteGeometryPoint extends GeoPoint {
  cumulativeDistanceMeters?: number;
  cumulativeDurationSeconds?: number;
}

export interface TimedRouteSample extends GeoPoint {
  routePointIndex: number;
  cumulativeDistanceMeters: number;
  cumulativeDurationSeconds: number;
  expectedArrival: string;
}

export interface RouteTravelSchedule {
  maxDrivingHoursPerDay: number;
  stopFrequencyHours: number;
  children?: boolean;
  pets?: boolean;
  minutesPerBreak?: number;
  overnightRestHours?: number;
}

export interface RouteWindProfile {
  vehicleCategory:
    | "passenger_car"
    | "suv"
    | "pickup"
    | "cargo_van"
    | "moving_truck"
    | "moving_truck_towing"
    | "car_towing_trailer"
    | "rv"
    | "oversized";
  loadedStatus: "unloaded" | "lightly_loaded" | "loaded" | "unknown";
  trailerEnabled: boolean;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const radius = 6_371_008.8;
  const latitudeDelta = radians(b.lat - a.lat);
  const longitudeDelta = radians(b.lng - a.lng);
  const latitudeA = radians(a.lat);
  const latitudeB = radians(b.lat);
  const sinLat = Math.sin(latitudeDelta / 2);
  const sinLng = Math.sin(longitudeDelta / 2);
  const value =
    sinLat * sinLat + Math.cos(latitudeA) * Math.cos(latitudeB) * sinLng * sinLng;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(value)));
}

export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const latA = radians(a.lat);
  const latB = radians(b.lat);
  const longitudeDelta = radians(b.lng - a.lng);
  const y = Math.sin(longitudeDelta) * Math.cos(latB);
  const x =
    Math.cos(latA) * Math.sin(latB) -
    Math.sin(latA) * Math.cos(latB) * Math.cos(longitudeDelta);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function sampleTimedRoute(input: {
  points: readonly RouteGeometryPoint[];
  departureTime: string;
  totalDurationSeconds: number;
  intervalMiles?: number;
  maximumSamples?: number;
  travelSchedule?: RouteTravelSchedule;
}): TimedRouteSample[] {
  if (input.points.length < 2) {
    throw new RangeError("At least two route points are required for weather sampling.");
  }
  const departure = Date.parse(input.departureTime);
  if (!Number.isFinite(departure)) throw new RangeError("Departure time must be valid.");
  if (!Number.isFinite(input.totalDurationSeconds) || input.totalDurationSeconds <= 0) {
    throw new RangeError("Route duration must be greater than zero.");
  }
  const intervalMiles = input.intervalMiles ?? 100;
  const maximumSamples = Math.max(2, Math.min(input.maximumSamples ?? 12, 24));
  if (!Number.isFinite(intervalMiles) || intervalMiles <= 0) {
    throw new RangeError("Weather sample interval must be greater than zero.");
  }
  const schedule = input.travelSchedule;
  if (schedule) {
    for (const [value, label] of [
      [schedule.maxDrivingHoursPerDay, "Maximum driving hours"],
      [schedule.stopFrequencyHours, "Stop frequency"],
      [schedule.minutesPerBreak ?? (schedule.children || schedule.pets ? 30 : 20), "Break duration"],
      [schedule.overnightRestHours ?? 12, "Overnight rest"],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be greater than zero.`);
      }
    }
  }

  const cumulative: number[] = [0];
  for (let index = 1; index < input.points.length; index += 1) {
    const supplied = input.points[index].cumulativeDistanceMeters;
    cumulative.push(
      supplied !== undefined && supplied >= cumulative[index - 1]
        ? supplied
        : cumulative[index - 1] + haversineMeters(input.points[index - 1], input.points[index]),
    );
  }
  const totalDistance = cumulative.at(-1) ?? 0;
  const intervalMeters = intervalMiles * 1_609.344;
  const targets: number[] = [0];
  for (let distance = intervalMeters; distance < totalDistance; distance += intervalMeters) {
    targets.push(distance);
  }
  targets.push(totalDistance);

  if (targets.length > maximumSamples) {
    const evenlySpaced = Array.from(
      { length: maximumSamples },
      (_, index) => (totalDistance * index) / (maximumSamples - 1),
    );
    targets.splice(0, targets.length, ...evenlySpaced);
  }

  const selected = new Set<number>();
  for (const target of targets) {
    let closestIndex = 0;
    let difference = Number.POSITIVE_INFINITY;
    for (let index = 0; index < cumulative.length; index += 1) {
      const candidate = Math.abs(cumulative[index] - target);
      if (candidate < difference) {
        closestIndex = index;
        difference = candidate;
      }
    }
    selected.add(closestIndex);
  }
  selected.add(0);
  selected.add(input.points.length - 1);

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => {
      const point = input.points[index];
      const distanceFraction = totalDistance === 0 ? index / (input.points.length - 1) : cumulative[index] / totalDistance;
      const suppliedDuration = point.cumulativeDurationSeconds;
      const duration =
        suppliedDuration !== undefined && suppliedDuration >= 0
          ? suppliedDuration
          : input.totalDurationSeconds * distanceFraction;
      const elapsedSeconds = schedule
        ? scheduledElapsedSeconds(duration, schedule)
        : duration;
      return {
        lat: point.lat,
        lng: point.lng,
        routePointIndex: index,
        cumulativeDistanceMeters: cumulative[index],
        cumulativeDurationSeconds: duration,
        expectedArrival: new Date(
          departure + elapsedSeconds * 1_000,
        ).toISOString(),
      };
    });
}

/**
 * Converts cumulative provider driving time into elapsed trip time using the
 * household's explicit rest cadence and daily driving limit. Breaks are placed
 * between driving segments and each completed driving day adds an overnight
 * rest. This remains an estimate until the user selects actual stops.
 */
export function scheduledElapsedSeconds(
  cumulativeDrivingSeconds: number,
  schedule: RouteTravelSchedule,
) {
  if (
    !Number.isFinite(cumulativeDrivingSeconds) ||
    cumulativeDrivingSeconds < 0
  ) {
    throw new RangeError(
      "Cumulative driving time must be finite and non-negative.",
    );
  }
  const maximumDaySeconds = schedule.maxDrivingHoursPerDay * 3_600;
  const stopEverySeconds = schedule.stopFrequencyHours * 3_600;
  const breakSeconds =
    (schedule.minutesPerBreak ??
      (schedule.children || schedule.pets ? 30 : 20)) * 60;
  const overnightSeconds = (schedule.overnightRestHours ?? 12) * 3_600;
  for (const [value, label] of [
    [maximumDaySeconds, "Maximum driving hours"],
    [stopEverySeconds, "Stop frequency"],
    [breakSeconds, "Break duration"],
    [overnightSeconds, "Overnight rest"],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label} must be greater than zero.`);
    }
  }
  if (cumulativeDrivingSeconds === 0) return 0;

  const completedDrivingDays = Math.max(
    0,
    Math.ceil(cumulativeDrivingSeconds / maximumDaySeconds) - 1,
  );
  const currentDayDrivingSeconds =
    cumulativeDrivingSeconds - completedDrivingDays * maximumDaySeconds;
  const breaksPerFullDay = Math.max(
    0,
    Math.ceil(maximumDaySeconds / stopEverySeconds) - 1,
  );
  const currentDayBreaks = Math.max(
    0,
    Math.ceil(currentDayDrivingSeconds / stopEverySeconds) - 1,
  );
  const completedBreaks =
    completedDrivingDays * breaksPerFullDay + currentDayBreaks;

  return (
    cumulativeDrivingSeconds +
    completedBreaks * breakSeconds +
    completedDrivingDays * overnightSeconds
  );
}

export type WindRiskSeverity = "low" | "moderate" | "high" | "severe";

export function crosswindComponentMph(input: {
  windSpeedMph: number;
  windFromDegrees: number;
  routeBearingDegrees: number;
}): number {
  for (const [value, label] of [
    [input.windSpeedMph, "Wind speed"],
    [input.windFromDegrees, "Wind direction"],
    [input.routeBearingDegrees, "Route bearing"],
  ] as const) {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  }
  const angle = radians(input.windFromDegrees - input.routeBearingDegrees);
  return Math.abs(input.windSpeedMph * Math.sin(angle));
}

export function windRiskSeverity(
  crosswindMph: number,
  thresholds: { moderate: number; high: number; severe: number } = {
    moderate: 15,
    high: 25,
    severe: 35,
  },
): WindRiskSeverity {
  if (!Number.isFinite(crosswindMph) || crosswindMph < 0) {
    throw new RangeError("Crosswind speed must be finite and non-negative.");
  }
  if (crosswindMph >= thresholds.severe) return "severe";
  if (crosswindMph >= thresholds.high) return "high";
  if (crosswindMph >= thresholds.moderate) return "moderate";
  return "low";
}

export function vehicleWindRiskThresholds(
  profile?: RouteWindProfile,
): { moderate: number; high: number; severe: number } {
  if (!profile) return { moderate: 15, high: 25, severe: 35 };
  const highProfile =
    profile.trailerEnabled ||
    [
      "cargo_van",
      "moving_truck",
      "moving_truck_towing",
      "car_towing_trailer",
      "rv",
      "oversized",
    ].includes(profile.vehicleCategory);
  if (
    highProfile &&
    (profile.loadedStatus === "unloaded" ||
      profile.loadedStatus === "lightly_loaded")
  ) {
    return { moderate: 12, high: 20, severe: 30 };
  }
  if (highProfile) return { moderate: 15, high: 25, severe: 35 };
  return { moderate: 20, high: 30, severe: 45 };
}

export function formatSampleDistance(sample: TimedRouteSample): string {
  return `${Math.round(metersToMiles(sample.cumulativeDistanceMeters))} mi`;
}
