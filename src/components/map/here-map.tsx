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
    Marker: new (point: { lat: number; lng: number }) => HereObject;
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
    if (points[0]) instance.addObject(new H.map.Marker(points[0]));
    if (points.at(-1)) instance.addObject(new H.map.Marker(points.at(-1)!));
    places.forEach((place) => {
      if (place.position) instance.addObject(new H.map.Marker(place.position));
    });
    if (currentPosition) {
      instance.addObject(new H.map.Marker(currentPosition));
    }
    routeBounds.current = line.getBoundingBox();
    instance.getViewModel().setLookAtData({
      bounds: routeBounds.current,
      padding: { top: 50, right: 50, bottom: 50, left: 50 },
    });
  }, [route, currentPosition, places, state]);

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
      <div className="map-attribution">Map and route data © HERE</div>
    </div>
  );
}
