"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { calculateFuel } from "@/lib/domain/fuel";
import { kwhPer100KmToMilesPerKwh } from "@/lib/domain/units";
import {
  buildEstimatedItinerary,
  itineraryDistanceMiles,
} from "@/lib/domain/itinerary";
import type {
  HerePlace,
  HereRouteAlternative,
  HereRoutePlan,
  NwsAlert,
  NwsPointWeather,
  ProviderResult,
} from "@/lib/providers";
import type { WorkspaceData } from "@/lib/data/types";
import type { WorkspaceActions } from "@/components/workspace/workspace-shell";
import { HereMap } from "@/components/map/here-map";

type RouteResponse = Extract<
  ProviderResult<HereRoutePlan>,
  { status: "available" }
> & {
  savedRoutePlanId: string;
  routeProfileId: string;
  savedAlternativeIndex: number;
  providerAlternativeIndex?: number;
  strategy:
    | "fastest"
    | "shortest"
    | "fuel_conscious"
    | "truck_suitable"
    | "weather_aware"
    | "custom";
  strategyDisclosure: {
    title: string;
    explanation: string;
    enforcement: "provider" | "provider_and_local_score" | "preference_only";
  };
  stops: PlannedRouteStop[];
  persistedRestrictions?: {
    segment_index: number | null;
    restriction_type: string;
    finding: string;
    severity: string;
    provider_description: string | null;
    location_name: string | null;
    entered_vehicle_value: number | string | null;
    known_restriction_value: number | string | null;
    safety_buffer_value: number | string | null;
    measurement_unit: string | null;
    source_name: string;
    source_reference: string | null;
    coverage_note: string;
    provider_retrieved_at: string;
  }[];
  restored?: boolean;
  fuelProfile?: {
    fuel_type: string;
    tank_or_battery_capacity: number | null;
    efficiency_value: number | null;
    efficiency_unit?: string | null;
    starting_capacity_percent: number | null;
    preferred_minimum_percent: number | null;
    trailer_enabled: boolean;
    loaded_status: string;
  } | null;
  travelSchedule?: {
    maxDrivingHoursPerDay: number;
    stopFrequencyHours: number;
    children?: boolean;
    pets?: boolean;
  } | null;
  calculationInput?: RouteCalculationPayload | null;
  weather: {
    results: ProviderResult<NwsPointWeather>[];
    cacheState: string;
    windRisks: {
      sampleIndex: number;
      point: { lat: number; lng: number };
      expectedArrival: string;
      componentMph: number;
      severity: "low" | "moderate" | "high" | "severe";
      source: string;
    }[];
    persistence: "saved" | "partial" | "unavailable";
    persistenceMessage: string | null;
  } | null;
};

type ActiveAlertsResponse =
  | {
      status: "available";
      source: string;
      sourceUrl: string;
      checkedAt: string;
      coverage: string;
      freshness: string;
      partial: boolean;
      sampleCount: number;
      availableSampleCount: number;
      alerts: {
        alert: NwsAlert;
        affectedSampleIndexes: number[];
        expectedArrivals: string[];
        retrievedAt: string;
        arrivalWindowMatch: boolean;
      }[];
    }
  | {
      status: "unavailable";
      checkedAt?: string;
      source?: string;
      message: string;
    };

type PlaceCategory =
  | "fuel"
  | "travel_center"
  | "hotel"
  | "food"
  | "rest_area"
  | "park"
  | "pet_break"
  | "urgent_care"
  | "veterinary"
  | "repair"
  | "towing"
  | "attraction";

type PlaceResponse = Extract<
  ProviderResult<HerePlace[]>,
  { status: "available" }
> & {
  category: PlaceCategory;
  queryPoint: { lat: number; lng: number };
  distanceMeaning: string;
};

type PlannedRouteStop = {
  providerPlaceId: string;
  name: string;
  address: string | null;
  position: { lat: number; lng: number };
  stopType: PlaceCategory;
  providerRetrievedAt: string | null;
};

type RouteCalculationPayload = {
  movePlanId: string;
  origin: FormDataEntryValue | null;
  destination: FormDataEntryValue | null;
  departureTime: string;
  strategy: FormDataEntryValue | null;
  alternatives: number;
  selectedAlternativeIndex: number;
  waypoints: PlannedRouteStop[];
  vehicle: {
    category: FormDataEntryValue | null;
    heightFeet: number;
    heightInches: number;
    widthFeet?: number;
    widthInches?: number;
    lengthFeet?: number;
    lengthInches: number;
    grossWeightPounds?: number;
    weightPerAxlePounds?: number;
    loadedStatus: FormDataEntryValue | null;
    heightVerified: boolean;
  };
  trailer: {
    enabled: boolean;
    heightFeet?: number;
    heightInches?: number;
    widthFeet?: number;
    widthInches?: number;
    lengthFeet?: number;
    lengthInches?: number;
    weightPounds?: number;
  };
  clearanceBufferInches: number;
  fuel: {
    type: string;
    efficiency: number;
    capacity: number;
    startingPercent: number;
    reservePercent: number;
    expectedPricePerUnit: number;
    emergencyBufferPercent: number;
  };
  party: {
    drivers: number;
    maxHoursPerDay: number;
    children: boolean;
    pets: boolean;
    stopFrequencyHours: number;
  };
  avoid: {
    tollRoads: boolean;
    ferries: boolean;
    controlledAccessHighways: boolean;
    difficultTurns: boolean;
    tunnels: boolean;
    dirtRoads: boolean;
  };
};

function tomorrowAtNine() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function miles(meters: number) {
  return Math.round(meters / 1_609.344).toLocaleString("en-US");
}

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.round((seconds % 3_600) / 60);
  return `${hours} hr ${minutes} min`;
}

function feetAndInches(meters: number) {
  const total = Math.round(meters / 0.0254);
  return `${Math.floor(total / 12)} ft ${total % 12} in`;
}

function fieldNumber(data: FormData, name: string, fallback = 0) {
  const parsed = Number(data.get(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function checkbox(data: FormData, name: string) {
  return data.get(name) === "on";
}

function routeSamplePoint(route: HereRouteAlternative | null) {
  const points = route?.sections.flatMap((section) => section.geometry) ?? [];
  return points[Math.floor((points.length - 1) / 2)] ?? null;
}

export function RouteCommandCenter({
  workspace,
}: {
  workspace: WorkspaceData;
  actions: WorkspaceActions;
}) {
  const [result, setResult] = useState<RouteResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastPayload, setLastPayload] =
    useState<RouteCalculationPayload | null>(null);
  const [plannedStops, setPlannedStops] = useState<PlannedRouteStop[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [trailer, setTrailer] = useState(false);
  const [heightVerified, setHeightVerified] = useState(false);
  const [fuelAssumptions, setFuelAssumptions] = useState({
    efficiency: 10,
    capacity: 31,
    start: 100,
    reserve: 20,
    price: 3.5,
    buffer: 10,
    trailer: false,
    loaded: true,
    electric: false,
  });
  const [movingMode, setMovingMode] = useState(false);
  const [passengerConfirmed, setPassengerConfirmed] = useState(false);
  const [activeAlerts, setActiveAlerts] =
    useState<ActiveAlertsResponse | null>(null);
  const [alertRefreshCycle, setAlertRefreshCycle] = useState(0);
  const [placeCategory, setPlaceCategory] =
    useState<PlaceCategory>("travel_center");
  const [placeResult, setPlaceResult] = useState<PlaceResponse | null>(null);
  const [placeError, setPlaceError] = useState("");
  const [placeBusy, setPlaceBusy] = useState(false);
  const [tripAssumptions, setTripAssumptions] = useState({
    departureTime: tomorrowAtNine(),
    drivers: 1,
    maxHoursPerDay: 8,
    children: false,
    pets: false,
    stopFrequencyHours: 2,
  });
  const [currentPosition, setCurrentPosition] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [positionCheckedAt, setPositionCheckedAt] = useState<string | null>(
    null,
  );

  const selected = result?.data.routes[selectedIndex] ?? null;
  const routeIncidents =
    selected?.sections.flatMap((section) => section.incidents) ?? [];
  const mapPlaces = useMemo<HerePlace[]>(() => {
    const discovered = placeResult?.data ?? [];
    const discoveredIds = new Set(discovered.map((place) => place.id));
    return [
      ...discovered,
      ...plannedStops
        .filter((stop) => !discoveredIds.has(stop.providerPlaceId))
        .map((stop) => ({
          id: stop.providerPlaceId,
          title: stop.name,
          resultType: "place",
          position: stop.position,
          accessPoints: [],
          address: {
            label: stop.address,
            countryCode: null,
            stateCode: null,
            state: null,
            county: null,
            city: null,
            district: null,
            postalCode: null,
          },
          distanceMeters: null,
          categories: [
            {
              id: stop.stopType,
              name: "Planned route stop",
              primary: true,
            },
          ],
          providerDetails: {
            contactsAvailable: false,
            openingHoursAvailable: false,
          },
          unverifiedFields: [
            "parking suitability",
            "vehicle accessibility",
            "pet policy",
            "operating hours",
          ],
        })),
    ];
  }, [placeResult, plannedStops]);
  const selectedIsSaved =
    result !== null && selectedIndex === result.savedAlternativeIndex;
  const fuel = useMemo(() => {
    if (!selected) return null;
    try {
      return calculateFuel({
        routeMiles: selected.lengthMeters / 1_609.344,
        efficiencyMilesPerUnit: fuelAssumptions.efficiency,
        fuelType: fuelAssumptions.electric ? "electric" : "regular",
        tankCapacityUnits: fuelAssumptions.capacity,
        startingFuelUnits:
          fuelAssumptions.capacity * (fuelAssumptions.start / 100),
        preferredMinimumRemainingUnits:
          fuelAssumptions.capacity * (fuelAssumptions.reserve / 100),
        expectedPricePerUnit: fuelAssumptions.price,
        towingPenaltyPercent: fuelAssumptions.trailer ? 12 : 0,
        loadPenaltyPercent: fuelAssumptions.loaded ? 8 : 0,
        cityDrivingShare: 0.15,
        cityPenaltyPercent: 10,
        emergencyBufferPercent: fuelAssumptions.buffer,
      });
    } catch {
      return null;
    }
  }, [fuelAssumptions, selected]);
  const itinerary = useMemo(() => {
    if (!selected) return null;
    try {
      return buildEstimatedItinerary({
        distanceMeters: selected.lengthMeters,
        durationSeconds: selected.durationSeconds,
        departureTime: tripAssumptions.departureTime,
        maxDrivingHoursPerDay: tripAssumptions.maxHoursPerDay,
        stopFrequencyHours: tripAssumptions.stopFrequencyHours,
        expectedFuelStops: fuel?.expectedStops ?? 0,
        children: tripAssumptions.children,
        pets: tripAssumptions.pets,
        drivers: tripAssumptions.drivers,
      });
    } catch {
      return null;
    }
  }, [fuel, selected, tripAssumptions]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const restore = async () => {
      setRestoring(true);
      try {
        const query = new URLSearchParams({ movePlanId: workspace.plan.id });
        const response = await fetch(`/api/routes/latest?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const value = (await response.json()) as RouteResponse;
        if (!active || value.status !== "available") return;
        setResult(value);
        setSelectedIndex(value.savedAlternativeIndex);
        setPlannedStops(value.stops ?? []);
        setLastPayload(value.calculationInput ?? null);
        if (value.calculationInput?.fuel) {
          const savedFuel = value.calculationInput.fuel;
          setFuelAssumptions((current) => ({
            ...current,
            efficiency: savedFuel.efficiency,
            capacity: savedFuel.capacity,
            start: savedFuel.startingPercent,
            reserve: savedFuel.reservePercent,
            price: savedFuel.expectedPricePerUnit,
            buffer: savedFuel.emergencyBufferPercent,
            trailer: Boolean(value.calculationInput?.trailer.enabled),
            loaded: value.calculationInput?.vehicle.loadedStatus === "loaded",
            electric: savedFuel.type === "electric",
          }));
        } else if (value.fuelProfile) {
          const profile = value.fuelProfile;
          const restoredEfficiency =
            profile.efficiency_unit === "kwh_per_100km" &&
            Number(profile.efficiency_value) > 0
              ? kwhPer100KmToMilesPerKwh(
                  Number(profile.efficiency_value),
                )
              : Number(profile.efficiency_value);
          const restoredCapacity = Number(profile.tank_or_battery_capacity);
          const restoredStart = Number(profile.starting_capacity_percent);
          const restoredReserve = Number(profile.preferred_minimum_percent);
          setFuelAssumptions((current) => ({
            ...current,
            efficiency:
              Number.isFinite(restoredEfficiency) &&
              restoredEfficiency > 0
                ? restoredEfficiency
                : current.efficiency,
            capacity:
              Number.isFinite(restoredCapacity) && restoredCapacity > 0
                ? restoredCapacity
                : current.capacity,
            start: Number.isFinite(restoredStart)
              ? restoredStart
              : current.start,
            reserve: Number.isFinite(restoredReserve)
              ? restoredReserve
              : current.reserve,
            trailer: profile.trailer_enabled,
            loaded: profile.loaded_status === "loaded",
            electric: profile.fuel_type === "electric",
          }));
        }
        if (value.travelSchedule) {
          setTripAssumptions((current) => ({
            ...current,
            maxHoursPerDay: value.travelSchedule?.maxDrivingHoursPerDay ?? current.maxHoursPerDay,
            stopFrequencyHours:
              value.travelSchedule?.stopFrequencyHours ?? current.stopFrequencyHours,
            children: value.travelSchedule?.children ?? current.children,
            pets: value.travelSchedule?.pets ?? current.pets,
          }));
        }
        if (value.calculationInput) {
          setTripAssumptions((current) => ({
            ...current,
            departureTime: value.calculationInput?.departureTime ?? current.departureTime,
            drivers: value.calculationInput?.party.drivers ?? current.drivers,
            maxHoursPerDay:
              value.calculationInput?.party.maxHoursPerDay ?? current.maxHoursPerDay,
            children:
              value.calculationInput?.party.children ?? current.children,
            pets: value.calculationInput?.party.pets ?? current.pets,
            stopFrequencyHours:
              value.calculationInput?.party.stopFrequencyHours ??
              current.stopFrequencyHours,
          }));
        }
      } catch (caught) {
        if (
          active &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError(
            "The latest saved route could not be restored. You can calculate it again.",
          );
        }
      } finally {
        if (active) setRestoring(false);
      }
    };
    void restore();
    return () => {
      active = false;
      controller.abort();
    };
  }, [workspace.plan.id]);

  useEffect(() => {
    const routePlanId = result?.savedRoutePlanId;
    if (!routePlanId || !selectedIsSaved) return;
    let active = true;
    let pending = false;
    let controller: AbortController | null = null;

    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/routes/${encodeURIComponent(routePlanId)}/alerts`,
          { cache: "no-store", signal: controller.signal },
        );
        const value = (await response.json()) as ActiveAlertsResponse;
        if (active) setActiveAlerts(value);
      } catch (caught) {
        if (
          active &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setActiveAlerts({
            status: "unavailable",
            message: "Active NWS alerts could not be refreshed. The app will retry.",
          });
        }
      } finally {
        pending = false;
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    alertRefreshCycle,
    result?.savedRoutePlanId,
    selectedIsSaved,
  ]);

  useEffect(() => {
    if (!movingMode || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setCurrentPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setPositionCheckedAt(new Date(position.timestamp).toISOString());
      },
      () => {
        setCurrentPosition(null);
        setPositionCheckedAt(null);
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [movingMode]);

  async function submitRoutePayload(
    payload: RouteCalculationPayload,
    options: { clearResultOnFailure?: boolean } = {},
  ) {
    setBusy(true);
    setError("");
    setActiveAlerts(null);
    setPlaceResult(null);
    setPlaceError("");
    try {
      const response = await fetch("/api/routes/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const value = (await response.json().catch(() => ({}))) as
        | RouteResponse
        | { error?: string; message?: string };
      if (!response.ok || !("status" in value) || value.status !== "available") {
        if (options.clearResultOnFailure) setResult(null);
        setError(
          ("error" in value && value.error) ||
            ("message" in value && value.message) ||
            "A real route is not available for those inputs.",
        );
        return false;
      }
      setResult(value);
      setSelectedIndex(value.savedAlternativeIndex);
      setPlannedStops(value.stops ?? payload.waypoints);
      setLastPayload({
        ...payload,
        selectedAlternativeIndex: value.savedAlternativeIndex,
        waypoints: value.stops ?? payload.waypoints,
      });
      return true;
    } catch {
      if (options.clearResultOnFailure) setResult(null);
      setError(
        "The route service could not be reached. Your previous saved route was not changed.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const departure = new Date(String(data.get("departureTime")));
    if (!Number.isFinite(departure.getTime())) {
      setError("Choose a valid moving date and departure time.");
      return;
    }
    const fuelType = String(data.get("fuelType"));
    const payload: RouteCalculationPayload = {
      movePlanId: workspace.plan.id,
      origin: data.get("origin"),
      destination: data.get("destination"),
      departureTime: departure.toISOString(),
      strategy: data.get("strategy"),
      alternatives: 2,
      selectedAlternativeIndex: 0,
      waypoints: plannedStops,
      vehicle: {
        category: data.get("vehicleCategory"),
        heightFeet: fieldNumber(data, "heightFeet"),
        heightInches: fieldNumber(data, "heightInches"),
        widthFeet: fieldNumber(data, "widthFeet") || undefined,
        widthInches: fieldNumber(data, "widthInches") || undefined,
        lengthFeet: fieldNumber(data, "lengthFeet") || undefined,
        lengthInches: 0,
        grossWeightPounds: fieldNumber(data, "grossWeight") || undefined,
        weightPerAxlePounds: fieldNumber(data, "axleWeight") || undefined,
        loadedStatus: data.get("loadedStatus"),
        heightVerified,
      },
      trailer: {
        enabled: trailer,
        heightFeet: trailer ? fieldNumber(data, "trailerHeightFeet") : undefined,
        heightInches: trailer
          ? fieldNumber(data, "trailerHeightInches")
          : undefined,
        widthFeet: trailer ? fieldNumber(data, "trailerWidthFeet") : undefined,
        widthInches: trailer ? 0 : undefined,
        lengthFeet: trailer ? fieldNumber(data, "trailerLengthFeet") : undefined,
        lengthInches: trailer ? 0 : undefined,
        weightPounds: trailer ? fieldNumber(data, "trailerWeight") : undefined,
      },
      clearanceBufferInches: fieldNumber(data, "clearanceBuffer", 6),
      fuel: {
        type: fuelType,
        efficiency: fieldNumber(data, "efficiency", 10),
        capacity: fieldNumber(data, "capacity", 31),
        startingPercent: fieldNumber(data, "startingPercent", 100),
        reservePercent: fieldNumber(data, "reservePercent", 20),
        expectedPricePerUnit: fieldNumber(data, "fuelPrice", 3.5),
        emergencyBufferPercent: fieldNumber(data, "fuelBuffer", 10),
      },
      party: {
        drivers: fieldNumber(data, "drivers", 1),
        maxHoursPerDay: fieldNumber(data, "maxHours", 8),
        children: checkbox(data, "children"),
        pets: checkbox(data, "pets"),
        stopFrequencyHours: fieldNumber(data, "stopFrequency", 2),
      },
      avoid: {
        tollRoads: checkbox(data, "avoidTolls"),
        ferries: checkbox(data, "avoidFerries"),
        controlledAccessHighways: checkbox(data, "avoidHighways"),
        difficultTurns: checkbox(data, "avoidDifficultTurns"),
        tunnels: checkbox(data, "avoidTunnels"),
        dirtRoads: true,
      },
    };
    setFuelAssumptions({
      efficiency: payload.fuel.efficiency,
      capacity: payload.fuel.capacity,
      start: payload.fuel.startingPercent,
      reserve: payload.fuel.reservePercent,
      price: payload.fuel.expectedPricePerUnit,
      buffer: payload.fuel.emergencyBufferPercent,
      trailer,
      loaded: payload.vehicle.loadedStatus === "loaded",
      electric: fuelType === "electric",
    });
    setTripAssumptions({
      departureTime: payload.departureTime,
      drivers: payload.party.drivers,
      maxHoursPerDay: payload.party.maxHoursPerDay,
      children: payload.party.children,
      pets: payload.party.pets,
      stopFrequencyHours: payload.party.stopFrequencyHours,
    });
    setSelectedIndex(0);
    await submitRoutePayload(payload, { clearResultOnFailure: true });
  }

  async function saveAlternative(index: number) {
    if (!lastPayload || !result?.data.routes[index]) {
      setError(
        "This restored route does not include its original inputs. Compare routes again before selecting another alternative.",
      );
      return;
    }
    await submitRoutePayload({
      ...lastPayload,
      selectedAlternativeIndex: index,
      waypoints: plannedStops,
    });
  }

  async function updateStops(stops: PlannedRouteStop[]) {
    if (!lastPayload) {
      setError(
        "Compare routes again before changing stops on this older saved route.",
      );
      return;
    }
    await submitRoutePayload({
      ...lastPayload,
      selectedAlternativeIndex: 0,
      waypoints: stops,
    });
  }

  async function addPlaceAsStop(place: HerePlace) {
    if (!place.position || plannedStops.some((stop) => stop.providerPlaceId === place.id)) {
      return;
    }
    await updateStops([
      ...plannedStops,
      {
        providerPlaceId: place.id,
        name: place.title,
        address: place.address.label,
        position: place.position,
        stopType: placeCategory,
        providerRetrievedAt: placeResult?.meta.retrievedAt ?? null,
      },
    ]);
  }

  async function discoverPlaces() {
    const point = routeSamplePoint(selected);
    if (!point || !result) return;
    if (!selectedIsSaved) {
      setPlaceError(
        "Save this route alternative before searching for stops along it.",
      );
      return;
    }
    setPlaceBusy(true);
    setPlaceError("");
    const query = new URLSearchParams({
      category: placeCategory,
      lat: String(point.lat),
      lng: String(point.lng),
    });
    try {
      const response = await fetch(
        `/api/routes/${encodeURIComponent(result.savedRoutePlanId)}/places?${query}`,
        { cache: "no-store" },
      );
      const value = (await response.json()) as
        | PlaceResponse
        | { error?: string; message?: string };
      if (!response.ok || !("status" in value) || value.status !== "available") {
        setPlaceResult(null);
        setPlaceError(
          ("error" in value && value.error) ||
            ("message" in value && value.message) ||
            "HERE place discovery is temporarily unavailable.",
        );
        return;
      }
      setPlaceResult(value);
    } catch {
      setPlaceResult(null);
      setPlaceError("HERE place discovery is temporarily unavailable.");
    } finally {
      setPlaceBusy(false);
    }
  }

  function enterMovingMode() {
    setMovingMode(true);
  }

  if (movingMode && selected) {
    const firstInstruction =
      selected.sections.flatMap((section) => section.actions)[0]?.instruction ??
      "Follow your verified navigation provider and posted road signs.";
    return (
      <section className="moving-day-mode">
        <div className="moving-day-top">
          <div>
            <span className="eyebrow lime">Moving Day · Passenger mode</span>
            <small>First planned maneuver</small>
            <h2>{firstInstruction}</h2>
          </div>
          <button className="button light" onClick={() => setMovingMode(false)}>
            Exit
          </button>
        </div>
        <HereMap route={selected} currentPosition={currentPosition} />
        <div className="moving-day-grid">
          <article>
            <span>Full planned route · not live remaining distance</span>
            <strong>{miles(selected.lengthMeters)} mi</strong>
          </article>
          <article>
            <span>Fuel plan</span>
            <strong>{fuel ? `${fuel.expectedStops} stops` : "Unavailable"}</strong>
          </article>
          <article>
            <span>Restriction status</span>
            <strong>
              {selected.notices.length
                ? `${selected.notices.length} provider notices`
                : "No conflict found in available data"}
            </strong>
          </article>
          <article>
            <span>Official weather alerts</span>
            <strong>
              {activeAlerts?.status === "available"
                ? activeAlerts.alerts.length
                  ? `${activeAlerts.alerts.length} active`
                  : "None returned at samples"
                : "Refresh unavailable"}
            </strong>
          </article>
        </div>
        <p className="driving-warning">
          {currentPosition && positionCheckedAt
            ? `The map location is updating with browser geolocation; last position received ${new Date(
                positionCheckedAt,
              ).toLocaleTimeString()}. Route distance and the first maneuver are still the full saved plan, not live navigation.`
            : "Live browser location is unavailable or permission was not granted. Route distance and maneuver text show the full saved plan."}
        </p>
        <p className="driving-warning">
          Do not interact with Move Atlas while driving. A passenger should operate
          this view. Follow official alerts, closures, rental guidance, posted signs,
          and professional navigation.
        </p>
      </section>
    );
  }

  return (
    <div className="section-stack">
      <form className="route-builder panel" onSubmit={calculate}>
        <div className="route-form-header">
          <div>
            <span className="eyebrow">Trip and vehicle</span>
            <h3>Build a route around what you are actually driving</h3>
          </div>
          <span className="status-chip neutral">HERE Routing v8</span>
        </div>
        <div className="form-grid three">
          <label>
            Starting address or city
            <input
              defaultValue={workspace.plan.origin_label ?? ""}
              name="origin"
              required
              maxLength={300}
            />
          </label>
          <label>
            Destination address or city
            <input
              defaultValue={workspace.plan.destination_label ?? ""}
              name="destination"
              required
              maxLength={300}
            />
          </label>
          <label>
            Departure
            <input
              defaultValue={tomorrowAtNine()}
              name="departureTime"
              required
              type="datetime-local"
            />
          </label>
          <label>
            Route approach
            <select name="strategy" defaultValue="truck_suitable">
              <option value="fastest">Fastest available route</option>
              <option value="shortest">Shortest practical route</option>
              <option value="truck_suitable">Prefer truck-suitable route</option>
              <option value="fuel_conscious">
                Fuel-conscious · local distance ranking
              </option>
              <option value="weather_aware">
                Weather comparison · post-route preference
              </option>
              <option value="custom">
                Custom · supported avoidances enforced
              </option>
            </select>
          </label>
          <label>
            Vehicle
            <select name="vehicleCategory" defaultValue="moving_truck">
              <option value="passenger_car">Passenger car</option>
              <option value="suv">SUV</option>
              <option value="pickup">Pickup truck</option>
              <option value="cargo_van">Cargo van</option>
              <option value="moving_truck">Moving truck</option>
              <option value="moving_truck_towing">Moving truck towing a vehicle</option>
              <option value="car_towing_trailer">Car towing a trailer</option>
              <option value="rv">Recreational vehicle</option>
              <option value="oversized">Oversized vehicle</option>
            </select>
          </label>
          <label>
            Loaded state
            <select name="loadedStatus" defaultValue="loaded">
              <option value="loaded">Loaded</option>
              <option value="lightly_loaded">Lightly loaded</option>
              <option value="unloaded">Unloaded</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>

        <details open>
          <summary>Vehicle dimensions and clearance</summary>
          <div className="form-grid four">
            <label>
              Height · feet
              <input name="heightFeet" type="number" min="2" max="30" defaultValue="12" required />
            </label>
            <label>
              Height · inches
              <input name="heightInches" type="number" min="0" max="11.99" step=".01" defaultValue="0" required />
            </label>
            <label>
              Width · feet
              <input name="widthFeet" type="number" min="0" max="30" step=".01" defaultValue="8.5" />
            </label>
            <label>
              Length · feet
              <input name="lengthFeet" type="number" min="4" max="196" step=".01" defaultValue="26" />
            </label>
            <label>
              Gross weight · lb
              <input name="grossWeight" type="number" min="1" max="440924" defaultValue="26000" />
            </label>
            <label>
              Weight per axle · lb
              <input name="axleWeight" type="number" min="1" max="220462" placeholder="If known" />
            </label>
            <label>
              Clearance buffer · inches
              <input name="clearanceBuffer" type="number" min="0" max="118" defaultValue="6" />
            </label>
            <label className="check-line dimension-confirm">
              <input
                checked={heightVerified}
                onChange={(event) => setHeightVerified(event.target.checked)}
                type="checkbox"
              />
              I checked the exact height on the vehicle or rental documentation.
            </label>
          </div>
          <p className="safety-note">
            Entered height is sent with the clearance buffer. Missing restriction data
            is never treated as proof of clearance.
          </p>
        </details>

        <details>
          <summary>Trailer or towed vehicle</summary>
          <label className="check-line">
            <input
              checked={trailer}
              onChange={(event) => setTrailer(event.target.checked)}
              type="checkbox"
            />
            A trailer or towed vehicle is attached
          </label>
          {trailer ? (
            <div className="form-grid five">
              <label>
                Height · ft
                <input name="trailerHeightFeet" type="number" min="0" max="30" defaultValue="7" />
              </label>
              <label>
                Height · in
                <input name="trailerHeightInches" type="number" min="0" max="11.99" defaultValue="0" />
              </label>
              <label>
                Width · ft
                <input name="trailerWidthFeet" type="number" min="0" max="30" defaultValue="8" />
              </label>
              <label>
                Length · ft
                <input name="trailerLengthFeet" type="number" min="2" max="131" defaultValue="16" />
              </label>
              <label>
                Weight · lb
                <input name="trailerWeight" type="number" min="0" max="220462" defaultValue="3500" />
              </label>
            </div>
          ) : null}
        </details>

        <details>
          <summary>Fuel, household, and route preferences</summary>
          <div className="form-grid four">
            <label>
              Fuel type
              <select name="fuelType" defaultValue="regular_gasoline">
                <option value="regular_gasoline">Regular gasoline</option>
                <option value="midgrade_gasoline">Mid-grade gasoline</option>
                <option value="premium_gasoline">Premium gasoline</option>
                <option value="diesel">Diesel</option>
                <option value="electric">Electric</option>
              </select>
            </label>
            <label>
              Efficiency · MPG or mi/kWh
              <input name="efficiency" type="number" step=".1" min=".1" defaultValue="10" />
            </label>
            <label>
              Tank / battery capacity
              <input name="capacity" type="number" step=".1" min=".1" defaultValue="31" />
            </label>
            <label>
              Estimated price per unit
              <input name="fuelPrice" type="number" step=".01" min="0" defaultValue="3.50" />
            </label>
            <label>
              Starting level · %
              <input name="startingPercent" type="number" min="0" max="100" defaultValue="100" />
            </label>
            <label>
              Reserve · %
              <input name="reservePercent" type="number" min="0" max="100" defaultValue="20" />
            </label>
            <label>
              Emergency buffer · %
              <input name="fuelBuffer" type="number" min="0" max="100" defaultValue="10" />
            </label>
            <label>
              Drivers
              <input name="drivers" type="number" min="1" max="20" defaultValue="1" />
            </label>
            <label>
              Max hours per day
              <input name="maxHours" type="number" min="1" max="24" defaultValue="8" />
            </label>
            <label>
              Stop every · hours
              <input name="stopFrequency" type="number" min=".5" max="8" step=".5" defaultValue="2" />
            </label>
            <label className="check-line">
              <input name="children" type="checkbox" />
              Children traveling
            </label>
            <label className="check-line">
              <input name="pets" type="checkbox" />
              Pets traveling
            </label>
          </div>
          <div className="chip-picker avoidance-picker">
            <label className="check-chip">
              <input name="avoidTolls" type="checkbox" /> Avoid tolls
            </label>
            <label className="check-chip">
              <input name="avoidFerries" type="checkbox" /> Avoid ferries
            </label>
            <label className="check-chip">
              <input name="avoidHighways" type="checkbox" /> Minimize controlled-access highways
            </label>
            <label className="check-chip">
              <input name="avoidDifficultTurns" type="checkbox" /> Avoid difficult turns
            </label>
            <label className="check-chip">
              <input name="avoidTunnels" type="checkbox" /> Avoid tunnels
            </label>
          </div>
        </details>

        {error ? (
          <p className="form-message error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button primary"
          disabled={busy || !heightVerified}
          type="submit"
        >
          {busy ? "Calculating and checking providers…" : "Compare real routes"}
        </button>
      </form>

      {!result ? (
        <section className="route-empty">
          <div className="route-line-illustration" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span className="eyebrow">
            {restoring ? "Checking saved routes" : "No route calculated yet"}
          </span>
          <h3>
            {restoring
              ? "Restoring your latest route…"
              : "The fastest route is only one possible answer."}
          </h3>
          <p>
            {restoring
              ? "Saved geometry and provider timestamps will appear when available."
              : "Add the actual vehicle profile to compare route geometry, distance, time, tolls, available restrictions, fuel, and ETA-aware NWS weather."}
          </p>
        </section>
      ) : (
        <>
          <section className="route-command-grid">
            <div className="route-map-column">
              <HereMap route={selected} places={mapPlaces} />
            </div>
            <aside className="route-summary-column">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Selected route</span>
                  <h3>Why this route?</h3>
                </div>
                <span className="status-chip success">{result.meta.freshness}</span>
              </div>
              <p>
                <strong>{result.strategyDisclosure.title}.</strong>{" "}
                {result.strategyDisclosure.explanation}
              </p>
              {!selectedIsSaved ? (
                <div className="coverage-warning">
                  <strong>
                    Route {String.fromCharCode(65 + selectedIndex)} is being compared,
                    but is not the saved route.
                  </strong>
                  <p>
                    Weather, alerts, and stop search remain unavailable until this
                    alternative is saved and recalculated.
                  </p>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void saveAlternative(selectedIndex)}
                    type="button"
                  >
                    {busy
                      ? "Saving route and refreshing data…"
                      : `Use Route ${String.fromCharCode(65 + selectedIndex)}`}
                  </button>
                </div>
              ) : null}
              <dl className="route-facts">
                <div>
                  <dt>Distance</dt>
                  <dd>{selected ? `${miles(selected.lengthMeters)} mi` : "—"}</dd>
                </div>
                <div>
                  <dt>Drive time</dt>
                  <dd>{selected ? duration(selected.durationSeconds) : "—"}</dd>
                </div>
                <div>
                  <dt>Tolls</dt>
                  <dd>
                    {selected?.tollTotalsByCurrency.USD === undefined
                      ? "Not supplied"
                      : `$${selected.tollTotalsByCurrency.USD.toFixed(2)}`}
                  </dd>
                </div>
                <div>
                  <dt>Fuel stops</dt>
                  <dd>{fuel ? fuel.expectedStops : "Unavailable"}</dd>
                </div>
              </dl>
              <div className="source-stamp">
                <strong>HERE Routing API v8</strong>
                <span>
                  Retrieved {new Date(result.meta.retrievedAt).toLocaleString()}
                </span>
                <small>{result.meta.coverage}</small>
              </div>
            </aside>
          </section>

          <section className="route-alternatives panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Alternatives</span>
                <h3>Compare before you commit</h3>
              </div>
            </div>
            <div className="alternative-grid">
              {result.data.routes.map((route, index) => (
                <button
                  className={index === selectedIndex ? "selected" : ""}
                  key={route.id}
                  onClick={() => {
                    setSelectedIndex(index);
                    setActiveAlerts(null);
                    setPlaceResult(null);
                    setPlaceError("");
                  }}
                  type="button"
                >
                  <span>
                    {result.restored && result.data.routes.length === 1
                      ? "Latest saved route"
                      : `Route ${String.fromCharCode(65 + index)}`}
                    {index === result.savedAlternativeIndex ? " · saved" : ""}
                  </span>
                  <strong>{miles(route.lengthMeters)} miles</strong>
                  <small>{duration(route.durationSeconds)}</small>
                  <em>
                    {route.notices.length
                      ? `${route.notices.length} provider notice(s)`
                      : "No conflict found in available data"}
                  </em>
                </button>
              ))}
            </div>
            <p className="itinerary-caveat">
              {result.strategyDisclosure.enforcement === "provider_and_local_score"
                ? "HERE enforced routing inputs; Move Atlas applied the disclosed local distance ranking."
                : result.strategyDisclosure.enforcement === "preference_only"
                  ? "This selection is a comparison preference, not an additional provider-enforced restriction."
                  : "The selected route approach uses supported HERE routing inputs."}
            </p>
          </section>

          <div className="content-grid two">
            <section className="panel safety-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Vehicle safety</span>
                  <h3>
                    {feetAndInches(
                      result.data.vehicleEvaluation.actualHeightMeters,
                    )}{" "}
                    entered height
                  </h3>
                </div>
                <span className="status-chip warning">Manual verification required</span>
              </div>
              <p>{result.data.vehicleEvaluation.coverageMessage}</p>
              {result.persistedRestrictions?.length ? (
                <div className="warning-list">
                  {result.persistedRestrictions.map((restriction, index) => (
                    <article
                      key={`${restriction.segment_index ?? "coverage"}-${restriction.restriction_type}-${index}`}
                    >
                      <strong>
                        {restriction.provider_description ??
                          restriction.restriction_type.replaceAll("_", " ")}
                      </strong>
                      <span>{restriction.coverage_note}</span>
                      <small>
                        {restriction.finding.replaceAll("_", " ")}
                        {restriction.entered_vehicle_value !== null
                          ? ` · entered ${Number(
                              restriction.entered_vehicle_value,
                            ).toFixed(2)} ${restriction.measurement_unit ?? ""}`
                          : ""}
                        {restriction.known_restriction_value !== null
                          ? ` · known limit ${Number(
                              restriction.known_restriction_value,
                            ).toFixed(2)} ${restriction.measurement_unit ?? ""}`
                          : ""}
                      </small>
                      <small>
                        {restriction.source_name} · retrieved{" "}
                        {new Date(
                          restriction.provider_retrieved_at,
                        ).toLocaleString()}
                      </small>
                    </article>
                  ))}
                </div>
              ) : selected?.notices.length ? (
                <div className="warning-list">
                  {selected.notices.map((notice, index) => (
                    <article key={`${notice.code}-${index}`}>
                      <strong>{notice.title}</strong>
                      <span>
                        {notice.clearanceAssessment?.message ??
                          "Provider restriction notice—review before departure."}
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="coverage-warning">
                  <strong>No conflict found in available HERE data</strong>
                  <p>
                    Clearance data unavailable for any unreported segment—manual
                    verification required. This is not a guarantee of safety, legality,
                    or route suitability.
                  </p>
                </div>
              )}
            </section>

            <section className="panel fuel-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Fuel plan</span>
                  <h3>
                    {fuel
                      ? `${fuel.expectedUnitsRequired.toFixed(1)} ${fuel.unit}`
                      : "Estimate unavailable"}
                  </h3>
                </div>
                <span className="status-chip neutral">User/regional estimate</span>
              </div>
              {fuel ? (
                <>
                  <div className="fuel-range">
                    <div>
                      <span>Best case</span>
                      <strong>${fuel.cost.bestCase.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Expected</span>
                      <strong>${fuel.cost.expected.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>High case</span>
                      <strong>${fuel.cost.highCase.toFixed(2)}</strong>
                    </div>
                  </div>
                  <p>
                    Includes load, towing, city-driving, and emergency-buffer
                    adjustments. No licensed station-price provider is configured, so
                    this is not a live station price.
                  </p>
                </>
              ) : null}
            </section>
          </div>

          <section className="panel safety-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">HERE route incidents</span>
                <h3>
                  {routeIncidents.length
                    ? `${routeIncidents.length} provider incident${
                        routeIncidents.length === 1 ? "" : "s"
                      } returned`
                    : "No incidents returned for this route response"}
                </h3>
              </div>
              <span className="status-chip neutral">
                {result.meta.freshness}
              </span>
            </div>
            {routeIncidents.length ? (
              <div className="warning-list">
                {routeIncidents.map((incident, index) => (
                  <article key={`${incident.id}-${index}`}>
                    <strong>
                      {incident.type.replaceAll("_", " ")} ·{" "}
                      {incident.criticality}
                    </strong>
                    <span>
                      {incident.description ??
                        "HERE did not supply a description for this incident."}
                    </span>
                    <small>
                      {incident.validFrom
                        ? `Valid from ${new Date(
                            incident.validFrom,
                          ).toLocaleString()}`
                        : "Start time not supplied"}
                      {incident.validUntil
                        ? ` · until ${new Date(
                            incident.validUntil,
                          ).toLocaleString()}`
                        : " · end time not supplied"}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p>
                An empty provider incident list is not proof that every road is open
                or unaffected. Check official transportation agencies and posted
                closures before departure.
              </p>
            )}
          </section>

          <section className="panel route-stops-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Useful stops</span>
                <h3>Discover real places near the selected route</h3>
              </div>
              <span className="status-chip neutral">HERE Search v7</span>
            </div>
            {plannedStops.length ? (
              <div className="place-grid">
                {plannedStops.map((stop, index) => (
                  <article className="place-card" key={stop.providerPlaceId}>
                    <span>Planned stop {index + 1}</span>
                    <strong>{stop.name}</strong>
                    <p>{stop.address ?? "Address not supplied"}</p>
                    <em>
                      Included as a HERE via waypoint. Access, hours, parking, and
                      policies remain unverified unless supplied separately.
                    </em>
                    <button
                      className="button small"
                      disabled={busy}
                      onClick={() =>
                        void updateStops(
                          plannedStops.filter(
                            (candidate) =>
                              candidate.providerPlaceId !==
                              stop.providerPlaceId,
                          ),
                        )
                      }
                      type="button"
                    >
                      Remove and recalculate
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="route-stop-controls">
              <label>
                Stop category
                <select
                  onChange={(event) =>
                    setPlaceCategory(event.target.value as PlaceCategory)
                  }
                  value={placeCategory}
                >
                  <option value="travel_center">
                    Travel centers · truck access unverified
                  </option>
                  <option value="fuel">Fuel stations</option>
                  <option value="hotel">Hotels</option>
                  <option value="food">Food</option>
                  <option value="rest_area">Rest areas</option>
                  <option value="park">Parks</option>
                  <option value="pet_break">Pet breaks</option>
                  <option value="urgent_care">Urgent care</option>
                  <option value="veterinary">Veterinary clinics</option>
                  <option value="repair">Repair services</option>
                  <option value="towing">Towing services</option>
                  <option value="attraction">Attractions</option>
                </select>
              </label>
              <button
                className="button secondary"
                disabled={placeBusy || busy || !selectedIsSaved}
                onClick={discoverPlaces}
                type="button"
              >
                {placeBusy
                  ? "Searching HERE…"
                  : !selectedIsSaved
                    ? "Save this route before searching"
                    : "Search near route midpoint"}
              </button>
            </div>
            {placeError ? (
              <p className="form-message error" role="alert">
                {placeError}
              </p>
            ) : null}
            {placeResult ? (
              <>
                <div className="place-grid">
                  {placeResult.data.map((place) => (
                    <article className="place-card" key={place.id}>
                      <span>
                        {place.categories.find((category) => category.primary)
                          ?.name ?? "HERE place"}
                      </span>
                      <strong>{place.title}</strong>
                      <p>{place.address.label ?? "Address not supplied"}</p>
                      <small>
                        {place.distanceMeters === null
                          ? "Distance from route sample unavailable"
                          : `${(place.distanceMeters / 1_609.344).toFixed(1)} mi from route sample`}
                      </small>
                      <em>
                        Route deviation, trailer access, parking, pet policy, and
                        prices are unverified.
                      </em>
                      <button
                        className="button small"
                        disabled={
                          busy ||
                          !place.position ||
                          plannedStops.some(
                            (stop) => stop.providerPlaceId === place.id,
                          )
                        }
                        onClick={() => void addPlaceAsStop(place)}
                        type="button"
                      >
                        {plannedStops.some(
                          (stop) => stop.providerPlaceId === place.id,
                        )
                          ? "Already planned"
                          : "Add stop and recalculate"}
                      </button>
                    </article>
                  ))}
                </div>
                <div className="source-stamp route-place-source">
                  <strong>HERE Geocoding and Search v7</strong>
                  <span>
                    Retrieved{" "}
                    {new Date(placeResult.meta.retrievedAt).toLocaleString()}
                  </span>
                  <small>{placeResult.distanceMeaning}</small>
                </div>
              </>
            ) : (
              <div className="empty-state compact">
                <strong>No stop category searched yet</strong>
                <p>
                  Search uses a real point near the middle of the selected route.
                  Missing provider details remain visibly unverified.
                </p>
              </div>
            )}
          </section>

          <section className="panel weather-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Weather along the route</span>
                <h3>Forecasts matched to expected arrival</h3>
              </div>
              <span className="status-chip neutral">
                National Weather Service ·{" "}
                {selectedIsSaved
                  ? result.weather?.cacheState ?? "unavailable"
                  : "not evaluated for this alternative"}
              </span>
            </div>
            <div className="active-alerts">
              <div>
                <strong>Active alert refresh</strong>
                <span>
                  {!selectedIsSaved
                    ? "Save this alternative to run an official alert check for its geometry."
                    : activeAlerts?.status === "available"
                      ? `${activeAlerts.freshness.replaceAll("_", " ")} · checked ${new Date(
                          activeAlerts.checkedAt,
                        ).toLocaleTimeString()}`
                      : activeAlerts?.checkedAt
                        ? `Unavailable · checked ${new Date(
                            activeAlerts.checkedAt,
                          ).toLocaleTimeString()}`
                        : "Checking official NWS alerts…"}
                </span>
              </div>
              {selectedIsSaved && activeAlerts?.status === "available" ? (
                activeAlerts.alerts.length ? (
                  <div className="active-alert-list">
                    {activeAlerts.alerts.map((item) => (
                      <a
                        href={item.alert.officialUrl ?? undefined}
                        key={item.alert.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <strong>
                          {item.alert.event} · {item.alert.severity}
                        </strong>
                        <span>
                          Expected route arrival{" "}
                          {new Date(item.expectedArrivals[0]).toLocaleString()}
                        </span>
                        <span>
                          {item.arrivalWindowMatch
                            ? "Arrival overlaps the official alert period—review, delay, or compare another route."
                            : "Active now; the sampled arrival is outside the current alert period."}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p>
                    No active alerts were returned at{" "}
                    {activeAlerts.availableSampleCount} sampled route points. This
                    is not a guarantee of unaffected conditions.
                  </p>
                )
              ) : selectedIsSaved &&
                activeAlerts?.status === "unavailable" ? (
                <div className="recoverable-alert-error">
                  <p>{activeAlerts.message}</p>
                  <button
                    className="button small"
                    onClick={() => setAlertRefreshCycle((value) => value + 1)}
                    type="button"
                  >
                    Retry alert check
                  </button>
                </div>
              ) : null}
              {selectedIsSaved && activeAlerts?.status === "available" ? (
                <small>{activeAlerts.coverage}</small>
              ) : null}
            </div>
            {selectedIsSaved &&
            result.weather?.results.some((item) => item.status === "available") ? (
              <div className="weather-timeline">
                {result.weather.results.map((item, index) =>
                  item.status === "available" ? (
                    <article key={`${item.data.point.lat}-${item.data.point.lng}-${index}`}>
                      <span>
                        {new Date(item.data.expectedArrival).toLocaleString([], {
                          weekday: "short",
                          hour: "numeric",
                        })}
                      </span>
                      <strong>
                        {item.data.conditions.temperature}°
                        {item.data.conditions.temperatureUnit}
                      </strong>
                      <p>{item.data.conditions.condition}</p>
                      <small>
                        Wind {item.data.conditions.windSpeedRangeMph?.maximum.toFixed(0) ?? "—"} mph
                        {item.data.conditions.windDirection
                          ? ` ${item.data.conditions.windDirection}`
                          : ""}
                        {item.data.gridConditions?.windGustMph
                          ? ` · gusts ${item.data.gridConditions.windGustMph.toFixed(0)}`
                          : ""}
                      </small>
                      <small>
                        Precipitation{" "}
                        {item.data.gridConditions
                          ?.precipitationProbabilityPercent ??
                        item.data.conditions
                          .precipitationProbabilityPercent ??
                        "—"}
                        % · humidity{" "}
                        {item.data.conditions.relativeHumidityPercent ?? "—"}%
                      </small>
                      <small>
                        Visibility{" "}
                        {item.data.gridConditions?.visibilityMiles === null ||
                        item.data.gridConditions?.visibilityMiles === undefined
                          ? "unavailable"
                          : `${item.data.gridConditions.visibilityMiles.toFixed(
                              1,
                            )} mi`}
                        {(item.data.gridConditions?.snowfallInches ?? 0) > 0
                          ? ` · snow ${item.data.gridConditions?.snowfallInches?.toFixed(
                              1,
                            )} in`
                          : ""}
                        {(item.data.gridConditions?.iceAccumulationInches ?? 0) >
                        0
                          ? ` · ice ${item.data.gridConditions?.iceAccumulationInches?.toFixed(
                              2,
                            )} in`
                          : ""}
                      </small>
                      {result.weather?.windRisks.find(
                        (risk) => risk.sampleIndex === index,
                      ) ? (
                        <em>
                          Derived crosswind concern:{" "}
                          {result.weather.windRisks.find(
                            (risk) => risk.sampleIndex === index,
                          )?.severity}{" "}
                          ·{" "}
                          {result.weather.windRisks
                            .find((risk) => risk.sampleIndex === index)
                            ?.componentMph.toFixed(0)}{" "}
                          mph component. Based on NWS wind, route bearing, and
                          the entered vehicle profile; not an official safety
                          determination.
                        </em>
                      ) : (
                        <em>Crosswind component unavailable at this sample.</em>
                      )}
                      {item.data.componentFailures.length ? (
                        <small>
                          {item.data.componentFailures
                            .map((failure) => failure.message)
                            .join(" ")}
                        </small>
                      ) : null}
                      <small>
                        Forecast issued{" "}
                        {item.data.forecastIssuedAt
                          ? new Date(
                              item.data.forecastIssuedAt,
                            ).toLocaleString()
                          : "time unavailable"}{" "}
                        · retrieved{" "}
                        {new Date(item.meta.retrievedAt).toLocaleString()}
                      </small>
                      {item.data.alerts.map((alert) => (
                        <a
                          className="weather-alert"
                          href={alert.officialUrl ?? undefined}
                          key={alert.id}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {alert.event} · {alert.severity}
                        </a>
                      ))}
                    </article>
                  ) : (
                    <article className="unavailable" key={`unavailable-${index}`}>
                      <span>Segment {index + 1}</span>
                      <strong>Forecast unavailable</strong>
                      <p>{item.message}</p>
                    </article>
                  ),
                )}
              </div>
            ) : (
              <div className="empty-state compact">
                <strong>
                  {selectedIsSaved
                    ? "Route weather is unavailable"
                    : "Weather is not shown for an unsaved alternative"}
                </strong>
                <p>
                  {selectedIsSaved
                    ? "NWS coverage may be outside the U.S., temporarily unavailable, or not configured with an operator contact identity."
                    : "Save this alternative first so its own geometry, arrival schedule, forecasts, and alerts can be evaluated."}
                </p>
              </div>
            )}
            {selectedIsSaved && result.weather?.persistenceMessage ? (
              <p className="form-message error" role="status">
                {result.weather.persistenceMessage}
              </p>
            ) : null}
          </section>

          {itinerary ? (
            <section className="panel itinerary-plan">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Multi-day trip plan</span>
                  <h3>
                    {itinerary.days.length}{" "}
                    {itinerary.days.length === 1
                      ? "driving day"
                      : "driving days"}
                  </h3>
                </div>
                <span className="status-chip neutral">Estimated plan</span>
              </div>
              <div className="itinerary-days">
                {itinerary.days.map((day) => (
                  <article key={day.day}>
                    <div>
                      <span>Day {day.day}</span>
                      <strong>
                        {new Date(day.departureAt).toLocaleDateString([], {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                      </strong>
                    </div>
                    <dl>
                      <div>
                        <dt>Depart</dt>
                        <dd>
                          {new Date(day.departureAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>Drive</dt>
                        <dd>{duration(day.drivingSeconds)}</dd>
                      </div>
                      <div>
                        <dt>Distance</dt>
                        <dd>{Math.round(itineraryDistanceMiles(day))} mi</dd>
                      </div>
                      <div>
                        <dt>Arrive</dt>
                        <dd>
                          {new Date(day.arrivalAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </dd>
                      </div>
                    </dl>
                    <p>
                      {day.restBreaks} rest break
                      {day.restBreaks === 1 ? "" : "s"} · {day.fuelStops} fuel
                      stop{day.fuelStops === 1 ? "" : "s"}
                    </p>
                    {day.overnightAfter ? (
                      <em>
                        Estimated overnight near {day.routeEndPercent}% of the
                        route; hotel not selected.
                      </em>
                    ) : (
                      <em>Planned destination arrival</em>
                    )}
                  </article>
                ))}
              </div>
              <p className="itinerary-caveat">
                Based on HERE driving time and distance, the entered daily driving
                limit, and estimated breaks. Stop positions, hotels, hours, and
                availability are not selected or verified.
              </p>
            </section>
          ) : null}

          <section className="panel itinerary-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Directions</span>
                <h3>Step-by-step route instructions</h3>
              </div>
            </div>
            <ol className="directions-list">
              {selected?.sections
                .flatMap((section) => section.actions)
                .slice(0, 24)
                .map((action, index) => (
                  <li key={`${action.offset}-${index}`}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>
                        {action.instruction || "Continue on the selected route"}
                      </strong>
                      <small>
                        {action.lengthMeters
                          ? `${(action.lengthMeters / 1_609.344).toFixed(1)} mi`
                          : ""}
                      </small>
                    </div>
                  </li>
                ))}
            </ol>
          </section>

          <section className="moving-day-entry panel">
            <div>
              <span className="eyebrow">Moving Day mode</span>
              <h3>Large controls and only essential travel context</h3>
              <p>
                Geolocation is optional and used in the browser only after permission.
              </p>
            </div>
            <label className="check-line">
              <input
                checked={passengerConfirmed}
                onChange={(event) => setPassengerConfirmed(event.target.checked)}
                type="checkbox"
              />
              I am a passenger, or the vehicle is safely parked.
            </label>
            <button
              className="button primary"
              disabled={!passengerConfirmed || !selectedIsSaved}
              onClick={enterMovingMode}
              type="button"
            >
              {selectedIsSaved
                ? "Enter Moving Day mode"
                : "Save this route before Moving Day mode"}
            </button>
          </section>

          <section className="safety-disclaimer">
            <strong>Decision support, never a safety guarantee</strong>
            <p>
              Verify critical clearance, weight, access, closures, wind, and weather
              with official transportation agencies, posted signs, rental-company
              guidance, official alerts, and professional commercial-routing tools.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
