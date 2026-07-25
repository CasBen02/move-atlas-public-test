"use client";

import { useEffect, useRef, useState } from "react";
import type { HerePlace, HereRouteAlternative } from "@/lib/providers";

type HereObject = unknown;
type HereMapInstance = {
  addObject: (object: HereObject) => void;
  removeObjects: (objects: HereObject[]) => void;
  getObjects: () => HereObject[];
  getViewModel: () => {
    setLookAtData: (data: { bounds: unknown; padding?: Record<string, number> }) => void;
  };
  getViewPort: () => { resize: () => void };
  getZoom: () => number;
  setZoom: (zoom: number, animate?: boolean) => void;
  dispose: () => void;
};

type HereGlobal = {
  service: {
    Platform: new (options: { apikey: string }) => {
      createDefaultLayers: () => {
        vector: { normal: { map: unknown } };
      };
    };
  };
  Map: new (
    node: HTMLElement,
    layer: unknown,
    options: { pixelRatio: number; center: { lat: number; lng: number }; zoom: number },
  ) => HereMapInstance;
  geo: {
    LineString: new () => {
      pushPoint: (point: { lat: number; lng: number }) => void;
      getBoundingBox: () => unknown;
    };
  };
  map: {
    Polyline: new (
      line: unknown,
      options: { style: { strokeColor: string; lineWidth: number; lineCap: string } },
    ) => HereObject;
    Icon: new (
      svg: string,
      options?: { anchor?: { x: number; y: number } },
    ) => HereObject;
    Marker: new (
      point: { lat: number; lng: number },
      options?: { icon?: HereObject },
    ) => HereObject;
  };
  mapevents: {
    MapEvents: new (map: HereMapInstance) => unknown;
    Behavior: new (events: unknown) => unknown;
  };
};

declare global {
  interface Window {
    H?: HereGlobal;
  }
}

let sdkPromise: Promise<HereGlobal> | null = null;
const NO_PLACES: Pick<HerePlace, "id" | "position">[] = [];

type RoutePoint = { lat: number; lng: number };
type MarkerKind = "start" | "end" | "incident" | "fuel" | "overnight" | "place" | "current";

const MARKERS: Record<
  MarkerKind,
  { label: string; fill: string; title: string }
> = {
  start: { label: "A", fill: "#2f6f47", title: "Route start" },
  end: { label: "B", fill: "#173b2c", title: "Route destination" },
  incident: { label: "!", fill: "#b42318", title: "HERE route incident" },
  fuel: { label: "F", fill: "#1f6feb", title: "Estimated fuel interval" },
  overnight: { label: "H", fill: "#7a3db8", title: "Estimated overnight point" },
  place: { label: "P", fill: "#b46a00", title: "Saved or searched place" },
  current: { label: "•", fill: "#0b7285", title: "Current position" },
};

function loadScript(url: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-here-src="${url}"]`,
    );
    if (existing?.dataset.loaded === "true") return resolve();
    const script = existing ?? document.createElement("script");
    script.src = url;
    script.async = false;
    script.dataset.hereSrc = url;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error("HERE SDK failed to load.")));
    if (!existing) document.head.appendChild(script);
  });
}

async function loadHereSdk() {
  if (window.H) return window.H;
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const cssUrl = "https://js.api.here.com/v3/3.2/mapsjs-ui.css";
      if (!document.querySelector(`link[href="${cssUrl}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssUrl;
        document.head.appendChild(link);
      }
      await loadScript("https://js.api.here.com/v3/3.2/mapsjs-core.js");
      await loadScript("https://js.api.here.com/v3/3.2/mapsjs-service.js");
      await loadScript("https://js.api.here.com/v3/3.2/mapsjs-mapevents.js");
      if (!window.H) throw new Error("HERE SDK did not initialize.");
      return window.H;
    })().catch((error) => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

function markerIcon(H: HereGlobal, kind: MarkerKind) {
  const marker = MARKERS[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42" role="img" aria-label="${marker.title}">
    <path fill="${marker.fill}" stroke="#ffffff" stroke-width="2" d="M17 1C8.2 1 1 8.2 1 17c0 11.7 16 24 16 24s16-12.3 16-24C33 8.2 25.8 1 17 1z"/>
    <circle cx="17" cy="17" r="10" fill="#ffffff"/>
    <text x="17" y="21" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="${marker.fill}">${marker.label}</text>
  </svg>`;
  return new H.map.Icon(svg, { anchor: { x: 17, y: 41 } });
}

function addMarker(
  H: HereGlobal,
  instance: HereMapInstance,
  point: RoutePoint | null | undefined,
  kind: MarkerKind,
) {
  if (!point) return;
  instance.addObject(
    new H.map.Marker(point, {
      icon: markerIcon(H, kind),
    }),
  );
}

function haversineMeters(a: RoutePoint, b: RoutePoint) {
  const radius = 6_371_000;
  const latitudeA = (a.lat * Math.PI) / 180;
  const latitudeB = (b.lat * Math.PI) / 180;
  const latitudeDelta = ((b.lat - a.lat) * Math.PI) / 180;
  const longitudeDelta = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const value =
    sinLatitude * sinLatitude +
    Math.cos(latitudeA) * Math.cos(latitudeB) * sinLongitude * sinLongitude;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function pointAtFraction(points: RoutePoint[], fraction: number): RoutePoint | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0];
  const boundedFraction = Math.max(0, Math.min(1, fraction));
  const segments: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = haversineMeters(points[index - 1], points[index]);
    segments.push(length);
    total += length;
  }
  if (total <= 0) {
    return points[Math.round((points.length - 1) * boundedFraction)] ?? points[0];
  }
  const target = total * boundedFraction;
  let traveled = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const next = traveled + segments[index];
    if (target <= next) {
      const segmentFraction =
        segments[index] <= 0 ? 0 : (target - traveled) / segments[index];
      const start = points[index];
      const end = points[index + 1];
      return {
        lat: start.lat + (end.lat - start.lat) * segmentFraction,
        lng: start.lng + (end.lng - start.lng) * segmentFraction,
      };
    }
    traveled = next;
  }
  return points.at(-1) ?? null;
}

function estimatedFuelStopCount(route: HereRouteAlternative | null) {
  if (!route) return 0;
  const miles = route.lengthMeters / 1_609.344;
  return Math.max(0, Math.min(8, Math.ceil(miles / 200) - 1));
}

function estimatedOvernightCount(route: HereRouteAlternative | null) {
  if (!route) return 0;
  return Math.max(0, Math.min(5, Math.ceil(route.durationSeconds / (8 * 3_600)) - 1));
}

function incidentPoints(route: HereRouteAlternative) {
  const seen = new Set<string>();
  const points: RoutePoint[] = [];
  for (const section of route.sections) {
    for (const incident of section.incidents) {
      if (seen.has(incident.id)) continue;
      seen.add(incident.id);
      const validOffset = incident.spanOffsets.find(
        (offset) => offset >= 0 && offset < section.geometry.length,
      );
      const fallbackOffset = Math.floor((section.geometry.length - 1) / 2);
      const point = section.geometry[validOffset ?? fallbackOffset];
      if (point) points.push(point);
    }
  }
  return points;
}

export function HereMap({
  route,
  currentPosition,
  places = NO_PLACES,
}: {
  route: HereRouteAlternative | null;
  currentPosition?: { lat: number; lng: number } | null;
  places?: Pick<HerePlace, "id" | "position">[];
}) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<HereMapInstance | null>(null);
  const routeBounds = useRef<unknown>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [retryCycle, setRetryCycle] = useState(0);
  const key = process.env.NEXT_PUBLIC_HERE_MAPS_API_KEY;
  const fuelMarkerCount = estimatedFuelStopCount(route);
  const overnightMarkerCount = estimatedOvernightCount(route);
  const incidentMarkerCount = route ? incidentPoints(route).length : 0;

  useEffect(() => {
    if (!node.current || !key) {
      setState("unavailable");
      return;
    }
    setState("loading");
    let active = true;
    let resize: ResizeObserver | null = null;

    void loadHereSdk()
      .then((H) => {
        if (!active || !node.current) return;
        const platform = new H.service.Platform({ apikey: key });
        const layers = platform.createDefaultLayers();
        map.current = new H.Map(node.current, layers.vector.normal.map, {
          pixelRatio: window.devicePixelRatio || 1,
          center: { lat: 39.5, lng: -98.35 },
          zoom: 4,
        });
        const events = new H.mapevents.MapEvents(map.current);
        new H.mapevents.Behavior(events);
        resize = new ResizeObserver(() => map.current?.getViewPort().resize());
        resize.observe(node.current);
        setState("ready");
      })
      .catch(() => setState("unavailable"));

    return () => {
      active = false;
      resize?.disconnect();
      map.current?.dispose();
      map.current = null;
    };
  }, [key, retryCycle]);

  useEffect(() => {
    const H = window.H;
    const instance = map.current;
    if (!H || !instance || !route) return;
    instance.removeObjects(instance.getObjects());
    const line = new H.geo.LineString();
    const points = route.sections.flatMap((section) => section.geometry);
    points.forEach((point) => line.pushPoint(point));
    instance.addObject(
      new H.map.Polyline(line, {
        style: {
          strokeColor: "#4f7a55",
          lineWidth: 7,
          lineCap: "round",
        },
      }),
    );

    addMarker(H, instance, points[0], "start");
    addMarker(H, instance, points.at(-1), "end");

    incidentPoints(route).forEach((point) => {
      addMarker(H, instance, point, "incident");
    });

    for (let index = 1; index <= fuelMarkerCount; index += 1) {
      addMarker(
        H,
        instance,
        pointAtFraction(points, index / (fuelMarkerCount + 1)),
        "fuel",
      );
    }

    for (let index = 1; index <= overnightMarkerCount; index += 1) {
      addMarker(
        H,
        instance,
        pointAtFraction(
          points,
          Math.min(0.95, (index * 8 * 3_600) / route.durationSeconds),
        ),
        "overnight",
      );
    }

    places.forEach((place) => {
      addMarker(H, instance, place.position, "place");
    });
    addMarker(H, instance, currentPosition, "current");

    routeBounds.current = line.getBoundingBox();
    instance.getViewModel().setLookAtData({
      bounds: routeBounds.current,
      padding: { top: 50, right: 50, bottom: 50, left: 50 },
    });
  }, [
    route,
    currentPosition,
    places,
    state,
    fuelMarkerCount,
    overnightMarkerCount,
  ]);

  function zoomBy(delta: number) {
    const instance = map.current;
    if (!instance) return;
    instance.setZoom(
      Math.max(2, Math.min(20, instance.getZoom() + delta)),
      true,
    );
  }

  function fitRoute() {
    const instance = map.current;
    if (!instance || !routeBounds.current) return;
    instance.getViewModel().setLookAtData({
      bounds: routeBounds.current,
      padding: { top: 50, right: 50, bottom: 50, left: 50 },
    });
  }

  if (!key) {
    return (
      <div className="map-unavailable">
        <strong>Interactive map unavailable</strong>
        <p>
          The application owner has not configured the domain-restricted HERE browser
          map credential. No user credential is needed.
        </p>
      </div>
    );
  }

  return (
    <div className="map-frame">
      <div ref={node} className="here-map" aria-label="Interactive route map" />
      {state === "loading" ? (
        <div className="map-loading" role="status">
          Loading the secure map…
        </div>
      ) : null}
      {state === "unavailable" ? (
        <div className="map-loading error" role="alert">
          <strong>HERE map tiles are temporarily unavailable.</strong>
          <button
            className="button small"
            onClick={() => setRetryCycle((value) => value + 1)}
            type="button"
          >
            Retry map
          </button>
        </div>
      ) : null}
      {state === "ready" ? (
        <div className="map-controls" aria-label="Map controls" role="group">
          <button
            aria-label="Zoom in"
            onClick={() => zoomBy(1)}
            type="button"
          >
            +
          </button>
          <button
            aria-label="Zoom out"
            onClick={() => zoomBy(-1)}
            type="button"
          >
            −
          </button>
          <button aria-label="Fit selected route" onClick={fitRoute} type="button">
            Fit
          </button>
        </div>
      ) : null}
      {state === "ready" && route ? (
        <div
          aria-label="Map marker legend"
          style={{
            position: "absolute",
            left: 12,
            bottom: 30,
            zIndex: 4,
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 10px",
            maxWidth: "calc(100% - 24px)",
            padding: "7px 9px",
            border: "1px solid rgba(23, 59, 44, 0.16)",
            borderRadius: 10,
            background: "rgba(255, 255, 255, 0.92)",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12)",
            fontSize: 11,
            lineHeight: 1.2,
            pointerEvents: "none",
          }}
        >
          {incidentMarkerCount > 0 ? (
            <span>! {incidentMarkerCount} incidents</span>
          ) : null}
          {fuelMarkerCount > 0 ? (
            <span>F {fuelMarkerCount} estimated fuel stops</span>
          ) : null}
          {overnightMarkerCount > 0 ? (
            <span>H {overnightMarkerCount} estimated overnight stops</span>
          ) : null}
          {places.length > 0 ? <span>P {places.length} saved places</span> : null}
        </div>
      ) : null}
      <div className="map-attribution">Map and route data © HERE</div>
    </div>
  );
}
