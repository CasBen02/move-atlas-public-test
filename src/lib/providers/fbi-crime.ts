import { z } from "zod";

import type { ProviderResult } from "./result";
import { available, unavailable } from "./result";
import { safeFetchJson } from "./safe-fetch";

export const FBI_CDE_SOURCE =
  "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/home";

const monthlySeriesSchema = z.record(z.string(), z.coerce.number());

const fbiSummarizedResponseSchema = z.object({
  offenses: z.object({
    rates: z.record(z.string(), monthlySeriesSchema),
    actuals: z.record(z.string(), monthlySeriesSchema),
  }),
  populations: z
    .object({
      population: z.record(z.string(), monthlySeriesSchema),
    })
    .optional(),
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
    const latestYear = new Date().getUTCFullYear() - 1;

    const fetchSummary = (
      offense: "violent-crime" | "property-crime",
    ) => {
      const url = new URL(
        `https://api.usa.gov/crime/fbi/cde/summarized/state/${state}/${offense}`,
      );

      url.searchParams.set("api_key", this.apiKey!.trim());
      url.searchParams.set("from", `01-${latestYear - 2}`);
      url.searchParams.set("to", `12-${latestYear}`);

      return safeFetchJson({
        provider: "FBI Crime Data Explorer",
        source: FBI_CDE_SOURCE,
        url,
        parser: {
          parse(raw: unknown) {
            return fbiSummarizedResponseSchema.parse(raw);
          },
        },
        coverage: `State-level monthly ${offense.replace("-", " ")} data.`,
        caveats: [
          "Reported crime does not measure every crime that occurred.",
          "State-level context should not be interpreted as city- or neighborhood-level risk.",
        ],
        timeoutMs: 8_000,
        maximumAttempts: 3,
      });
    };

    const violentResult = await fetchSummary("violent-crime");

    if (violentResult.status === "unavailable") {
      return violentResult;
    }

    const propertyResult = await fetchSummary("property-crime");

    if (propertyResult.status === "unavailable") {
      return propertyResult;
    }

    const selectOffenseSeries = (
      groups: Record<string, Record<string, number>>,
    ) => {
      const entries = Object.entries(groups);

      return (
        entries.find(([label]) => {
          const normalized = label.toLowerCase();

          return (
            normalized.includes("offense") &&
            !normalized.includes("united states")
          );
        })?.[1] ??
        entries.find(([label]) =>
          label.toLowerCase().includes("offense"),
        )?.[1] ??
        null
      );
    };

    const selectPopulationSeries = (
      groups?: Record<string, Record<string, number>>,
    ) => {
      if (!groups) return null;

      const entries = Object.entries(groups);

      return (
        entries.find(
          ([label]) =>
            !label.toLowerCase().includes("united states"),
        )?.[1] ??
        entries[0]?.[1] ??
        null
      );
    };

    const violentActuals = selectOffenseSeries(
      violentResult.data.offenses.actuals,
    );
    const violentRates = selectOffenseSeries(
      violentResult.data.offenses.rates,
    );
    const propertyActuals = selectOffenseSeries(
      propertyResult.data.offenses.actuals,
    );
    const propertyRates = selectOffenseSeries(
      propertyResult.data.offenses.rates,
    );

    if (
      !violentActuals ||
      !violentRates ||
      !propertyActuals ||
      !propertyRates
    ) {
      return unavailable({
        reason: "invalid_response",
        message:
          "The FBI Crime Data Explorer response did not contain state offense data.",
        retryable: false,
        meta: {
          provider: "FBI Crime Data Explorer",
          source: FBI_CDE_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "State-level reported-crime summaries.",
          caveats: [],
        },
      });
    }

    const valuesForYear = (
      series: Record<string, number>,
      year: number,
    ) =>
      Object.entries(series)
        .filter(([period]) => period.endsWith(`-${year}`))
        .map(([, value]) => value)
        .filter(Number.isFinite);

    const year = [latestYear, latestYear - 1, latestYear - 2].find(
      (candidate) =>
        valuesForYear(violentActuals, candidate).length >= 12 &&
        valuesForYear(violentRates, candidate).length >= 12 &&
        valuesForYear(propertyActuals, candidate).length >= 12 &&
        valuesForYear(propertyRates, candidate).length >= 12,
    );

    if (!year) {
      return unavailable({
        reason: "insufficient_coverage",
        message:
          "The FBI Crime Data Explorer did not provide a complete recent year.",
        retryable: false,
        meta: {
          provider: "FBI Crime Data Explorer",
          source: FBI_CDE_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "State-level reported-crime summaries.",
          caveats: [],
        },
      });
    }

    const sum = (values: number[]) =>
      values.reduce((total, value) => total + value, 0);

    const average = (values: number[]) =>
      values.length > 0 ? sum(values) / values.length : 0;

    const violentCrimeCount = Math.round(
      sum(valuesForYear(violentActuals, year)),
    );
    const propertyCrimeCount = Math.round(
      sum(valuesForYear(propertyActuals, year)),
    );

    const violentMonthlyRate = sum(
      valuesForYear(violentRates, year),
    );
    const propertyMonthlyRate = sum(
      valuesForYear(propertyRates, year),
    );

    const populationSeries =
      selectPopulationSeries(
        violentResult.data.populations?.population,
      ) ??
      selectPopulationSeries(
        propertyResult.data.populations?.population,
      );

    const populationValues = populationSeries
      ? valuesForYear(populationSeries, year)
      : [];

    const derivedPopulations = [
      violentMonthlyRate > 0
        ? (violentCrimeCount / violentMonthlyRate) * 100_000
        : 0,
      propertyMonthlyRate > 0
        ? (propertyCrimeCount / propertyMonthlyRate) * 100_000
        : 0,
    ].filter((value) => Number.isFinite(value) && value > 0);

    const population = Math.round(
      populationValues.length > 0
        ? average(populationValues)
        : average(derivedPopulations),
    );

    if (population <= 0) {
      return unavailable({
        reason: "insufficient_coverage",
        message:
          "The FBI Crime Data Explorer did not provide usable population coverage.",
        retryable: false,
        meta: {
          provider: "FBI Crime Data Explorer",
          source: FBI_CDE_SOURCE,
          checkedAt: new Date().toISOString(),
          coverage: "State-level reported-crime summaries.",
          caveats: [],
        },
      });
    }

    return available(
      {
        stateAbbreviation: state,
        year,
        population,
        violentCrimeCount,
        propertyCrimeCount,
        violentCrimeRatePer100k:
          (violentCrimeCount / population) * 100_000,
        propertyCrimeRatePer100k:
          (propertyCrimeCount / population) * 100_000,
        caveats: [
          "This is state-level reported-crime context, not a neighborhood safety rating.",
          "Reporting participation and estimation methods may differ by year.",
        ],
      },
      {
        provider: "FBI Crime Data Explorer",
        source: FBI_CDE_SOURCE,
        retrievedAt: new Date().toISOString(),
        observedAt: `${year}-12-31T00:00:00.000Z`,
        coverage: `Complete state-level reported violent and property crime data for ${year}.`,
        caveats: [
          "Reported crime does not measure every crime that occurred.",
          "State-level context should not be interpreted as city- or neighborhood-level risk.",
        ],
      },
    );
  }
}
