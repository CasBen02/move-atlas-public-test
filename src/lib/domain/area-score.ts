export type AreaMetricDirection = "higher_is_better" | "lower_is_better";

export interface AreaMetricEvidence {
  metricId: string;
  rawValue: number | null;
  normalizedFitScore: number | null;
  source: string;
  geography: string;
  referencePeriod: string;
  retrievedAt: string;
  coverage: string;
  caveats: string[];
}
export interface AreaScore {
  score: number | null;
  loadedCategoryCount: number;
  requestedCategoryCount: number;
  reliableCoveragePercent: number;
  appliedWeight: number;
  excludedMetricIds: string[];
}

function isValidScore(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * Scores only reliable, loaded measures. Missing measures are excluded from both
 * the numerator and denominator, so an unavailable category never becomes zero.
 */
export function computeAreaScore(
  metrics: readonly Pick<AreaMetricEvidence, "metricId" | "normalizedFitScore">[],
  weights: Readonly<Record<string, number>>,
): AreaScore {
  const requestedMetricIds = Object.entries(weights)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .map(([metricId]) => metricId);
  const byId = new Map(metrics.map((metric) => [metric.metricId, metric]));
  let numerator = 0;
  let denominator = 0;
  let loaded = 0;
  const excluded: string[] = [];

  for (const metricId of requestedMetricIds) {
    const metric = byId.get(metricId);
    const weight = weights[metricId] ?? 0;
    if (!metric || !isValidScore(metric.normalizedFitScore)) {
      excluded.push(metricId);
      continue;
    }
    numerator += metric.normalizedFitScore * weight;
    denominator += weight;
    loaded += 1;
  }

  return {
    score: denominator === 0 ? null : Math.round((numerator / denominator) * 10) / 10,
    loadedCategoryCount: loaded,
    requestedCategoryCount: requestedMetricIds.length,
    reliableCoveragePercent:
      requestedMetricIds.length === 0
        ? 0
        : Math.round((loaded / requestedMetricIds.length) * 1_000) / 10,
    appliedWeight: denominator,
    excludedMetricIds: excluded,
  };
}

export function normalizeMetricAcrossAreas(
  values: readonly (number | null)[],
  direction: AreaMetricDirection,
): (number | null)[] {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (finite.length === 0) return values.map(() => null);
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);

  return values.map((value) => {
    if (value === null || !Number.isFinite(value)) return null;
    if (minimum === maximum) return 50;
    const higherScore = ((value - minimum) / (maximum - minimum)) * 100;
    const score = direction === "higher_is_better" ? higherScore : 100 - higherScore;
    return Math.round(score * 10) / 10;
  });
}
