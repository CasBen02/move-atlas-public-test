import { describe, expect, it } from "vitest";

import {
  computeAreaScore,
  normalizeMetricAcrossAreas,
} from "../../src/lib/domain/area-score";

describe("transparent area scoring", () => {
  it("excludes missing metrics from the weighted denominator", () => {
    const result = computeAreaScore(
      [
        { metricId: "reported_crime", normalizedFitScore: 80 },
        { metricId: "housing_cost", normalizedFitScore: null },
        { metricId: "commute", normalizedFitScore: 60 },
      ],
      {
        reported_crime: 5,
        housing_cost: 4,
        commute: 1,
      },
    );

    expect(result.score).toBe(76.7);
    expect(result.appliedWeight).toBe(6);
    expect(result.reliableCoveragePercent).toBe(66.7);
    expect(result.excludedMetricIds).toEqual(["housing_cost"]);
  });

  it("returns no score instead of a fake default when nothing is loaded", () => {
    const result = computeAreaScore([], { housing_cost: 5, schools: 5 });
    expect(result.score).toBeNull();
    expect(result.reliableCoveragePercent).toBe(0);
  });

  it("normalizes comparable places without replacing missing values", () => {
    expect(normalizeMetricAcrossAreas([100, null, 300], "lower_is_better")).toEqual([
      100,
      null,
      0,
    ]);
    expect(normalizeMetricAcrossAreas([10, 10], "higher_is_better")).toEqual([50, 50]);
  });
});
