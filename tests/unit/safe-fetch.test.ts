import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { safeFetchJson } from "../../src/lib/providers/safe-fetch";

describe("safe provider fetch", () => {
  it("validates successful provider responses", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(JSON.stringify({ value: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const result = await safeFetchJson({
      provider: "Official example",
      source: "https://example.gov/docs",
      url: "https://example.gov/data?key=secret",
      parser: z.object({ value: z.number() }),
      coverage: "Example",
      fetchImplementation,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.data.value).toBe(42);
      expect(result.meta.retrievedAt).toBe("2026-08-01T12:00:00.000Z");
    }
  });

  it("returns a sanitized unavailable state for an invalid response", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(JSON.stringify({ credential: "provider-body-secret" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await safeFetchJson({
      provider: "Official example",
      source: "https://example.gov/docs",
      url: "https://example.gov/data?key=request-secret",
      parser: z.object({ value: z.number() }),
      coverage: "Example",
      fetchImplementation,
      maximumAttempts: 1,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("request-secret");
    expect(JSON.stringify(result)).not.toContain("provider-body-secret");
  });
});
