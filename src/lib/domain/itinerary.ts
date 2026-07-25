const METERS_PER_MILE = 1_609.344;

export interface EstimatedItineraryDay {
  day: number;
  departureAt: string;
  arrivalAt: string;
  drivingSeconds: number;
  distanceMeters: number;
  routeStartPercent: number;
  routeEndPercent: number;
  restBreaks: number;
  fuelStops: number;
  overnightAfter: boolean;
  reminders: string[];
}

export interface EstimatedItinerary {
  days: EstimatedItineraryDay[];
  totalDrivingSeconds: number;
  totalDistanceMeters: number;
  estimatedBreakMinutes: number;
  assumptions: {
    maxDrivingHoursPerDay: number;
    stopFrequencyHours: number;
    minutesPerBreak: number;
    overnightRestHours: number;
    hotelLocationsSelected: false;
    stopLocationsSelected: false;
  };
}

function requirePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
}

/**
 * Builds a transparent day-by-day estimate from provider route distance and
 * driving duration. It does not invent hotels, fuel stations, or exact stop
 * locations; those remain unselected until the user chooses real places.
 */
export function buildEstimatedItinerary(input: {
  distanceMeters: number;
  durationSeconds: number;
  departureTime: string;
  maxDrivingHoursPerDay: number;
  stopFrequencyHours: number;
  expectedFuelStops?: number;
  children?: boolean;
  pets?: boolean;
  drivers?: number;
}): EstimatedItinerary {
  requirePositive(input.distanceMeters, "Route distance");
  requirePositive(input.durationSeconds, "Route duration");
  requirePositive(input.maxDrivingHoursPerDay, "Maximum driving hours");
  requirePositive(input.stopFrequencyHours, "Stop frequency");
  const departure = Date.parse(input.departureTime);
  if (!Number.isFinite(departure)) {
    throw new RangeError("Departure time must be valid.");
  }
  const fuelStops = Math.max(0, Math.floor(input.expectedFuelStops ?? 0));
  const driverCount = Math.max(1, Math.floor(input.drivers ?? 1));
  const maximumDaySeconds = input.maxDrivingHoursPerDay * 3_600;
  const stopEverySeconds = input.stopFrequencyHours * 3_600;
  const minutesPerBreak = input.children || input.pets ? 30 : 20;
  const overnightRestHours = 12;
  const dayCount = Math.max(1, Math.ceil(input.durationSeconds / maximumDaySeconds));
  const days: EstimatedItineraryDay[] = [];
  let routeSecondsCompleted = 0;
  let nextDeparture = departure;
  let breakMinutesTotal = 0;

  for (let index = 0; index < dayCount; index += 1) {
    const remainingSeconds = input.durationSeconds - routeSecondsCompleted;
    const drivingSeconds = Math.min(maximumDaySeconds, remainingSeconds);
    const startFraction = routeSecondsCompleted / input.durationSeconds;
    const endFraction =
      (routeSecondsCompleted + drivingSeconds) / input.durationSeconds;
    const restBreaks = Math.max(
      0,
      Math.ceil(drivingSeconds / stopEverySeconds) - 1,
    );
    const cumulativeFuelBefore = Math.floor(fuelStops * startFraction);
    const cumulativeFuelAfter =
      index === dayCount - 1
        ? fuelStops
        : Math.floor(fuelStops * endFraction);
    const dayFuelStops = Math.max(
      0,
      cumulativeFuelAfter - cumulativeFuelBefore,
    );
    const breakMinutes = restBreaks * minutesPerBreak;
    const arrival = nextDeparture + drivingSeconds * 1_000 + breakMinutes * 60_000;
    const reminders = [
      `${restBreaks} estimated rest ${restBreaks === 1 ? "break" : "breaks"}`,
      `${dayFuelStops} estimated fuel ${dayFuelStops === 1 ? "stop" : "stops"}`,
    ];
    if (input.children) reminders.push("Plan child comfort and meal breaks");
    if (input.pets) reminders.push("Plan pet relief, water, and leash checks");
    if (driverCount > 1) {
      reminders.push(`${driverCount} drivers available; confirm driver changes while parked`);
    }

    days.push({
      day: index + 1,
      departureAt: new Date(nextDeparture).toISOString(),
      arrivalAt: new Date(arrival).toISOString(),
      drivingSeconds,
      distanceMeters: input.distanceMeters * (endFraction - startFraction),
      routeStartPercent: Math.round(startFraction * 100),
      routeEndPercent: Math.round(endFraction * 100),
      restBreaks,
      fuelStops: dayFuelStops,
      overnightAfter: index < dayCount - 1,
      reminders,
    });
    routeSecondsCompleted += drivingSeconds;
    breakMinutesTotal += breakMinutes;
    nextDeparture = arrival + overnightRestHours * 3_600_000;
  }

  return {
    days,
    totalDrivingSeconds: input.durationSeconds,
    totalDistanceMeters: input.distanceMeters,
    estimatedBreakMinutes: breakMinutesTotal,
    assumptions: {
      maxDrivingHoursPerDay: input.maxDrivingHoursPerDay,
      stopFrequencyHours: input.stopFrequencyHours,
      minutesPerBreak,
      overnightRestHours,
      hotelLocationsSelected: false,
      stopLocationsSelected: false,
    },
  };
}

export function itineraryDistanceMiles(day: EstimatedItineraryDay) {
  return day.distanceMeters / METERS_PER_MILE;
}
