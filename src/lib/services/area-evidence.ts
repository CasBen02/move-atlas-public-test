import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  cacheKey,
  readProviderCache,
  writeProviderCache,
} from "@/lib/cache/provider-cache";
import {
  CensusAcsProvider,
  FbiCrimeProvider,
  CensusGeographyResolver,
  type CensusAreaProfile,
  type HerePlace,
  type ProviderResult,
  type ProviderUnavailable,
} from "@/lib/providers";
import { computeAreaScore } from "@/lib/domain/area-score";

type AreaWeights = {
  housing: number;
  reportedCrime: number;
  mobility: number;
  market: number;
  dailyLife: number;
  schools: number;
};

function scoreAgainstCeiling(value: number, ceiling: number) {
  if (ceiling <= 0) return null;
  if (value <= ceiling) return 100;
  return Math.max(0, Math.round((100 - ((value - ceiling) / ceiling) * 100) * 10) / 10);
}
function scoreMarketVacancy(value: number) {
  if (value >= 5 && value <= 10) return 100;

  const distance = value < 5 ? 5 - value : value - 10;
  return Math.max(0, Math.round((100 - distance * 12.5) * 10) / 10);
}
function display(value: number, unit: string) {
  if (unit === "dollars") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "minutes") return `${value.toFixed(1)} min`;
  return Math.round(value).toLocaleString("en-US");
}

const requestedAreaCategories = [
  ["housing", "Housing fit"],
  ["reportedCrime", "Reported crime context"],
  ["mobility", "Mobility and commute"],
  ["market", "Housing market context"],
  ["dailyLife", "Personal daily-life fit"],
  ["schools", "Public-school context"],
] as const;

async function persistUnavailableAreaEvidence(input: {
  userId: string;
  movePlanId: string;
  areaId: string;
  weights: AreaWeights;
  failure: ProviderUnavailable;
  geographyType?: string | null;
  geographyLabel?: string | null;
}) {
  const admin = createAdminClient();
  if (!admin) return null;
  const now = new Date();
  const staleAfter = new Date(
    now.getTime() + (input.failure.retryable ? 5 : 60) * 60 * 1_000,
  );
  const requestedWeightTotal = Object.values(input.weights).reduce(
    (sum, weight) => sum + Math.max(0, weight),
    0,
  );
  const { data: snapshot, error: snapshotError } = await admin
    .from("area_snapshots")
    .insert({
      user_id: input.userId,
      move_plan_id: input.movePlanId,
      area_id: input.areaId,
      status: "unavailable",
      weighted_score: null,
      requested_weight_total: requestedWeightTotal,
      supported_weight_total: 0,
      coverage_percent: 0,
      resolved_geographies: [],
      source_summary: [
        {
          name: input.failure.meta.provider,
          source: input.failure.meta.source,
          checkedAt: input.failure.meta.checkedAt,
          status: "unavailable",
        },
        
      ],
      caveats: [
        input.failure.message,
        ...(input.failure.meta.caveats ?? []),
      ],
      generated_at: now.toISOString(),
      stale_after: staleAfter.toISOString(),
      last_error_code: input.failure.reason,
    })
    .select("id")
    .single();
  if (snapshotError || !snapshot) return null;

  const rows = requestedAreaCategories.map(([key, name]) => ({
    user_id: input.userId,
    move_plan_id: input.movePlanId,
    area_id: input.areaId,
    snapshot_id: snapshot.id,
    measure_key: key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    measure_name: name,
    availability: "unavailable",
    raw_value: null,
    raw_display: null,
    unit: null,
    normalized_fit_score: null,
    applied_weight: null,
    source_name: input.failure.meta.provider,
    source_url: input.failure.meta.source.startsWith("https://")
      ? input.failure.meta.source
      : null,
    geography_type: input.geographyType ?? null,
    geography_label: input.geographyLabel ?? null,
    geography_identifier: null,
    reference_period: null,
    coverage_note: [
      input.failure.message,
      input.failure.meta.coverage,
    ]
      .filter(Boolean)
      .join(" "),
    caveats: [
      ...(input.failure.meta.caveats ?? []),
      "Reliable data is not currently available for this measure.",
    ],
    retrieved_at: null,
  }));
  const { error: metricsError } = await admin.from("area_metrics").insert(rows);
  if (metricsError) {
    await admin
      .from("area_snapshots")
      .delete()
      .eq("id", snapshot.id)
      .eq("user_id", input.userId);
    return null;
  }
  return { id: snapshot.id, generatedAt: now.toISOString() };
}

export async function loadOfficialAreaEvidence(input: {
  userId: string;
  movePlanId: string;
  areaId: string;
  place: HerePlace;
  hint?: "auto" | "zip" | "place" | "county" | "neighborhood";
  weights: AreaWeights;
  housingIntent: string | null;
  housingMonthlyCeilingDollars: number | null;
  commuteCeilingMinutes: number | null;
}) {
  const resolver = new CensusGeographyResolver({
    apiKey: process.env.CENSUS_API_KEY,
    year: 2024,
  });
  const crimeProvider = new FbiCrimeProvider(
  process.env.FBI_CDE_API_KEY,
);
  const resolution = await resolver.resolve(input.place, input.hint ?? "auto");
  if (resolution.status === "unavailable") {
    const score = computeAreaScore(
      requestedAreaCategories.map(([metricId]) => ({
        metricId,
        normalizedFitScore: null,
      })),
      input.weights,
    );
    const persisted = await persistUnavailableAreaEvidence({
      userId: input.userId,
      movePlanId: input.movePlanId,
      areaId: input.areaId,
      weights: input.weights,
      failure: resolution,
    });
    return {
      resolution,
      profile: null,
      snapshot: {
        id: persisted?.id,
        score,
        persisted: Boolean(persisted),
        generatedAt: persisted?.generatedAt,
      },
    };
  }

  const key = cacheKey({ year: 2024, geography: resolution.data.geography });
  const cached = await readProviderCache<ProviderResult<CensusAreaProfile>>({
    provider: "U.S. Census Bureau ACS",
    operation: "area-profile-2024",
    key,
  });
  let profile: ProviderResult<CensusAreaProfile>;
  if (cached?.state === "cached") {
    profile = cached.value;
    if (profile.status === "available") {
      profile = {
        ...profile,
        meta: { ...profile.meta, freshness: cached.state },
      };
    }
  } else {
    const refreshed = await new CensusAcsProvider({
      apiKey: process.env.CENSUS_API_KEY,
      year: 2024,
    }).areaProfile(resolution.data.geography);
    if (
      refreshed.status === "unavailable" &&
      cached?.state === "stale" &&
      cached.value.status === "available"
    ) {
      profile = {
        ...cached.value,
        meta: { ...cached.value.meta, freshness: "stale" },
      };
    } else {
      profile = refreshed;
      await writeProviderCache({
        provider: "U.S. Census Bureau ACS",
        operation: "area-profile-2024",
        key,
        value: profile,
        ttlSeconds:
          profile.status === "available" ? 30 * 24 * 60 * 60 : 60,
        staleSeconds:
          profile.status === "available" ? 90 * 24 * 60 * 60 : 4 * 60,
        sourceIssuedAt:
          profile.status === "available"
            ? profile.meta.observedAt ?? null
            : null,
      });
    }
  }
  if (profile.status === "unavailable") {
    const score = computeAreaScore(
      requestedAreaCategories.map(([metricId]) => ({
        metricId,
        normalizedFitScore: null,
      })),
      input.weights,
    );
    const persisted = await persistUnavailableAreaEvidence({
      userId: input.userId,
      movePlanId: input.movePlanId,
      areaId: input.areaId,
      weights: input.weights,
      failure: profile,
      geographyType: resolution.data.resolution,
      geographyLabel: resolution.data.contextMessage,
    });
    return {
      resolution,
      profile,
      snapshot: {
        id: persisted?.id,
        score,
        persisted: Boolean(persisted),
        generatedAt: persisted?.generatedAt,
      },
    };
  }
const stateAbbreviation =
  input.place.address.stateCode?.toUpperCase().split("-").at(-1) ?? "";

const crimeProfile = await crimeProvider.stateProfile(stateAbbreviation);
  const byId = new Map(
    profile.data.measures.map((measure) => [measure.id, measure]),
  );
  const housingMeasure =
    input.housingIntent === "buy"
      ? byId.get("median_home_value")
      : byId.get("median_gross_rent");
  const commuteMeasure = byId.get("mean_commute_minutes");
  const marketMeasure = byId.get("vacancy_rate");
  const incomeMeasure = byId.get("median_household_income");
const broadbandMeasure = byId.get("broadband_subscription_rate");
  const housingFit =
    housingMeasure?.rawValue !== null &&
    housingMeasure?.rawValue !== undefined &&
    input.housingMonthlyCeilingDollars
      ? scoreAgainstCeiling(
          housingMeasure.rawValue,
          input.housingMonthlyCeilingDollars,
        )
      : null;
  const mobilityFit =
    commuteMeasure?.rawValue !== null &&
    commuteMeasure?.rawValue !== undefined &&
    input.commuteCeilingMinutes
      ? scoreAgainstCeiling(
          commuteMeasure.rawValue,
          input.commuteCeilingMinutes,
        )
      : null;
const marketFit =
  marketMeasure?.rawValue !== null && marketMeasure?.rawValue !== undefined
    ? scoreMarketVacancy(marketMeasure.rawValue)
    : null;
  const incomeFit =
  incomeMeasure?.rawValue !== null &&
  incomeMeasure?.rawValue !== undefined
    ? Math.min(100, (incomeMeasure.rawValue / 75_000) * 100)
    : null;

const broadbandFit =
  broadbandMeasure?.rawValue !== null &&
  broadbandMeasure?.rawValue !== undefined
    ? broadbandMeasure.rawValue
    : null;

const dailyLifeFit =
  incomeFit !== null || broadbandFit !== null
    ? Math.round(
        ((incomeFit ?? 0) * 0.4 + (broadbandFit ?? 0) * 0.6) * 10,
      ) / 10
    : null;
  // Product-defined context references; these are not FBI safety thresholds.
const crimeFit =
  crimeProfile.status === "available"
    ? Math.round(
        (
          (scoreAgainstCeiling(
            crimeProfile.data.violentCrimeRatePer100k,
            400,
          ) ?? 0) *
            0.6 +
          (scoreAgainstCeiling(
            crimeProfile.data.propertyCrimeRatePer100k,
            2_000,
          ) ?? 0) *
            0.4
        ) * 10,
      ) / 10
    : null;
  const scoredMetrics = [
    { metricId: "housing", normalizedFitScore: housingFit },
    { metricId: "reportedCrime", normalizedFitScore: crimeFit },
    { metricId: "mobility", normalizedFitScore: mobilityFit },
    { metricId: "market", normalizedFitScore: marketFit },
    { metricId: "dailyLife", normalizedFitScore: dailyLifeFit },
    { metricId: "schools", normalizedFitScore: null },
  ];
  const areaScore = computeAreaScore(scoredMetrics, input.weights);
  const admin = createAdminClient();
  if (!admin) {
    return { resolution, profile, snapshot: { score: areaScore, persisted: false } };
  }
  const now = new Date();
  const { data: snapshot } = await admin
    .from("area_snapshots")
    .insert({
      user_id: input.userId,
      move_plan_id: input.movePlanId,
      area_id: input.areaId,
      status:
        areaScore.loadedCategoryCount === 0
          ? "unavailable"
          : areaScore.loadedCategoryCount === areaScore.requestedCategoryCount
            ? "available"
            : "partial",
      weighted_score: areaScore.score,
      requested_weight_total: Object.values(input.weights).reduce(
        (sum, weight) => sum + Math.max(0, weight),
        0,
      ),
     supported_weight_total:
  (housingFit === null ? 0 : input.weights.housing) +
  (crimeFit === null ? 0 : input.weights.reportedCrime) +
  (mobilityFit === null ? 0 : input.weights.mobility) +
  (marketFit === null ? 0 : input.weights.market) +
(dailyLifeFit === null ? 0 : input.weights.dailyLife),
      coverage_percent: areaScore.reliableCoveragePercent,
      resolved_geographies: [resolution.data],
      source_summary: [
        {
          name: "U.S. Census Bureau American Community Survey 5-year estimates",
          referencePeriod: "2024 ACS 5-year estimates",
          retrievedAt: profile.meta.retrievedAt,
          source: profile.meta.source,
        },
        ...(crimeProfile.status === "available"
  ? [
      {
        name: crimeProfile.meta.provider,
        referencePeriod: String(crimeProfile.data.year),
        retrievedAt: crimeProfile.meta.retrievedAt,
        source: crimeProfile.meta.source,
      },
    ]
  : []),
      ],
      caveats: [
        resolution.data.contextMessage,
        "Area fit is decision support, not a claim that a place is safe or suitable for every person.",
      ],
      generated_at: now.toISOString(),
      stale_after: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    })
    .select("id")
    .single();
  if (!snapshot) {
    return { resolution, profile, snapshot: { score: areaScore, persisted: false } };
  }

  const scored = [
    {
      key: "housing",
      name:
        input.housingIntent === "buy"
          ? "Housing fit · median home value"
          : "Housing fit · median gross rent",
      measure: housingMeasure,
      score: housingFit,
      weight: input.weights.housing,
      caveat:
        "Fit compares the ACS estimate with your entered housing ceiling; it is not a listing price or appraisal.",
    },
    {
      key: "mobility",
      name: "Mobility fit · mean commute time",
      measure: commuteMeasure,
      score: mobilityFit,
      weight: input.weights.mobility,
      caveat:
        "Fit compares the ACS estimate with your entered commute ceiling; it is not an address-specific drive time.",
    },
    {
  key: "market",
  name: "Housing market context · vacancy rate",
  measure: marketMeasure,
  score: marketFit,
  weight: input.weights.market,
  caveat:
    "Vacancy rate is an ACS estimate and does not represent current listings, inventory, or future market conditions.",
},
    {
  key: "daily_life",
  name: "Personal daily-life fit · income and broadband",
  measure: broadbandMeasure ?? incomeMeasure,
  score: dailyLifeFit,
  weight: input.weights.dailyLife,
  caveat:
    "Fit combines ACS median household income (40%) and broadband subscription rate (60%); it is broad area context, not a personalized lifestyle assessment.",
},
  ];
  const metricRows: Record<string, unknown>[] = scored.map((item) => ({
    user_id: input.userId,
    move_plan_id: input.movePlanId,
    area_id: input.areaId,
    snapshot_id: snapshot.id,
    measure_key: item.key,
    measure_name: item.name,
    availability:
      item.measure?.rawValue !== null && item.measure?.rawValue !== undefined
        ? "available"
        : "unavailable",
    raw_value:
      item.measure?.rawValue === null || item.measure?.rawValue === undefined
        ? null
        : { value: item.measure.rawValue },
    raw_display:
      item.measure?.rawValue === null || item.measure?.rawValue === undefined
        ? null
        : display(item.measure.rawValue, item.measure.unit),
    unit: item.measure?.unit ?? null,
    normalized_fit_score: item.score,
    applied_weight: item.score === null ? null : item.weight,
    source_name:
      item.measure?.rawValue === null || item.measure?.rawValue === undefined
        ? null
        : "U.S. Census Bureau American Community Survey 5-year estimates",
    source_url:
      item.measure?.rawValue === null || item.measure?.rawValue === undefined
        ? null
        : profile.meta.source,
    geography_type: resolution.data.resolution,
    geography_label: profile.data.geography,
    geography_identifier: JSON.stringify(resolution.data.geography).slice(0, 160),
    reference_period:
      item.measure?.rawValue === null || item.measure?.rawValue === undefined
        ? null
        : "2024 ACS 5-year estimates",
    coverage_note: item.measure?.coverage ?? resolution.data.contextMessage,
    caveats: [...(item.measure?.caveats ?? []), item.caveat],
    retrieved_at:
      item.measure?.rawValue === null || item.measure?.rawValue === undefined
        ? null
        : profile.meta.retrievedAt,
  }));
  metricRows.push({
  user_id: input.userId,
  move_plan_id: input.movePlanId,
  area_id: input.areaId,
  snapshot_id: snapshot.id,
  measure_key: "reported_crime",
  measure_name: "Reported crime context · state crime rates",
  availability:
    crimeProfile.status === "available" ? "available" : "unavailable",
  raw_value:
  crimeProfile.status === "available"
    ? { value: crimeProfile.data.violentCrimeRatePer100k }
      : null,
  raw_display:
    crimeProfile.status === "available"
      ? `${crimeProfile.data.violentCrimeRatePer100k.toFixed(
          1,
        )} violent · ${crimeProfile.data.propertyCrimeRatePer100k.toFixed(
          1,
        )} property per 100,000`
      : null,
  unit: crimeProfile.status === "available" ? "rate_per_100k" : null,
  normalized_fit_score: crimeFit,
  applied_weight: crimeFit === null ? null : input.weights.reportedCrime,
  source_name:
    crimeProfile.status === "available"
      ? crimeProfile.meta.provider
      : null,
  source_url:
    crimeProfile.status === "available" ? crimeProfile.meta.source : null,
  geography_type: "state",
  geography_label: stateAbbreviation || null,
  geography_identifier: stateAbbreviation || null,
  reference_period:
    crimeProfile.status === "available"
      ? String(crimeProfile.data.year)
      : null,
  coverage_note:
    crimeProfile.status === "available"
      ? crimeProfile.meta.coverage
      : crimeProfile.message,
  caveats:
    crimeProfile.status === "available"
      ? crimeProfile.data.caveats
      : [crimeProfile.message, ...crimeProfile.meta.caveats],
  retrieved_at:
    crimeProfile.status === "available"
      ? crimeProfile.meta.retrievedAt
      : null,
});
metricRows.push({
  user_id: input.userId,
  move_plan_id: input.movePlanId,
  area_id: input.areaId,
  snapshot_id: snapshot.id,
  measure_key: "schools",
  measure_name: "Public-school context",
  availability: "unavailable",
  raw_value: null,
  raw_display: null,
  unit: null,
  normalized_fit_score: null,
  applied_weight: null,
  source_name: null,
  source_url: null,
  geography_type: resolution.data.resolution,
  geography_label: profile.data.geography,
  geography_identifier: JSON.stringify(resolution.data.geography).slice(0, 160),
  reference_period: null,
  coverage_note:
    "Official nationwide school-performance evidence is not connected yet.",
  caveats: [
    "School enrollment and directory data should not be presented as a school-quality ranking.",
    "This category is excluded from the weighted score until an authorized official-data adapter is connected.",
  ],
  retrieved_at: null,
});
  const { error: metricError } = await admin
    .from("area_metrics")
    .insert(metricRows);
  if (metricError) {
    await admin
      .from("area_snapshots")
      .delete()
      .eq("id", snapshot.id)
      .eq("user_id", input.userId);
    return {
      resolution,
      profile,
      snapshot: { score: areaScore, persisted: false },
    };
  }

  return {
    resolution,
    profile,
    snapshot: {
      id: snapshot.id,
      score: areaScore,
      persisted: true,
      generatedAt: now.toISOString(),
    },
  };
}
