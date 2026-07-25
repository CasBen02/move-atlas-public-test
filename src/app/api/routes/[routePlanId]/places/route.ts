import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  cacheKey,
  readProviderCache,
  writeProviderCache,
} from "@/lib/cache/provider-cache";
import { authorizeApiRequest, noStoreJson } from "@/lib/http/api-auth";
import {
  HereGeocodingProvider,
  type HerePlace,
  type ProviderResult,
} from "@/lib/providers";
import { decodeHereFlexiblePolyline } from "@/lib/domain/polyline";
import { haversineMeters } from "@/lib/domain/weather";

const categories = {
  fuel: "fuel station",
  travel_center: "truck stop travel center",
  hotel: "hotel",
  food: "restaurant",
  rest_area: "rest area",
  park: "park",
  pet_break: "dog park",
  urgent_care: "urgent care",
  veterinary: "veterinarian",
  repair: "truck repair",
  towing: "towing service",
  attraction: "tourist attraction",
} as const;

const querySchema = z.object({
  category: z.enum(Object.keys(categories) as [keyof typeof categories, ...(keyof typeof categories)[]]),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const summarySchema = z
  .object({
    sectionPolylines: z.array(z.string().min(1).max(5_000_000)).min(1).max(100),
  })
  .passthrough();

function queryIsNearSavedRoute(summaryValue: unknown, point: { lat: number; lng: number }) {
  const summary = summarySchema.parse(summaryValue);
  let closestMeters = Number.POSITIVE_INFINITY;
  let pointCount = 0;
  for (const polyline of summary.sectionPolylines) {
    const geometry = decodeHereFlexiblePolyline(polyline, {
      maximumPoints: 100_000,
    }).points;
    for (const routePoint of geometry) {
      closestMeters = Math.min(closestMeters, haversineMeters(point, routePoint));
      pointCount += 1;
      if (pointCount > 250_000) {
        throw new RangeError("Saved route geometry is too large.");
      }
    }
  }
  return closestMeters <= 10_000;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ routePlanId: string }> },
) {
  const auth = await authorizeApiRequest(request, { limit: 30 });
  if (!auth.ok) return auth.response;
  const { routePlanId } = await params;
  if (!z.uuid().safeParse(routePlanId).success) {
    return noStoreJson({ error: "Saved route not found." }, { status: 404 });
  }
  const parsed = querySchema.safeParse({
    category: request.nextUrl.searchParams.get("category"),
    lat: request.nextUrl.searchParams.get("lat"),
    lng: request.nextUrl.searchParams.get("lng"),
  });
  if (!parsed.success) {
    return noStoreJson(
      { error: "Choose a supported stop category on the selected route." },
      { status: 400 },
    );
  }

  const { data: savedRoute } = await auth.supabase
    .from("saved_route_plans")
    .select("id,move_plan_id,summary")
    .eq("id", routePlanId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!savedRoute) {
    return noStoreJson({ error: "Saved route not found." }, { status: 404 });
  }

  const point = {
    lat: Number(parsed.data.lat.toFixed(4)),
    lng: Number(parsed.data.lng.toFixed(4)),
  };
  try {
    if (!queryIsNearSavedRoute(savedRoute.summary, point)) {
      return noStoreJson(
        {
          error:
            "Place discovery must use a point on or near the selected saved route.",
        },
        { status: 400 },
      );
    }
  } catch {
    return noStoreJson(
      { error: "The saved route geometry is unavailable for place discovery." },
      { status: 422 },
    );
  }
  const searchText = categories[parsed.data.category];
  const key = cacheKey({
    routePlanId,
    category: parsed.data.category,
    point,
  });
  const cached = await readProviderCache<ProviderResult<HerePlace[]>>({
    provider: "HERE Geocoding and Search v7",
    operation: "route-place-discovery",
    key,
    userId: auth.user.id,
  });
  let result: ProviderResult<HerePlace[]>;
  if (cached?.state === "cached") {
    result =
      cached.value.status === "available"
        ? {
            ...cached.value,
            meta: { ...cached.value.meta, freshness: cached.state },
          }
        : cached.value;
  } else {
    const refreshed = await new HereGeocodingProvider({
      apiKey: process.env.HERE_SERVER_API_KEY,
    }).search({
      kind: "discover",
      query: searchText,
      at: point,
      limit: 8,
    });
    result =
      refreshed.status === "unavailable" &&
      cached?.state === "stale" &&
      cached.value.status === "available"
        ? {
            ...cached.value,
            meta: {
              ...cached.value.meta,
              freshness: "stale",
              caveats: [
                ...cached.value.meta.caveats,
                `The HERE place refresh failed (${refreshed.reason}); showing the most recent usable cached results.`,
              ],
            },
          }
        : refreshed;
    await writeProviderCache({
      provider: "HERE Geocoding and Search v7",
      operation: "route-place-discovery",
      key,
      value: refreshed,
      ttlSeconds: refreshed.status === "available" ? 15 * 60 : 60,
      staleSeconds: refreshed.status === "available" ? 60 * 60 : 60,
      userId: auth.user.id,
      movePlanId: savedRoute.move_plan_id,
      sourceIssuedAt:
        refreshed.status === "available" ? refreshed.meta.observedAt ?? null : null,
    });
  }

  if (result.status === "unavailable") {
    return noStoreJson(result, { status: result.retryable ? 503 : 422 });
  }
  return noStoreJson({
    ...result,
    category: parsed.data.category,
    queryPoint: point,
    distanceMeaning:
      "Approximate straight-line distance from the selected route sample as reported by HERE; route deviation and additional drive time are unavailable from this discovery request.",
  });
}
