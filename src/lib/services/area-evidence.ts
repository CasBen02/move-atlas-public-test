import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  cacheKey,
  readProviderCache,
  writeProviderCache,
} from "@/lib/cache/provider-cache";
import {
  CensusAcsProvider,
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
};

function scoreAgainstCeiling(value: number, ceiling: number) {
  if (ceiling <= 0) return null;
  if (value <= ceiling) return 100;
  return Math.max(0, Math.round((100 - ((value - ceiling) / ceiling) * 100) * 10) / 10);
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

  const byId = new Map(
    profile.data.measures.map((measure) => [measure.id, measure]),
  );
  const housingMeasure =
    input.housingIntent === "buy"
      ? byId.get("median_home_value")
      : byId.get("median_gross_rent");
  const commuteMeasure = byId.get("mean_commute_minutes");
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

  const scoredMetrics = [
    { metricId: "housing", normalizedFitScore: housingFit },
    { metricId: "reportedCrime", normalizedFitScore: null },
    { metricId: "mobility", normalizedFitScore: mobilityFit },
    { metricId: "market", normalizedFitScore: null },
    { metricId: "dailyLife", normalizedFitScore: null },
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
        (mobilityFit === null ? 0 : input.weights.mobility),
      coverage_percent: areaScore.reliableCoveragePercent,
      resolved_geographies: [resolution.data],
      source_summary: [
        {
          name: "U.S. Census Bureau American Community Survey 5-year estimates",
          referencePeriod: "2024 ACS 5-year estimates",
          retrievedAt: profile.meta.retrievedAt,
          source: profile.meta.source,
        },
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
  ];
  const metricRows = scored.map((item) => ({
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
  for (const [key, name, weight, caveat] of [
    [
      "reportedCrime",
      "Reported crime context",
      input.weights.reportedCrime,
      "Reliable reported-crime coverage was not resolved. No zero or safety claim was substituted.",
    ],
    [
      "market",
      "Housing market context",
      input.weights.market,
      "ACS housing estimates are available, but a current market-fit measure was not resolved.",
    ],
    [
      "dailyLife",
      "Personal daily-life fit",
      input.weights.dailyLife,
      "Personal daily-life fit remains separate from official-data scoring.",
    ],
  ] as const) {
    metricRows.push({
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
      source_name: null,
      source_url: null,
      geography_type: resolution.data.resolution,
      geography_label: profile.data.geography,
      geography_identifier: JSON.stringify(resolution.data.geography).slice(0, 160),
      reference_period: null,
      coverage_note: caveat,
      caveats: [caveat, `Requested weight: ${weight}`],
      retrieved_at: null,
    });
  }
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
