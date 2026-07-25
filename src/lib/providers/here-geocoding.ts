import { z } from "zod";

import type { ProviderResult } from "./result";
import { unavailable } from "./result";
import { safeFetchJson } from "./safe-fetch";

export const HERE_GEOCODING_SOURCE =
  "https://www.here.com/docs/bundle/geocoding-and-search-api-v7-api-reference";
const HERE_GEOCODE_ENDPOINT = "https://geocode.search.hereapi.com/v1/geocode";
const HERE_REVERSE_ENDPOINT = "https://revgeocode.search.hereapi.com/v1/revgeocode";
const HERE_AUTOSUGGEST_ENDPOINT = "https://autosuggest.search.hereapi.com/v1/autosuggest";
const HERE_DISCOVER_ENDPOINT = "https://discover.search.hereapi.com/v1/discover";

const herePositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const hereAddressSchema = z
  .object({
    label: z.string().optional(),
    countryCode: z.string().optional(),
    countryName: z.string().optional(),
    stateCode: z.string().optional(),
    state: z.string().optional(),
    county: z.string().optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    street: z.string().optional(),
    postalCode: z.string().optional(),
    houseNumber: z.string().optional(),
  })
  .passthrough();

const hereSearchItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    resultType: z.string().optional(),
    address: hereAddressSchema.optional(),
    position: herePositionSchema.optional(),
    access: z.array(herePositionSchema).optional(),
    distance: z.number().nonnegative().optional(),
    categories: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            primary: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional(),
    contacts: z.array(z.unknown()).optional(),
    openingHours: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const hereGeocodingResponseSchema = z
  .object({
    items: z.array(hereSearchItemSchema),
  })
  .passthrough();

export const hereAutosuggestResponseSchema = z
  .object({
    items: z.array(hereSearchItemSchema),
  })
  .passthrough();

export type HereSearchRawResponse = z.infer<typeof hereGeocodingResponseSchema>;

export interface HerePlace {
  id: string;
  title: string;
  resultType: string | null;
  position: { lat: number; lng: number } | null;
  accessPoints: { lat: number; lng: number }[];
  address: {
    label: string | null;
    countryCode: string | null;
    stateCode: string | null;
    state: string | null;
    county: string | null;
    city: string | null;
    district: string | null;
    postalCode: string | null;
  };
  distanceMeters: number | null;
  categories: { id: string; name: string | null; primary: boolean }[];
  providerDetails: {
    contactsAvailable: boolean;
    openingHoursAvailable: boolean;
  };
  unverifiedFields: string[];
}

function mapPlaces(raw: HereSearchRawResponse): HerePlace[] {
  return raw.items.flatMap((item) => {
    const position = item.position ?? item.access?.[0];
    if (!position) return [];
    return [
      {
        id: item.id,
        title: item.title,
        resultType: item.resultType ?? null,
        position,
        accessPoints: item.access ?? [],
        address: {
          label: item.address?.label ?? null,
          countryCode: item.address?.countryCode ?? null,
          stateCode: item.address?.stateCode ?? null,
          state: item.address?.state ?? null,
          county: item.address?.county ?? null,
          city: item.address?.city ?? null,
          district: item.address?.district ?? null,
          postalCode: item.address?.postalCode ?? null,
        },
        distanceMeters: item.distance ?? null,
        categories:
          item.categories?.map((category) => ({
            id: category.id,
            name: category.name ?? null,
            primary: category.primary ?? false,
          })) ?? [],
        providerDetails: {
          contactsAvailable: Boolean(item.contacts?.length),
          openingHoursAvailable: Boolean(item.openingHours?.length),
        },
        unverifiedFields: [
          "parking suitability",
          "vehicle accessibility",
          "pet policy",
          "admission price",
        ],
      },
    ];
  });
}

export type HereSearchRequest =
  | { kind: "geocode"; query: string; limit?: number }
  | { kind: "reverse"; at: { lat: number; lng: number }; limit?: number }
  | { kind: "autosuggest"; query: string; at: { lat: number; lng: number }; limit?: number }
  | { kind: "discover"; query: string; at: { lat: number; lng: number }; limit?: number };

export function buildHereSearchUrl(request: HereSearchRequest, apiKey: string): URL {
  if (!apiKey.trim()) throw new Error("HERE search credential is required.");
  const endpoint =
    request.kind === "geocode"
      ? HERE_GEOCODE_ENDPOINT
      : request.kind === "reverse"
        ? HERE_REVERSE_ENDPOINT
        : request.kind === "autosuggest"
          ? HERE_AUTOSUGGEST_ENDPOINT
          : HERE_DISCOVER_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("limit", String(Math.min(Math.max(request.limit ?? 8, 1), 20)));
  if (request.kind === "reverse") {
    herePositionSchema.parse(request.at);
    url.searchParams.set("at", `${request.at.lat},${request.at.lng}`);
  } else {
    if (!request.query.trim()) throw new RangeError("Search text is required.");
    url.searchParams.set("q", request.query.trim());
    if ("at" in request) {
      herePositionSchema.parse(request.at);
      url.searchParams.set("at", `${request.at.lat},${request.at.lng}`);
    }
  }
  return url;
}

export class HereGeocodingProvider {
  constructor(
    private readonly config: {
      apiKey?: string;
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async search(request: HereSearchRequest): Promise<ProviderResult<HerePlace[]>> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) {
      return unavailable({
        reason: "not_configured",
        message: "Place search is unavailable because the application owner has not configured HERE.",
        retryable: false,
        meta: {
          provider: "HERE Geocoding and Search v7",
          source: HERE_GEOCODING_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "No provider request was made.",
          caveats: ["Users are never asked to supply provider credentials."],
        },
      });
    }

    let url: URL;
    try {
      url = buildHereSearchUrl(request, apiKey);
    } catch {
      return unavailable({
        reason: "provider_error",
        message: "The place-search request is incomplete or invalid.",
        retryable: false,
        meta: {
          provider: "HERE Geocoding and Search v7",
          source: HERE_GEOCODING_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "No provider request was made.",
          caveats: [],
        },
      });
    }

    const response = await safeFetchJson({
      provider: "HERE Geocoding and Search v7",
      source: HERE_GEOCODING_SOURCE,
      url,
      parser: hereGeocodingResponseSchema,
      timeoutMs: this.config.timeoutMs ?? 8_000,
      maximumAttempts: 3,
      coverage: "Locations and provider details returned by HERE for this query.",
      caveats: [
        "Missing hours, prices, accessibility, parking, and policy details remain unverified.",
      ],
      fetchImplementation: this.config.fetchImplementation,
    });
    if (response.status === "unavailable") return response;
    return { ...response, data: mapPlaces(response.data) };
  }
}
