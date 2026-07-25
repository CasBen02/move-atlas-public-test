import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_PLANS = 10;
const MAX_RECORDS = 500;
const dangerousObjectKeys = new Set(["__proto__", "prototype", "constructor"]);
const discardedCredentialKeys = new Set([
  "password",
  "passwordhash",
  "passwordsalt",
  "datakeys",
  "apikey",
  "token",
  "secret",
]);

const unknownAccountSchema = z
  .object({
    id: z.string().max(200).optional(),
    name: z.string().max(80).optional(),
    email: z.string().max(320).optional(),
    move: z.unknown().optional(),
    moveLibrary: z
      .array(
        z.object({
          id: z.string().max(200).optional(),
          name: z.string().max(80).optional(),
          move: z.unknown(),
        }),
      )
      .max(MAX_PLANS)
      .optional(),
    activeMoveId: z.string().max(200).optional(),
  })
  .strip();

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

function number(value: unknown, min = 0, max = 1_000_000_000) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function list(value: unknown, max = 30, itemMax = 160) {
  return Array.isArray(value)
    ? value
        .slice(0, max)
        .map((item) => text(item, itemMax))
        .filter((item): item is string => Boolean(item))
    : [];
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value
        .slice(0, MAX_RECORDS)
        .filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
    : [];
}

function firstRecordCollection(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) return records(value);
  }
  return [];
}

function identifier(value: unknown, max = 80) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().slice(0, max);
  return normalized || null;
}

function stringList(value: unknown, max = 30, itemMax = 160) {
  const array = list(value, max, itemMax);
  if (array.length) return array;
  const single = text(value, itemMax);
  return single ? [single] : [];
}

function assertNoForbiddenKeys(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
) {
  if (depth > 12) throw new Error("Legacy data is nested too deeply.");
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("Legacy data contains a circular reference.");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (dangerousObjectKeys.has(key)) {
      throw new Error("Legacy data contains an unsafe object key.");
    }
    // Older standalone builds could contain browser-only passwords and
    // operator/provider fields. They are deliberately discarded, never
    // uploaded and never allowed to block import of the user's move records.
    if (discardedCredentialKeys.has(key.toLowerCase())) continue;
    assertNoForbiddenKeys(child, depth + 1, seen);
  }
  seen.delete(value);
}

function normalizeMoney(value: unknown) {
  const parsed = number(value);
  return parsed === null ? null : Math.round(parsed * 100);
}

function normalizeMove(
  value: unknown,
  fallbackName: string,
  legacyId: string | null,
) {
  const move =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const operations =
    move.operations && typeof move.operations === "object"
      ? (move.operations as Record<string, unknown>)
      : {};
  const packing =
    operations.packing &&
    typeof operations.packing === "object" &&
    !Array.isArray(operations.packing)
      ? (operations.packing as Record<string, unknown>)
      : {};
  const weights =
    move.rankWeights && typeof move.rankWeights === "object"
      ? (move.rankWeights as Record<string, unknown>)
      : {};

  return {
    legacyId,
    plan: {
      name: fallbackName || text(move.name, 80) || "Imported move",
      personName: text(move.person, 80),
      household: text(move.household, 80),
      originLabel: text(move.origin, 200),
      destinationLabel: text(move.destination, 200),
      moveType: text(move.moveType, 40),
      targetDate: text(move.date, 30),
      timeframe: text(move.timeframe, 80),
      housingIntent: text(move.housingIntent, 40),
      housingMaxCents: normalizeMoney(move.housingMax),
      savingsCents: normalizeMoney(move.savings),
      moveFundTargetCents: normalizeMoney(move.moveFund),
    },
    preferences: {
      propertyTypes: list(move.propertyTypes, 12, 40),
      bedrooms: number(move.bedrooms, 0, 20),
      bathrooms: number(move.bathrooms, 0, 20),
      pets: list(move.pets, 12, 80),
      accessibilityNeeds: list(move.accessibility, 20, 120),
      commuteMode: text(move.commuteMode, 60),
      maxCommuteMinutes: number(move.commuteMinutes, 0, 360),
      dailyNeeds: list(move.dailyNeeds, 30, 100),
      priorityTags: list(move.priorities, 20, 80),
      weights: {
        housing: number(weights.housing, 0, 100),
        reportedCrime: number(weights.safety, 0, 100),
        mobility: number(weights.mobility, 0, 100),
        market: number(weights.market, 0, 100),
        dailyLife: number(weights.lifestyle, 0, 100),
      },
    },
    records: {
      tasks: records(move.tasks).map((item) => ({
        title: text(item.title, 160),
        category: text(item.area, 80) || "General",
        timingLabel: text(item.when, 80),
        status: item.done === true ? "done" : "open",
        source: "legacy-import",
      })),
      areas: records(move.areas).map((item) => ({
        userLabel: text(item.name, 200),
        notes: text(item.notes, 2_000),
        personalFitScore: number(item.localScore ?? item.score, 0, 100),
      })),
      properties: records(move.housing).map((item) => ({
        label: text(item.name, 200),
        propertyType: text(item.propertyType, 60) || "other",
        intent: text(item.intent, 40) || text(move.housingIntent, 40),
        askingCostCents:
          normalizeMoney(item.baseCost) ?? normalizeMoney(item.price),
        bedrooms: number(item.beds, 0, 50),
        bathrooms: number(item.baths, 0, 50),
        commuteText: text(item.commute, 160),
        status: text(item.status, 40) || "saved",
        details: text(item.detail, 2_000),
        pros: list(item.pros, 30, 200),
        cons: list(item.cons, 30, 200),
      })),
      career: records(move.career).map((item) => ({
        name: text(item.name, 160),
        organization: text(item.organization, 160),
        status:
          text(item.status, 40) ||
          (/interview/i.test(text(item.detail, 2_000) ?? "")
            ? "interviewing"
            : "saved"),
        locationMode: text(item.location ?? item.workMode, 120),
        notes: text(item.notes ?? item.detail, 2_000),
      })),
      budget: records(move.budget).map((item) => ({
        name: text(item.name, 160),
        category: text(item.category, 80) || "Other",
        estimatedCents:
          normalizeMoney(item.estimated) ?? normalizeMoney(item.amount) ?? 0,
        actualCents: normalizeMoney(item.actual),
        paid: item.paid === true,
        reimbursable: item.reimbursable === true,
        phase: text(item.phase, 40) || "moving",
      })),
      boxes: firstRecordCollection(packing.boxes, operations.boxes).map((item) => ({
        boxNumber: identifier(item.number ?? item.boxCode),
        room: text(item.room, 80) || "Unassigned",
        contents: text(item.contents, 1_000),
        fragile: item.fragile === true,
        priority: text(item.priority, 40) || "normal",
        destinationRoom: text(item.destination, 80),
        status: text(item.status, 40) || "planned",
      })),
      movers: firstRecordCollection(
        operations.movers,
        operations.moverQuotes,
      ).map((item) => ({
        company: text(item.company, 160),
        amountCents:
          normalizeMoney(item.amount) ?? normalizeMoney(item.estimate),
        depositCents: normalizeMoney(item.deposit),
        estimateType: text(item.estimateType ?? item.estimate, 80),
        services: stringList(item.services, 30, 240),
        insurance: text(item.insurance, 2_000),
        cancellation: text(item.cancellation, 2_000),
        availability: text(item.availability, 1_000),
        license: text(item.license, 500),
        contact: text(item.contact, 240),
        notes: text(item.notes, 2_000),
        status: text(item.status, 40) || "researching",
      })),
      utilities: records(operations.utilities).map((item) => ({
        serviceName: text(item.name, 120),
        oldShutoffDate: text(item.oldDate, 30),
        newActivationDate: text(item.newDate, 30),
        confirmationReference: text(item.confirmation, 120),
        status: text(item.status, 40) || "not-started",
      })),
      address: firstRecordCollection(
        operations.address,
        operations.addressChanges,
      ).map((item) => ({
        organization: text(item.name, 160),
        category: text(item.category, 80),
        dueDate: text(item.due, 30),
        confirmationReference: text(item.confirmation, 120),
        notes: text(item.notes, 2_000),
        status: text(item.status, 40) || "not-started",
      })),
      documents: [
        ...records(move.documentChecklist),
        ...records(move.documents),
      ].map((item) => ({
        category: text(item.category, 80) || "Other",
        title: text(item.title ?? item.name, 160),
        needLevel: text(item.need, 80),
        timingLabel: text(item.when, 80),
        rationale: text(item.why, 2_000),
        status:
          text(item.status, 40) ||
          (/ready/i.test(text(item.detail, 2_000) ?? "")
            ? "ready"
            : "missing"),
        expirationDate: text(item.expires, 30),
        customDetail: text(item.detail, 2_000),
      })),
      settling: records(operations.settling).map((item) => ({
        title: text(item.title, 160),
        timingLabel: text(item.when, 80),
        completed: item.done === true,
      })),
    },
  };
}

function dollarsFromCents(value: number | null) {
  return value === null ? null : value / 100;
}

function toImportedStatus(
  value: string | null,
  translations: Record<string, string>,
  fallback: string,
) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return translations[normalized] ?? (normalized || fallback);
}

/**
 * Convert the browser-only model into the intentionally narrow shape accepted
 * by `public.import_legacy_v1`. It includes user-authored planning records only:
 * cached "official" area facts, schematic routes, route restrictions, weather,
 * assistant output, document contents, credentials and sessions are omitted.
 */
function toImportPlan(
  normalized: ReturnType<typeof normalizeMove>,
  activeLegacyMoveId: string | null,
) {
  const { plan, preferences, records: importedRecords } = normalized;
  return {
    legacyId: normalized.legacyId,
    name: plan.name,
    isCurrent:
      normalized.legacyId !== null &&
      normalized.legacyId === activeLegacyMoveId,
    moveDate: plan.targetDate,
    origin:
      plan.originLabel === null ? {} : { label: plan.originLabel },
    destination:
      plan.destinationLabel === null ? {} : { label: plan.destinationLabel },
    householdSummary: {
      personName: plan.personName,
      label: plan.household,
      moveType: plan.moveType,
      timeframe: plan.timeframe,
      housingIntent: plan.housingIntent,
      housingMaxCents: plan.housingMaxCents,
      savingsCents: plan.savingsCents,
      moveFundTargetCents: plan.moveFundTargetCents,
    },
    setupPreferences: {
      desiredHomeTypes: preferences.propertyTypes,
      accessibilityNeeds: preferences.accessibilityNeeds,
      petsTraveling: preferences.pets.length > 0,
      movePriorities: {
        priorityTags: preferences.priorityTags,
        dailyNeeds: preferences.dailyNeeds,
        commuteMode: preferences.commuteMode,
        maxCommuteMinutes: preferences.maxCommuteMinutes,
        bedrooms: preferences.bedrooms,
        bathrooms: preferences.bathrooms,
        pets: preferences.pets,
        weights: preferences.weights,
      },
      completed: true,
    },
    tasks: importedRecords.tasks.map((item) => ({
      title: item.title,
      category: item.category,
      details: item.timingLabel,
      done: item.status === "done",
    })),
    areas: importedRecords.areas.map((item) => ({
      name: item.userLabel,
      notes: item.notes,
      personalFitRating:
        item.personalFitScore === null
          ? null
          : Math.max(1, Math.min(5, Math.round(item.personalFitScore / 20))),
    })),
    properties: importedRecords.properties.map((item) => ({
      label: item.label,
      homeType: item.propertyType,
      transactionType: item.intent,
      baseCost: dollarsFromCents(item.askingCostCents),
      beds: item.bedrooms,
      baths: item.bathrooms,
      detail: item.details,
      status: toImportedStatus(
        item.status,
        {
          researching: "contacted",
          touring: "tour scheduled",
          offered: "offer made",
          archived: "passed",
        },
        "saved",
      ),
    })),
    careerOpportunities: importedRecords.career.map((item) => ({
      title: item.name,
      organizationName: item.organization,
      locationLabel: item.locationMode,
      status: toImportedStatus(item.status, { offered: "offer" }, "saved"),
      notes: item.notes,
    })),
    budgetItems: importedRecords.budget.map((item) => ({
      name: item.name,
      category: item.category,
      plannedAmount: dollarsFromCents(item.estimatedCents),
      actualAmount: dollarsFromCents(item.actualCents),
      status: item.paid ? "paid" : "planned",
      reimbursable: item.reimbursable,
      phase: item.phase,
    })),
    packingBoxes: importedRecords.boxes.map((item) => ({
      label:
        item.boxNumber === null ? "Imported box" : `Box ${item.boxNumber}`,
      number: item.boxNumber,
      room: item.room,
      destinationRoom: item.destinationRoom,
      contents: item.contents,
      fragile: item.fragile,
      priority: item.priority === "first-open" ? "open_first" : item.priority,
      status: item.status,
    })),
    moverQuotes: importedRecords.movers.map((item) => ({
      company: item.company,
      amount: dollarsFromCents(item.amountCents),
      deposit: dollarsFromCents(item.depositCents),
      estimateType: item.estimateType,
      services: item.services,
      insurance: item.insurance,
      cancellation: item.cancellation,
      availability: item.availability,
      license: item.license,
      contact: item.contact,
      notes: item.notes,
      status: toImportedStatus(
        item.status,
        { quoted: "received", booked: "accepted" },
        "researching",
      ),
    })),
    utilities: importedRecords.utilities.map((item) => ({
      providerName: item.serviceName,
      stopServiceOn: item.oldShutoffDate,
      startServiceOn: item.newActivationDate,
      confirmationNote: item.confirmationReference,
      status: item.status,
    })),
    addressChangeItems: importedRecords.address.map((item) => ({
      organizationName: item.organization,
      category: item.category,
      dueDate: item.dueDate,
      confirmationReference: item.confirmationReference,
      notes: item.notes,
      status: item.status,
    })),
    documentChecklistItems: importedRecords.documents.map((item) => ({
      documentKind: item.category,
      title: item.title,
      needLevel: item.needLevel,
      timingNote: item.timingLabel,
      rationale: item.rationale,
      status:
        item.status === "not-applicable" ? "not_needed" : item.status,
      expiresOn: item.expirationDate,
      notes: item.customDetail,
    })),
    settlingTasks: importedRecords.settling.map((item) => ({
      title: item.title,
      details: item.timingLabel,
      phase: item.timingLabel,
      done: item.completed,
    })),
  };
}

export function sanitizeLegacyAccount(input: unknown) {
  assertNoForbiddenKeys(input);
  const account = unknownAccountSchema.parse(input);
  if (account.email?.toLowerCase() === "demo@moveatlas.local") {
    throw new Error("The curated demo cannot be imported into a real account.");
  }

  const library = account.moveLibrary?.length
    ? account.moveLibrary.map((item) => ({
        name: item.name ?? "Imported move",
        id: item.id ?? null,
        move: item.move,
      }))
    : [{ name: "Imported move", id: null, move: account.move }];

  const normalizedPlans = library.map((item) =>
    normalizeMove(item.move, item.name, item.id),
  );
  const activeLegacyMoveId = account.activeMoveId ?? null;
  const payload = {
    schema: "move-atlas-local-v1",
    profile: { displayName: account.name ?? null },
    activeLegacyMoveId,
    plans: normalizedPlans.map((plan) =>
      toImportPlan(plan, activeLegacyMoveId),
    ),
  };

  const canonical = JSON.stringify(payload);
  return {
    payload,
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
    counts: {
      plans: normalizedPlans.length,
      records: normalizedPlans.reduce(
        (total, plan) =>
          total +
          Object.values(plan.records).reduce(
            (count, collection) => count + collection.length,
            0,
          ),
        0,
      ),
    },
  };
}
