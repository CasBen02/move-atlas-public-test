import { describe, expect, it } from "vitest";

import {
  normalizeRecord,
  toDatabaseRecord,
} from "../../src/lib/data/normalizers";
import { recordDefinitions } from "../../src/lib/data/schemas";

const baseRow = {
  id: "00000000-0000-4000-8000-000000000001",
  move_plan_id: "00000000-0000-4000-8000-000000000002",
};

describe("workspace record database contracts", () => {
  it.each([
    ["quoted", "received"],
    ["booked", "accepted"],
  ] as const)("round-trips mover status %s through %s", (client, database) => {
    expect(toDatabaseRecord("movers", { status: client })).toMatchObject({
      status: database,
    });
    expect(
      normalizeRecord("movers", {
        ...baseRow,
        status: database,
      }).status,
    ).toBe(client);
  });

  it.each([
    ["not-started", "not_started"],
    ["scheduled", "scheduled"],
    ["confirmed", "active"],
    ["complete", "closed"],
  ] as const)("round-trips utility status %s through %s", (client, database) => {
    expect(toDatabaseRecord("utilities", { status: client })).toMatchObject({
      status: database,
    });
    expect(
      normalizeRecord("utilities", {
        ...baseRow,
        status: database,
      }).status,
    ).toBe(client);
  });

  it("defaults a new document checklist item to a valid database need level", () => {
    const parsed = recordDefinitions.documents.schema.parse({
      category: "Housing",
      title: "Lease metadata",
      status: "missing",
      expiration_date: null,
    });

    expect(parsed.need_level).toBe("recommended");
    expect(toDatabaseRecord("documents", parsed)).toMatchObject({
      need_level: "recommended",
    });
  });

  it("preserves housing types and intents that use the database fallback values", () => {
    const database = toDatabaseRecord("properties", {
      label: "Temporary co-living option",
      property_type: "co-living",
      intent: "temporary",
      status: "saved",
    });

    expect(database).toMatchObject({
      home_type: "other",
      transaction_type: "unknown",
      metadata: {
        originalHomeType: "co-living",
        originalIntent: "temporary",
      },
    });
    expect(
      normalizeRecord("properties", {
        ...baseRow,
        ...database,
      }),
    ).toMatchObject({
      property_type: "co-living",
      intent: "temporary",
    });
  });
});
