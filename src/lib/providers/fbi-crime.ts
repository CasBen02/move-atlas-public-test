import { z } from "zod";

import type { ProviderResult } from "./result";
import { unavailable } from "./result";
import { safeFetchJson } from "./safe-fetch";

export const FBI_CDE_SOURCE =
  "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/home";

const nullableNumber = z.coerce.number().nullable();

const fbiEstimateResponseSchema = z.object({
  results: z.array(
    z.object({
      year: z.coerce.number(),
      state_abbr: z.string().nullable().optional(),
      population: nullableNumber,
      violent_crime: nullableNumber,
      property_crime: nullableNumber,
      homicide: nullableNumber.optional(),
      robbery: nullableNumber.optional(),
      aggravated_assault: nullableNumber.optional(),
      burglary: nullableNumber.optional(),
      larceny: nullableNumber.optional(),
      motor_vehicle_theft: nullableNumber.optional(),
      caveats: z.string().nullable().optional(),
    }),
  ),
});

export interface FbiCrimeProfile {
  stateAbbreviation: string;
  year: number;
  population: number;
  violentCrimeCount: number;
  propertyCrimeCount: number;
  violentCrimeRatePer100k: number;
  propertyCrimeRatePer100k: number;
  caveats: string[];
}

export class FbiCrimeProvider {
  constructor(private readonly apiKey?: string) {}

  async stateProfile(
    stateAbbreviation: string,
  ): Promise<ProviderResult<FbiCrimeProfile>> {
    const state = stateAbbreviation.trim().toUpperCase();

    if (!/^[A-Z]{2}$/.test(state)) {
      return unavailable({
        reason: "unsupported_location",
        message: "A valid two-letter state abbreviation is required.",
        retryable: false,
        meta: {
          provider: "FBI Crime Data Explorer",
          source: FBI_CDE_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "State-level reported-crime estimates.",
          caveats: [],
        },
      });
    }

    if (!this.apiKey?.trim()) {
      return unavailable({
        reason: "not_configured",
        message: "The FBI Crime Data Explorer API key is not configured.",
        retryable: false,
        meta: {
          provider: "FBI Crime Data Explorer",
          source: FBI_CDE_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "State-level reported-crime estimates.",
          caveats: [],
        },
      });
    }

    const url = new URL(
      `https://api.usa.gov/crime/fbi/sapi/api/estimates/states/${state}`,
    );
    url.searchParams.set("API_KEY", this.apiKey.trim());
    url.searchParams.set("per_page", "100");

    return safeFetchJson({
      provider: "FBI Crime Data Explorer",
      source: FBI_CDE_SOURCE,
      url,
      parser: {
        parse(raw: unknown): FbiCrimeProfile {
          const parsed = fbiEstimateResponseSchema.parse(raw);
          const latest = [...parsed.results]
            .filter(
              (row) =>
                row.population !== null &&
                row.population > 0 &&
                row.violent_crime !== null &&
                row.property_crime !== null,
            )
            .sort((a, b) => b.year - a.year)[0];

          if (
            !latest ||
            latest.population === null ||
            latest.violent_crime === null ||
            latest.property_crime === null
          ) {
            throw new Error("No complete FBI estimate was available.");
          }

          return {
            stateAbbreviation: state,
            year: latest.year,
            population: latest.population,
            violentCrimeCount: latest.violent_crime,
            propertyCrimeCount: latest.property_crime,
            violentCrimeRatePer100k:
              (latest.violent_crime / latest.population) * 100_000,
            propertyCrimeRatePer100k:
              (latest.property_crime / latest.population) * 100_000,
            caveats: [
              "This is state-level reported-crime context, not a neighborhood safety rating.",
              "Reporting participation and estimation methods may differ by year.",
              ...(latest.caveats ? [latest.caveats] : []),
            ],
          };
        },
      },
      coverage:
        "Latest complete state-level violent and property crime estimate.",
      caveats: [
        "Reported crime does not measure every crime that occurred.",
        "State-level context should not be interpreted as city- or neighborhood-level risk.",
      ],
      timeoutMs: 8_000,
      maximumAttempts: 3,
    });
  }
}
