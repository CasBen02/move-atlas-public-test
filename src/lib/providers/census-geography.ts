import { z } from "zod";

import type { CensusGeography } from "./census-acs";
import { CENSUS_ACS_SOURCE } from "./census-acs";
import type { HerePlace } from "./here-geocoding";
import type { ProviderResult } from "./result";
import { unavailable } from "./result";
import { safeFetchJson } from "./safe-fetch";

export const US_STATE_FIPS_BY_POSTAL_CODE: Readonly<Record<string, string>> = {
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
  DE: "10",
  DC: "11",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
  AS: "60",
  GU: "66",
  MP: "69",
  PR: "72",
  VI: "78",
};

export type CensusGeographyHint =
  | "auto"
  | "zip"
  | "place"
  | "county"
  | "neighborhood";

export interface ResolvedCensusGeography {
  geography: CensusGeography;
  matchedOfficialName: string;
  selectedPlaceLabel: string;
  resolution:
    | "zip_code_tabulation_area"
    | "census_place"
    | "city_context_for_neighborhood"
    | "county_context";
  representsSelectedPlaceDirectly: boolean;
  contextMessage: string;
}

const geographyRowsSchema = z.array(z.array(z.union([z.string(), z.null()])));

interface GeographyListRow {
  name: string;
  stateFips: string;
  code: string;
}

export function stateCodeToFips(stateCode: string | null): string | null {
  if (!stateCode) return null;
  const normalized = stateCode.toUpperCase().split("-").at(-1) ?? "";
  return US_STATE_FIPS_BY_POSTAL_CODE[normalized] ?? null;
}

function normalizedGeographyName(value: string): string {
  const beforeState = value.split(",")[0];
  return beforeState
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(city and borough|metropolitan government|consolidated government|unified government|urban county|municipality|borough|village|township|town|city|county|parish|census designated place|cdp|balance)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseCensusGeographyRows(
  raw: unknown,
  codeColumn: "place" | "county",
): GeographyListRow[] {
  const rows = geographyRowsSchema.parse(raw);
  if (rows.length < 2) return [];
  const header = rows[0];
  const nameIndex = header.indexOf("NAME");
  const stateIndex = header.indexOf("state");
  const codeIndex = header.indexOf(codeColumn);
  if (nameIndex < 0 || stateIndex < 0 || codeIndex < 0) {
    throw new Error("Census geography response omitted required columns.");
  }
  return rows.slice(1).flatMap((row) => {
    const name = row[nameIndex];
    const stateFips = row[stateIndex];
    const code = row[codeIndex];
    return name && stateFips && code ? [{ name, stateFips, code }] : [];
  });
}

export function exactCensusGeographyMatch(
  rows: readonly GeographyListRow[],
  selectedName: string,
): GeographyListRow | null {
  const normalizedSelected = normalizedGeographyName(selectedName);
  if (!normalizedSelected) return null;
  const matches = rows.filter(
    (row) => normalizedGeographyName(row.name) === normalizedSelected,
  );
  return matches.length === 1 ? matches[0] : null;
}

function listUrl(input: {
  year: number;
  stateFips: string;
  kind: "place" | "county";
  apiKey?: string;
}): URL {
  const url = new URL(`https://api.census.gov/data/${input.year}/acs/acs5`);
  url.searchParams.set("get", "NAME");
  url.searchParams.set("for", `${input.kind}:*`);
  url.searchParams.set("in", `state:${input.stateFips}`);
  if (input.apiKey?.trim()) url.searchParams.set("key", input.apiKey.trim());
  return url;
}

function isDirectPlaceSelection(place: HerePlace, hint: CensusGeographyHint): boolean {
  if (hint === "place") return true;
  if (hint === "neighborhood" || hint === "county" || hint === "zip") return false;
  return place.resultType === "locality";
}

function isPostalCodeSelection(place: HerePlace, hint: CensusGeographyHint): boolean {
  return (
    hint === "zip" ||
    place.resultType === "postalCode" ||
    place.resultType === "postalCodePoint"
  );
}

function isDirectCountySelection(place: HerePlace, hint: CensusGeographyHint): boolean {
  if (hint === "county") return true;
  if (hint !== "auto") return false;
  return place.resultType === "administrativeArea" && !place.address.city;
}

export class CensusGeographyResolver {
  constructor(
    private readonly config: {
      apiKey?: string;
      year?: number;
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {}

  async resolve(
    place: HerePlace,
    hint: CensusGeographyHint = "auto",
  ): Promise<ProviderResult<ResolvedCensusGeography>> {
    const checkedAt = new Date().toISOString();
    const countryCode = place.address.countryCode?.toUpperCase();
    if (countryCode && countryCode !== "USA" && countryCode !== "US") {
      return unavailable({
        reason: "unsupported_location",
        message: "Official launch area evidence is currently available only for U.S. locations.",
        retryable: false,
        meta: {
          provider: "U.S. Census Bureau ACS geography resolver",
          source: CENSUS_ACS_SOURCE,
          checkedAt,
          coverage: "U.S. Census geographies only.",
          caveats: [],
        },
      });
    }

    const zipCode = place.address.postalCode?.match(/^\d{5}/)?.[0] ?? null;
    if (isPostalCodeSelection(place, hint) && zipCode) {
      return {
        status: "available",
        data: {
          geography: { kind: "zip", zipCode },
          matchedOfficialName: `ZIP Code Tabulation Area ${zipCode}`,
          selectedPlaceLabel: place.title,
          resolution: "zip_code_tabulation_area",
          representsSelectedPlaceDirectly: true,
          contextMessage:
            "Evidence uses the Census ZIP Code Tabulation Area (ZCTA), which may not exactly match USPS ZIP boundaries.",
        },
        meta: {
          provider: "U.S. Census Bureau ACS geography resolver",
          source: CENSUS_ACS_SOURCE,
          retrievedAt: checkedAt,
          freshness: "recently_updated",
          coverage: `Resolved to ZIP Code Tabulation Area ${zipCode}.`,
          caveats: ["ZCTAs are Census statistical geographies, not USPS delivery areas."],
        },
      };
    }

    const stateFips = stateCodeToFips(place.address.stateCode);
    if (!stateFips) {
      return unavailable({
        reason: "insufficient_coverage",
        message: "A U.S. state could not be resolved for official area evidence.",
        retryable: false,
        meta: {
          provider: "U.S. Census Bureau ACS geography resolver",
          source: CENSUS_ACS_SOURCE,
          checkedAt,
          coverage: "No Census state FIPS code was resolved.",
          caveats: ["Choose a result with a city, county, state, or five-digit ZIP code."],
        },
      });
    }

    const year = this.config.year ?? new Date().getUTCFullYear() - 2;
    const directPlace = isDirectPlaceSelection(place, hint);
    const directCounty = isDirectCountySelection(place, hint);
    const cityName =
      hint === "neighborhood"
        ? place.address.city
        : directPlace
          ? place.address.city ?? place.title
          : place.address.city;
    if (hint !== "county" && cityName) {
      const response = await safeFetchJson({
        provider: "U.S. Census Bureau ACS geography resolver",
        source: CENSUS_ACS_SOURCE,
        url: listUrl({
          year,
          stateFips,
          kind: "place",
          apiKey: this.config.apiKey,
        }),
        parser: geographyRowsSchema,
        timeoutMs: this.config.timeoutMs ?? 8_000,
        maximumAttempts: 3,
        coverage: `Census places in state FIPS ${stateFips}.`,
        caveats: [],
        fetchImplementation: this.config.fetchImplementation,
      });
      if (response.status === "available") {
        const match = exactCensusGeographyMatch(
          parseCensusGeographyRows(response.data, "place"),
          cityName,
        );
        if (match) {
          const contextOnly = hint === "neighborhood" || !directPlace;
          return {
            status: "available",
            data: {
              geography: {
                kind: "place",
                stateFips: match.stateFips,
                placeFips: match.code,
              },
              matchedOfficialName: match.name,
              selectedPlaceLabel: place.title,
              resolution: contextOnly
                ? "city_context_for_neighborhood"
                : "census_place",
              representsSelectedPlaceDirectly: !contextOnly,
              contextMessage: contextOnly
                ? `Neighborhood-level Census evidence was not inferred. Measures describe the containing Census place: ${match.name}.`
                : `Measures describe the matched Census place: ${match.name}.`,
            },
            meta: {
              ...response.meta,
              coverage: contextOnly
                ? `Containing Census place context for ${place.title}.`
                : `Exact normalized Census place match for ${place.title}.`,
              caveats: contextOnly
                ? [
                    "City-level measures must not be interpreted as neighborhood- or property-level facts.",
                  ]
                : [],
            },
          };
        }
      } else if (response.reason === "authentication_failed" || response.reason === "rate_limited") {
        return response;
      }
    }

    const countyName = place.address.county;
    if (countyName) {
      const response = await safeFetchJson({
        provider: "U.S. Census Bureau ACS geography resolver",
        source: CENSUS_ACS_SOURCE,
        url: listUrl({
          year,
          stateFips,
          kind: "county",
          apiKey: this.config.apiKey,
        }),
        parser: geographyRowsSchema,
        timeoutMs: this.config.timeoutMs ?? 8_000,
        maximumAttempts: 3,
        coverage: `Counties in state FIPS ${stateFips}.`,
        caveats: [],
        fetchImplementation: this.config.fetchImplementation,
      });
      if (response.status === "unavailable") return response;
      const match = exactCensusGeographyMatch(
        parseCensusGeographyRows(response.data, "county"),
        countyName,
      );
      if (match) {
        return {
          status: "available",
          data: {
            geography: {
              kind: "county",
              stateFips: match.stateFips,
              countyFips: match.code,
            },
            matchedOfficialName: match.name,
            selectedPlaceLabel: place.title,
            resolution: "county_context",
            representsSelectedPlaceDirectly: directCounty,
            contextMessage:
              directCounty
                ? `Measures describe the matched county: ${match.name}.`
                : `A direct Census geography was not resolved. Measures describe the containing county: ${match.name}.`,
          },
          meta: {
            ...response.meta,
            coverage: `County context for ${place.title}.`,
            caveats:
              directCounty
                ? []
                : [
                    "County-level measures must not be interpreted as city-, neighborhood-, or property-level facts.",
                  ],
          },
        };
      }
    }

    return unavailable({
      reason: "insufficient_coverage",
      message: "A reliable Census place, county, or ZIP geography could not be matched.",
      retryable: false,
      meta: {
        provider: "U.S. Census Bureau ACS geography resolver",
        source: CENSUS_ACS_SOURCE,
        checkedAt,
        coverage: `No exact normalized official geography match for ${place.title}.`,
        caveats: ["Unsupported geographies remain unavailable rather than receiving default data."],
      },
    });
  }
}
