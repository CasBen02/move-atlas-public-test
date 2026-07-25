import { z } from "zod";

import type { ProviderResult } from "./result";
import { safeFetchJson } from "./safe-fetch";

export const CENSUS_ACS_SOURCE =
  "https://www.census.gov/data/developers/data-sets/acs-5year.html";

export type CensusGeography =
  | { kind: "place"; stateFips: string; placeFips: string }
  | { kind: "county"; stateFips: string; countyFips: string }
  | { kind: "zip"; zipCode: string }
  | { kind: "tract"; stateFips: string; countyFips: string; tractFips: string }
  | { kind: "metro"; metroCode: string };

export type CensusMeasureId =
  | "population"
  | "median_household_income"
  | "median_home_value"
  | "median_gross_rent"
  | "housing_units"
  | "vacancy_rate"
  | "owner_occupancy_rate"
  | "mean_commute_minutes"
  | "broadband_subscription_rate";

export interface CensusMeasure {
  id: CensusMeasureId;
  name: string;
  rawValue: number | null;
  unit: "people" | "dollars" | "units" | "percent" | "minutes";
  source: "U.S. Census Bureau American Community Survey 5-year estimates";
  geography: string;
  referencePeriod: string;
  retrievedAt: string;
  coverage: string;
  caveats: string[];
  unavailableMessage: string | null;
}
export interface CensusAreaProfile {
  name: string;
  geography: string;
  referenceYear: number;
  measures: CensusMeasure[];
}

const VARIABLES = {
  NAME: "NAME",
  population: "B01003_001E",
  medianHouseholdIncome: "B19013_001E",
  medianHomeValue: "B25077_001E",
  medianGrossRent: "B25064_001E",
  housingUnits: "B25001_001E",
  occupancyTotal: "B25002_001E",
  vacantUnits: "B25002_003E",
  tenureTotal: "B25003_001E",
  ownerOccupied: "B25003_002E",
  aggregateCommuteMinutes: "B08013_001E",
  commuteWorkers: "B08012_001E",
  internetHouseholds: "B28002_001E",
  broadbandHouseholds: "B28002_004E",
} as const;

const REQUEST_VARIABLES = Object.values(VARIABLES);

export const censusAcsResponseSchema = z.array(
  z.array(z.union([z.string(), z.null()])),
);

const ACS_SENTINELS = new Set([
  -999_999_999,
  -888_888_888,
  -666_666_666,
  -555_555_555,
  -333_333_333,
  -222_222_222,
]);

export function parseCensusEstimate(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (ACS_SENTINELS.has(numeric) || numeric <= -100_000_000) return null;
  return numeric;
}

function fips(value: string, length: number, label: string): string {
  if (!new RegExp(`^\\d{${length}}$`).test(value)) {
    throw new RangeError(`${label} must contain exactly ${length} digits.`);
  }
  return value;
}

export function describeCensusGeography(geography: CensusGeography): string {
  switch (geography.kind) {
    case "place":
      return `Census place ${geography.placeFips}, state ${geography.stateFips}`;
    case "county":
      return `County ${geography.countyFips}, state ${geography.stateFips}`;
    case "zip":
      return `ZIP Code Tabulation Area ${geography.zipCode}`;
    case "tract":
      return `Census tract ${geography.tractFips}, county ${geography.countyFips}, state ${geography.stateFips}`;
    case "metro":
      return `Metropolitan or micropolitan statistical area ${geography.metroCode}`;
  }
}

export function buildCensusAcsUrl(input: {
  year: number;
  geography: CensusGeography;
  apiKey?: string;
}): URL {
  if (!Number.isInteger(input.year) || input.year < 2009 || input.year > 2100) {
    throw new RangeError("ACS year is outside the supported range.");
  }
  const url = new URL(`https://api.census.gov/data/${input.year}/acs/acs5`);
  url.searchParams.set("get", REQUEST_VARIABLES.join(","));
  switch (input.geography.kind) {
    case "place":
      url.searchParams.set("for", `place:${fips(input.geography.placeFips, 5, "Place FIPS")}`);
      url.searchParams.set("in", `state:${fips(input.geography.stateFips, 2, "State FIPS")}`);
      break;
    case "county":
      url.searchParams.set("for", `county:${fips(input.geography.countyFips, 3, "County FIPS")}`);
      url.searchParams.set("in", `state:${fips(input.geography.stateFips, 2, "State FIPS")}`);
      break;
    case "zip":
      url.searchParams.set(
        "for",
        `zip code tabulation area:${fips(input.geography.zipCode, 5, "ZIP Code Tabulation Area")}`,
      );
      break;
    case "tract":
      url.searchParams.set("for", `tract:${fips(input.geography.tractFips, 6, "Tract FIPS")}`);
      url.searchParams.set(
        "in",
        `state:${fips(input.geography.stateFips, 2, "State FIPS")} county:${fips(input.geography.countyFips, 3, "County FIPS")}`,
      );
      break;
    case "metro":
      url.searchParams.set(
        "for",
        `metropolitan statistical area/micropolitan statistical area:${fips(input.geography.metroCode, 5, "Metro code")}`,
      );
      break;
  }
  if (input.apiKey?.trim()) url.searchParams.set("key", input.apiKey.trim());
  return url;
}

function divide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function measure(input: {
  id: CensusMeasureId;
  name: string;
  value: number | null;
  unit: CensusMeasure["unit"];
  geography: string;
  year: number;
  retrievedAt: string;
  coverage: string;
  caveats?: string[];
}): CensusMeasure {
  return {
    id: input.id,
    name: input.name,
    rawValue: input.value,
    unit: input.unit,
    source: "U.S. Census Bureau American Community Survey 5-year estimates",
    geography: input.geography,
    referencePeriod: `${input.year} ACS 5-year estimates`,
    retrievedAt: input.retrievedAt,
    coverage: input.coverage,
    caveats: input.caveats ?? [],
    unavailableMessage:
      input.value === null
        ? "Reliable data is not currently available for this measure."
        : null,
  };
}

export function parseCensusAcsProfile(input: {
  raw: unknown;
  geography: CensusGeography;
  year: number;
  retrievedAt: string;
}): CensusAreaProfile {
  const rows = censusAcsResponseSchema.parse(input.raw);
  if (rows.length < 2) throw new Error("Census response did not include a data row.");
  const headers = rows[0];
  const values = rows[1];
  if (headers.length !== values.length) {
    throw new Error("Census response headers did not match the data row.");
  }
  const row = new Map(headers.map((header, index) => [header, values[index]]));
  for (const variable of REQUEST_VARIABLES) {
    if (!row.has(variable)) throw new Error(`Census response omitted ${variable}.`);
  }

  const number = (variable: string) => parseCensusEstimate(row.get(variable));
  const name = row.get(VARIABLES.NAME) ?? describeCensusGeography(input.geography);
  const geography = `${name} (${describeCensusGeography(input.geography)})`;
  const occupancyTotal = number(VARIABLES.occupancyTotal);
  const vacantUnits = number(VARIABLES.vacantUnits);
  const tenureTotal = number(VARIABLES.tenureTotal);
  const ownerOccupied = number(VARIABLES.ownerOccupied);
  const aggregateCommute = number(VARIABLES.aggregateCommuteMinutes);
  const commuteWorkers = number(VARIABLES.commuteWorkers);
  const internetHouseholds = number(VARIABLES.internetHouseholds);
  const broadbandHouseholds = number(VARIABLES.broadbandHouseholds);
  const standardCoverage =
    "ACS estimate for the selected Census geography; it does not describe a specific neighborhood, block, or property.";

  return {
    name,
    geography,
    referenceYear: input.year,
    measures: [
      measure({
        id: "population",
        name: "Population",
        value: number(VARIABLES.population),
        unit: "people",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
      }),
      measure({
        id: "median_household_income",
        name: "Median household income",
        value: number(VARIABLES.medianHouseholdIncome),
        unit: "dollars",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
        caveats: ["Survey estimates have sampling error and are not current-year household records."],
      }),
      measure({
        id: "median_home_value",
        name: "Median value of owner-occupied housing units",
        value: number(VARIABLES.medianHomeValue),
        unit: "dollars",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
        caveats: ["This is not current listing inventory or a property appraisal."],
      }),
      measure({
        id: "median_gross_rent",
        name: "Median gross rent",
        value: number(VARIABLES.medianGrossRent),
        unit: "dollars",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
        caveats: ["This is a survey estimate, not a current apartment listing price."],
      }),
      measure({
        id: "housing_units",
        name: "Housing units",
        value: number(VARIABLES.housingUnits),
        unit: "units",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
      }),
      measure({
        id: "vacancy_rate",
        name: "Housing vacancy rate",
        value: divide(vacantUnits, occupancyTotal),
        unit: "percent",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
        caveats: ["Derived from ACS vacant and total housing-unit estimates."],
      }),
      measure({
        id: "owner_occupancy_rate",
        name: "Owner-occupancy rate",
        value: divide(ownerOccupied, tenureTotal),
        unit: "percent",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
        caveats: ["Derived from ACS occupied housing-unit tenure estimates."],
      }),
      measure({
        id: "mean_commute_minutes",
        name: "Mean travel time to work",
        value:
          aggregateCommute === null || commuteWorkers === null || commuteWorkers <= 0
            ? null
            : aggregateCommute / commuteWorkers,
        unit: "minutes",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
        caveats: [
          "Derived from aggregate commute time for workers represented by the selected ACS table.",
          "This is not a drive-time estimate for a particular address.",
        ],
      }),
      measure({
        id: "broadband_subscription_rate",
        name: "Households with broadband of any type",
        value: divide(broadbandHouseholds, internetHouseholds),
        unit: "percent",
        geography,
        year: input.year,
        retrievedAt: input.retrievedAt,
        coverage: standardCoverage,
        caveats: ["Derived from ACS household internet-subscription estimates."],
      }),
    ],
  };
}

export class CensusAcsProvider {
  constructor(
    private readonly config: {
      apiKey?: string;
      year?: number;
      fetchImplementation?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {}

  async areaProfile(geography: CensusGeography): Promise<ProviderResult<CensusAreaProfile>> {
    const year = this.config.year ?? new Date().getUTCFullYear() - 2;
    const url = buildCensusAcsUrl({
      year,
      geography,
      apiKey: this.config.apiKey,
    });
    const response = await safeFetchJson({
      provider: "U.S. Census Bureau ACS",
      source: CENSUS_ACS_SOURCE,
      url,
      parser: censusAcsResponseSchema,
      timeoutMs: this.config.timeoutMs ?? 8_000,
      maximumAttempts: 3,
      coverage: `ACS ${year} 5-year estimates for ${describeCensusGeography(geography)}.`,
      caveats: [
        "Census geography does not necessarily match a named neighborhood or postal address.",
        "Survey estimates include margins of error; this launch view does not yet display those margins.",
      ],
      fetchImplementation: this.config.fetchImplementation,
    });
    if (response.status === "unavailable") return response;

    try {
      return {
        ...response,
        data: parseCensusAcsProfile({
          raw: response.data,
          geography,
          year,
          retrievedAt: response.meta.retrievedAt,
        }),
      };
    } catch {
      return {
        status: "unavailable",
        reason: "invalid_response",
        message: "Census returned data that could not be matched to the requested measures.",
        retryable: false,
        meta: {
          provider: "U.S. Census Bureau ACS",
          source: CENSUS_ACS_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: `The response did not contain a complete profile for ${describeCensusGeography(geography)}.`,
          caveats: [],
        },
      };
    }
  }
}
