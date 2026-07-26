"use client";

import { useEffect, useState } from "react";

type Position = { lat: number; lng: number };

type StopType =
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

type RouteStop = {
  providerPlaceId: string;
  name: string;
  address: string | null;
  position: Position;
  stopType: StopType;
  providerRetrievedAt: string | null;
};

type SavedCalculationInput = Record<string, unknown> & {
  movePlanId: string;
  waypoints?: RouteStop[];
  selectedAlternativeIndex?: number;
  alternatives?: number;
};

type LatestRouteResponse = {
  status?: string;
  stops?: RouteStop[];
  calculationInput?: SavedCalculationInput | null;
  error?: string;
  message?: string;
};

type HereSearchPlace = {
  id: string;
  title: string;
  position: Position | null;
  address?: { label?: string | null } | null;
};

type HereSearchResponse = {
  status?: string;
  data?: HereSearchPlace[];
  meta?: { retrievedAt?: string };
  error?: string;
  message?: string;
};

function responseMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  if (typeof record.error === "string" && record.error) return record.error;
  if (typeof record.message === "string" && record.message) return record.message;
  return fallback;
}

function coordinatesMatch(a: Position, b: Position) {
  return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lng - b.lng) < 0.00001;
}

export function CustomRouteStops({ movePlanId }: { movePlanId: string }) {
  const [savedInput, setSavedInput] = useState<SavedCalculationInput | null>(null);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HereSearchPlace[]>([]);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [loadingSavedRoute, setLoadingSavedRoute] = useState(true);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadLatestRoute() {
      setLoadingSavedRoute(true);
      setError("");
      try {
        const params = new URLSearchParams({ movePlanId });
        const response = await fetch(`/api/routes/latest?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const value = (await response.json().catch(() => ({}))) as LatestRouteResponse;
        if (!active) return;

        if (!response.ok || value.status !== "available" || !value.calculationInput) {
          setSavedInput(null);
          setStops([]);
          setError(
            responseMessage(
              value,
              "Calculate and save a route first, then add custom pass-through locations.",
            ),
          );
          return;
        }

        setSavedInput(value.calculationInput);
        setStops(value.stops ?? value.calculationInput.waypoints ?? []);
      } catch (caught) {
        if (
          active &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError("The latest saved route could not be loaded for custom editing.");
        }
      } finally {
        if (active) setLoadingSavedRoute(false);
      }
    }

    void loadLatestRoute();
    return () => {
      active = false;
      controller.abort();
    };
  }, [movePlanId]);

  async function searchLocation() {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Enter at least two characters for a city, address, or landmark.");
      return;
    }

    setSearching(true);
    setError("");
    setMessage("");
    setResults([]);
    try {
      const params = new URLSearchParams({ q: trimmed });
      const response = await fetch(`/api/areas/search?${params}`, {
        cache: "no-store",
      });
      const value = (await response.json().catch(() => ({}))) as HereSearchResponse;
      if (!response.ok || value.status !== "available") {
        setError(responseMessage(value, "HERE could not find that location."));
        return;
      }

      const usable = (value.data ?? []).filter(
        (place): place is HereSearchPlace & { position: Position } => Boolean(place.position),
      );
      setResults(usable);
      setRetrievedAt(value.meta?.retrievedAt ?? new Date().toISOString());
      if (!usable.length) setError("No usable location was returned for that search.");
    } catch {
      setError("The custom-stop search could not be reached.");
    } finally {
      setSearching(false);
    }
  }

  function addStop(place: HereSearchPlace & { position: Position }) {
    if (
      stops.some(
        (stop) =>
          stop.providerPlaceId === place.id || coordinatesMatch(stop.position, place.position),
      )
    ) {
      setMessage("That location is already in the route.");
      return;
    }
    if (stops.length >= 8) {
      setError("This route supports up to eight pass-through stops.");
      return;
    }

    setStops((current) => [
      ...current,
      {
        providerPlaceId: place.id,
        name: place.title,
        address: place.address?.label ?? null,
        position: place.position,
        // The current route API does not yet expose a dedicated custom-stop enum.
        // The name/address clearly identify this as a user-selected pass-through point.
        stopType: "attraction",
        providerRetrievedAt: retrievedAt,
      },
    ]);
    setResults([]);
    setQuery("");
    setError("");
    setMessage(`${place.title} added. Apply the custom route when the order is correct.`);
  }

  function moveStop(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    setStops((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeStop(index: number) {
    setStops((current) => current.filter((_, candidate) => candidate !== index));
    setMessage("Stop removed. Apply the custom route to save the change.");
  }

  async function applyCustomRoute() {
    if (!savedInput) {
      setError("Calculate and save a route before applying custom pass-through locations.");
      return;
    }

    setApplying(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/routes/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...savedInput,
          movePlanId,
          selectedAlternativeIndex: 0,
          alternatives: 2,
          waypoints: stops,
        }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok || value?.status !== "available") {
        setError(responseMessage(value, "The custom route could not be calculated."));
        return;
      }

      setMessage("Custom route saved. Reloading the updated route…");
      window.location.reload();
    } catch {
      setError("The custom route service could not be reached.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section
      aria-label="Custom route and pass-through stops"
      style={{
        marginTop: 18,
        padding: 16,
        border: "1px solid rgba(23, 59, 44, 0.16)",
        borderRadius: 14,
        background: "rgba(247, 250, 246, 0.9)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <span className="eyebrow">Custom route</span>
          <h3 style={{ marginBottom: 6 }}>Shape the route with pass-through locations</h3>
          <p style={{ margin: 0 }}>
            Add cities, addresses, or landmarks in the exact order the route should pass
            through them. Recalculate the base route first after changing vehicle or safety
            settings.
          </p>
        </div>
        <span className="status-chip neutral">Up to 8 stops</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 10,
          marginTop: 14,
        }}
      >
        <label style={{ margin: 0 }}>
          City, address, or landmark
          <input
            aria-label="Custom pass-through location"
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchLocation();
              }
            }}
            placeholder="Example: Memphis, TN or 123 Main Street"
            value={query}
          />
        </label>
        <button
          className="button secondary"
          disabled={searching || loadingSavedRoute}
          onClick={() => void searchLocation()}
          style={{ alignSelf: "end" }}
          type="button"
        >
          {searching ? "Searching HERE…" : "Find location"}
        </button>
      </div>

      {results.length ? (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {results.map((place) => (
            <article
              key={`${place.id}-${place.position?.lat}-${place.position?.lng}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: 11,
                border: "1px solid rgba(23, 59, 44, 0.14)",
                borderRadius: 10,
                background: "white",
              }}
            >
              <div>
                <strong>{place.title}</strong>
                <div style={{ fontSize: 13 }}>{place.address?.label ?? "Address unavailable"}</div>
              </div>
              <button
                className="button small"
                onClick={() =>
                  place.position && addStop(place as HereSearchPlace & { position: Position })
                }
                type="button"
              >
                Add
              </button>
            </article>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <strong>Pass-through order</strong>
        {stops.length ? (
          <ol style={{ display: "grid", gap: 8, margin: "10px 0 0", padding: 0 }}>
            {stops.map((stop, index) => (
              <li
                key={`${stop.providerPlaceId}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 10,
                  padding: 10,
                  border: "1px solid rgba(23, 59, 44, 0.14)",
                  borderRadius: 10,
                  background: "white",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: "#173b2c",
                    color: "white",
                    fontWeight: 800,
                  }}
                >
                  {index + 1}
                </span>
                <div>
                  <strong>{stop.name}</strong>
                  <div style={{ fontSize: 13 }}>{stop.address ?? "Address unavailable"}</div>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <button
                    aria-label={`Move ${stop.name} earlier`}
                    className="button small"
                    disabled={index === 0}
                    onClick={() => moveStop(index, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${stop.name} later`}
                    className="button small"
                    disabled={index === stops.length - 1}
                    onClick={() => moveStop(index, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    className="button small"
                    onClick={() => removeStop(index)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p style={{ marginBottom: 0 }}>
            No pass-through locations are currently applied. The route goes directly from
            origin to destination.
          </p>
        )}
      </div>

      {error ? (
        <p className="form-message error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="form-message" role="status" style={{ marginTop: 12 }}>
          {message}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button
          className="button primary"
          disabled={applying || loadingSavedRoute || !savedInput}
          onClick={() => void applyCustomRoute()}
          type="button"
        >
          {applying ? "Calculating custom route…" : "Apply custom route"}
        </button>
        {stops.length ? (
          <button
            className="button secondary"
            disabled={applying}
            onClick={() => {
              setStops([]);
              setMessage("All pass-through locations removed. Apply to return to a direct route.");
            }}
            type="button"
          >
            Clear all stops
          </button>
        ) : null}
      </div>
    </section>
  );
}
