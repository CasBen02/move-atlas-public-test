import { describe, expect, it } from "vitest";

import { sanitizeLegacyAccount } from "../../src/lib/migration/local-v1";

const firstMove = {
  person: "Jordan Lee",
  household: "Couple + pet",
  origin: "Austin, TX",
  destination: "Portland, OR",
  moveType: "Long-distance",
  date: "2026-10-15",
  timeframe: "Fall 2026",
  housingIntent: "Rent",
  housingMax: 2_800,
  savings: 8_500,
  moveFund: 18_000,
  propertyTypes: ["Apartment", "Townhome"],
  pets: ["Dog"],
  priorities: ["Housing", "Lifestyle"],
  rankWeights: {
    housing: 75,
    safety: 80,
    mobility: 55,
    market: 45,
    lifestyle: 70,
  },
  tasks: [
    {
      title: "Request moving quotes",
      area: "Logistics",
      when: "This week",
      done: true,
    },
  ],
  areas: [
    {
      name: "Sellwood-Moreland",
      notes: "Close to the river",
      score: 80,
      official: {
        reportedCrime: 0,
        source: "prototype cache",
      },
      areaIntel: {
        score: 99,
      },
    },
  ],
  housing: [
    {
      name: "Garden apartment",
      propertyType: "Apartment",
      intent: "Rent",
      baseCost: 2_450,
      beds: 2,
      baths: 1,
      status: "Touring",
      detail: "User note",
    },
  ],
  budget: [
    {
      name: "Moving truck",
      category: "Logistics",
      estimated: 3_200,
      actual: 3_350,
      paid: true,
    },
  ],
  operations: {
    packing: {
      boxes: [
        {
          number: 7,
          room: "Kitchen",
          destination: "Kitchen",
          contents: "Pans, utensils",
          status: "packed",
        },
      ],
    },
    movers: [
      {
        company: "Example Moving",
        amount: 4_200,
        status: "quoted",
      },
    ],
    utilities: [
      {
        name: "Internet",
        newDate: "2026-10-16",
        confirmation: "USER-REFERENCE",
        status: "scheduled",
      },
    ],
    address: [
      {
        name: "Postal service",
        category: "Mail",
        due: "2026-10-01",
        confirmation: "USER-CONFIRMATION",
        status: "submitted",
      },
    ],
    settling: [
      {
        title: "Find a veterinarian",
        when: "First month",
        done: false,
      },
    ],
  },
  documentChecklist: [
    {
      category: "Pets",
      title: "Veterinary records",
      need: "recommended",
      when: "Before departure",
      why: "Care continuity",
      status: "ready",
      expires: "",
    },
  ],
  // All of this is prototype/provider output and must not enter the cloud import.
  travel: {
    routes: [{ bridge: "Invented Bridge", clearance: "12 ft" }],
    weather: { alert: "Mock alert" },
    vehicle: { heightIn: 150 },
  },
};

describe("legacy local-data migration", () => {
  it("converts user-authored records into the RPC import shape", () => {
    const result = sanitizeLegacyAccount({
      id: "account-1",
      name: "Jordan",
      email: "jordan@example.com",
      activeMoveId: "move-a",
      moveLibrary: [
        { id: "move-a", name: "Portland move", move: firstMove },
        {
          id: "move-b",
          name: "Backup plan",
          move: { ...firstMove, destination: "Denver, CO", tasks: [] },
        },
      ],
    });

    expect(result.counts).toEqual({ plans: 2, records: 19 });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.payload.profile).toEqual({ displayName: "Jordan" });

    const imported = result.payload.plans[0];
    expect(imported.isCurrent).toBe(true);
    expect(imported.origin).toEqual({ label: "Austin, TX" });
    expect(imported.householdSummary.housingMaxCents).toBe(280_000);
    expect(imported.tasks[0]).toMatchObject({
      title: "Request moving quotes",
      done: true,
    });
    expect(imported.areas[0]).toEqual({
      name: "Sellwood-Moreland",
      notes: "Close to the river",
      personalFitRating: 4,
    });
    expect(imported.properties[0]).toMatchObject({
      baseCost: 2_450,
      status: "tour scheduled",
    });
    expect(imported.budgetItems[0]).toMatchObject({
      plannedAmount: 3_200,
      actualAmount: 3_350,
      status: "paid",
    });
    expect(imported.addressChangeItems[0].confirmationReference).toBe(
      "USER-CONFIRMATION",
    );
  });

  it("discards credentials, browser passwords, and mock provider output", () => {
    const result = sanitizeLegacyAccount({
      id: "account-1",
      name: "Jordan",
      email: "jordan@example.com",
      password: "browser-only-password",
      passwordHash: "hash",
      dataKeys: { census: "legacy-key" },
      move: {
        ...firstMove,
        apiKey: "provider-key",
        token: "provider-token",
        nested: { secret: "provider-secret" },
      },
    });

    const serialized = JSON.stringify(result.payload);
    for (const forbidden of [
      "browser-only-password",
      "legacy-key",
      "provider-key",
      "provider-token",
      "provider-secret",
      "Invented Bridge",
      "Mock alert",
      "areaIntel",
      "official",
      "routeProfile",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("is deterministic and rejects the curated demo profile", () => {
    const account = {
      id: "account-1",
      name: "Jordan",
      email: "jordan@example.com",
      move: firstMove,
    };
    expect(sanitizeLegacyAccount(account).fingerprint).toBe(
      sanitizeLegacyAccount(account).fingerprint,
    );
    expect(() =>
      sanitizeLegacyAccount({
        ...account,
        email: "DEMO@MOVEATLAS.LOCAL",
      }),
    ).toThrow(/demo/i);
  });

  it("rejects circular or prototype-polluting structures", () => {
    const circular: Record<string, unknown> = { move: firstMove };
    circular.self = circular;
    expect(() => sanitizeLegacyAccount(circular)).toThrow(/circular/i);

    const unsafe = JSON.parse(
      '{"move":{},"constructor":{"prototype":{"polluted":true}}}',
    );
    expect(() => sanitizeLegacyAccount(unsafe)).toThrow(/unsafe object key/i);
  });
});
