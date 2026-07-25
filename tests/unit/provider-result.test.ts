import { describe, expect, it } from "vitest";

import {
  cachedResult,
  staleCacheFallback,
  unavailable,
} from "../../src/lib/providers/result";

const cache = {
  data: { temperature: 72 },
  meta: {
    provider: "Example official provider",
    source: "https://example.gov",
    retrievedAt: "2026-08-01T10:00:00.000Z",
    expiresAt: "2026-08-01T11:00:00.000Z",
    coverage: "Example coverage",
    caveats: [] as string[],
  },
};

describe("provider freshness", () => {
  it("marks expired cached data stale", () => {
    const result = cachedResult(cache, new Date("2026-08-01T12:00:00.000Z"));
    expect(result.meta.freshness).toBe("stale");
    expect(result.meta.caveats.join(" ")).toContain("may no longer reflect");
  });

  it("uses a bounded stale fallback only when clearly marked", () => {
    const failure = unavailable({
      reason: "timeout",
      message: "Provider timed out.",
      retryable: true,
      meta: {
        provider: "Example official provider",
        source: "https://example.gov",
        checkedAt: "2026-08-01T12:00:00.000Z",
        caveats: [],
      },
    });
    const result = staleCacheFallback({
      cache,
      failure,
      now: new Date("2026-08-01T12:00:00.000Z"),
      maximumStaleAgeMs: 3 * 60 * 60 * 1_000,
    });
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.meta.freshness).toBe("stale");
      expect(result.meta.caveats.join(" ")).toContain("refresh failed");
    }
  });

  it("rejects cache older than the configured fallback window", () => {
    const failure = unavailable({
      reason: "network_error",
      message: "Unavailable.",
      retryable: true,
      meta: {
        provider: "Example official provider",
        source: "https://example.gov",
        checkedAt: "2026-08-03T12:00:00.000Z",
        caveats: [],
      },
    });
    expect(
      staleCacheFallback({
        cache,
        failure,
        now: new Date("2026-08-03T12:00:00.000Z"),
        maximumStaleAgeMs: 3 * 60 * 60 * 1_000,
      }),
    ).toBe(failure);
  });
});
