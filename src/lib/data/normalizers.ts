import type {
  MovePlan,
  SetupPreferences,
  UserProfile,
  WorkspaceRecord,
} from "@/lib/data/types";
import type { ResourceName } from "@/lib/data/schemas";

type Row = Record<string, unknown>;

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function nullableInput(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key)
    ? input[key] ?? null
    : undefined;
}

export function normalizeProfile(
  raw: Row,
  legacyImportCompletedAt: string | null,
): UserProfile {
  return {
    id: String(raw.user_id ?? ""),
    display_name: string(raw.display_name),
    active_move_plan_id: null,
    onboarding_completed_at: string(raw.onboarding_completed_at),
    legacy_import_completed_at: legacyImportCompletedAt,
  };
}

export function normalizeMovePlan(raw: Row): MovePlan {
  const origin = object(raw.origin);
  const destination = object(raw.destination);
  const household = object(raw.household_summary);
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    name: String(raw.name ?? "My move"),
    status: String(raw.status ?? "planning"),
    person_name: string(household.personName),
    household: string(household.label),
    origin_label: string(origin.label),
    destination_label: string(destination.label),
    move_type: string(household.moveType),
    target_date: string(raw.move_date),
    timeframe: string(household.timeframe),
    housing_intent: string(household.housingIntent),
    housing_max_cents: numeric(household.housingMaxCents),
    savings_cents: numeric(household.savingsCents),
    move_fund_target_cents: numeric(household.moveFundTargetCents),
    onboarding_completed_at: string(household.onboardingCompletedAt),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

export function normalizePreferences(raw: Row | null): SetupPreferences | null {
  if (!raw) return null;
  const priorities = object(raw.move_priorities);
  const weights = object(priorities.weights);
  return {
    property_types: strings(raw.desired_home_types),
    bedrooms: numeric(priorities.bedrooms),
    bathrooms: numeric(priorities.bathrooms),
    pets: strings(priorities.pets),
    accessibility_needs: strings(raw.accessibility_needs),
    commute_mode: string(priorities.commuteMode),
    max_commute_minutes: numeric(priorities.maxCommuteMinutes),
    daily_needs: strings(priorities.dailyNeeds),
    priority_tags: strings(priorities.priorityTags),
    housing_weight: numeric(weights.housing) ?? 50,
    reported_crime_weight: numeric(weights.reportedCrime) ?? 50,
    mobility_weight: numeric(weights.mobility) ?? 50,
    market_weight: numeric(weights.market) ?? 50,
    daily_life_weight: numeric(weights.dailyLife) ?? 50,
    schools_weight: numeric(weights.schools) ?? 0,
  };
}

const taskStatusFromDb: Record<string, string> = {
  not_started: "open",
  in_progress: "open",
  blocked: "open",
  completed: "done",
  skipped: "done",
};

const taskStatusToDb: Record<string, string> = {
  open: "not_started",
  done: "completed",
};

const propertyTypeFromDb: Record<string, string> = {
  house: "single-family",
  apartment: "apartment",
  condo: "condo",
  townhome: "townhome",
  duplex: "multifamily",
  manufactured_home: "other",
  other: "other",
};

const propertyTypeToDb: Record<string, string> = {
  apartment: "apartment",
  condo: "condo",
  townhome: "townhome",
  "single-family": "house",
  multifamily: "duplex",
  "co-living": "other",
  "new-build": "other",
  temporary: "other",
  other: "other",
};

function base(raw: Row): WorkspaceRecord {
  return {
    ...raw,
    id: String(raw.id),
    move_plan_id: String(raw.move_plan_id),
  };
}

export function normalizeRecord(
  resource: string,
  raw: Row,
): WorkspaceRecord {
  const normalized = base(raw);
  if (resource === "tasks") {
    return {
      ...normalized,
      timing_label: string(raw.details),
      status: taskStatusFromDb[String(raw.status)] ?? "open",
      source:
        raw.source === "guided_setup"
          ? "setup"
          : raw.source === "template"
            ? "demo_copy"
            : raw.source,
    };
  }
  if (resource === "areas") {
    return {
      ...normalized,
      user_label: raw.display_name,
      canonical_name: raw.display_name,
      provider_place_id: raw.place_reference,
      notes: raw.personal_notes,
      personal_fit_score:
        numeric(raw.personal_fit_rating) === null
          ? null
          : Number(raw.personal_fit_rating) * 20,
    };
  }
  if (resource === "properties") {
    const metadata = object(raw.metadata);
    return {
      ...normalized,
      property_type:
        string(metadata.originalHomeType) ??
        propertyTypeFromDb[String(raw.home_type)] ??
        "other",
      intent:
        string(metadata.originalIntent) ??
        (raw.transaction_type === "unknown"
          ? "either"
          : raw.transaction_type),
      asking_cost_cents:
        numeric(raw.asking_price_cents) ?? numeric(raw.monthly_cost_cents),
      monthly_utilities_cents: numeric(metadata.monthlyUtilitiesCents),
      monthly_fees_cents: numeric(metadata.monthlyFeesCents),
      commute_text: string(metadata.commuteText),
      details: raw.notes,
    };
  }
  if (resource === "budget") {
    const phaseFromDb: Record<string, string> = {
      before_move: "before",
      moving: "moving",
      after_move: "after",
    };
    return {
      ...normalized,
      estimated_cents: raw.planned_amount_cents,
      actual_cents:
        Number(raw.actual_amount_cents ?? 0) === 0
          ? null
          : raw.actual_amount_cents,
      paid: raw.status === "paid",
      reimbursable: raw.reimbursable ?? false,
      phase: phaseFromDb[String(raw.phase)] ?? "moving",
      currency: raw.currency_code ?? "USD",
    };
  }
  if (resource === "boxes") {
    return {
      ...normalized,
      box_number: numeric(raw.box_code) ?? numeric(String(raw.label).match(/\d+/)?.[0]) ?? 1,
      destination_room: raw.destination_room,
      contents: strings(raw.contents).join(", "),
      priority: raw.priority === "open_first" ? "first-open" : raw.priority,
    };
  }
  if (resource === "movers") {
    const statusFromDb: Record<string, string> = {
      received: "quoted",
      accepted: "booked",
    };
    return {
      ...normalized,
      company: raw.provider_name,
      amount_cents: raw.quote_amount_cents,
      deposit_cents: raw.deposit_amount_cents,
      estimate_type: raw.estimate_type,
      insurance_notes: raw.insurance_summary,
      cancellation_notes: raw.cancellation_terms,
      availability_notes: raw.availability_note,
      license_notes: raw.license_reference,
      contact_note: raw.contact_name,
      status: statusFromDb[String(raw.status)] ?? raw.status,
    };
  }
  if (resource === "utilities") {
    return {
      ...normalized,
      service_name: raw.provider_name ?? raw.utility_type,
      old_shutoff_date: raw.stop_service_on,
      new_activation_date: raw.start_service_on,
      confirmation_reference: raw.confirmation_note,
      status:
        raw.status === "not_started"
          ? "not-started"
          : raw.status === "active"
            ? "confirmed"
            : raw.status === "closed"
              ? "complete"
            : raw.status,
    };
  }
  if (resource === "address") {
    return {
      ...normalized,
      organization: raw.organization_name,
      confirmation_reference: raw.confirmation_reference,
      status:
        raw.status === "not_started"
          ? "not-started"
          : raw.status === "not_needed"
            ? "not-applicable"
            : raw.status,
    };
  }
  if (resource === "documents") {
    const statuses: Record<string, string> = {
      needed: "missing",
      received: "ready",
      verified: "ready",
      not_needed: "not-applicable",
    };
    return {
      ...normalized,
      category: raw.document_kind,
      need_level: raw.need_level,
      timing_label: raw.timing_note,
      rationale: raw.rationale,
      expiration_date: raw.expires_on,
      status: statuses[String(raw.status)] ?? raw.status,
    };
  }
  if (resource === "settling") {
    return {
      ...normalized,
      timing_label: raw.details ?? raw.phase,
    };
  }
  if (resource === "career") {
    const statusFromDb: Record<string, string> = {
      offer: "offered",
      archived: "closed",
    };
    return {
      ...normalized,
      name: raw.title,
      organization: raw.organization_name,
      status: statusFromDb[String(raw.status)] ?? raw.status,
      location_mode:
        raw.location_label ??
        (raw.work_arrangement === "unknown" ? null : raw.work_arrangement),
      user_rating: null,
    };
  }
  return normalized;
}

export function toDatabaseRecord(
  resource: ResourceName,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (resource === "tasks") {
    return compact({
      title: input.title,
      category: input.category,
      details: nullableInput(input, "timing_label"),
      due_date: nullableInput(input, "due_date"),
      status: taskStatusToDb[String(input.status)] ?? input.status,
      source:
        input.source === "setup"
          ? "guided_setup"
          : input.source === "demo_copy"
            ? "template"
            : input.source,
      completed_at:
        input.status === undefined
          ? undefined
          : input.status === "done"
            ? new Date().toISOString()
            : null,
    });
  }
  if (resource === "areas") {
    return compact({
      search_query: input.user_label,
      display_name:
        input.canonical_name === undefined
          ? input.user_label
          : input.canonical_name ?? input.user_label,
      place_reference: nullableInput(input, "provider_place_id"),
      latitude: nullableInput(input, "latitude"),
      longitude: nullableInput(input, "longitude"),
      personal_notes: nullableInput(input, "notes"),
      personal_fit_rating:
        input.personal_fit_score === undefined
          ? undefined
          : input.personal_fit_score === null
            ? null
            : Math.max(
                1,
                Math.min(5, Math.round(Number(input.personal_fit_score) / 20)),
              ),
      ranking_weights: input.user_label === undefined ? undefined : {},
    });
  }
  if (resource === "properties") {
    const original =
      input.property_type === undefined ? undefined : String(input.property_type);
    return compact({
      label: input.label,
      address: nullableInput(input, "address"),
      source_url: nullableInput(input, "source_url"),
      source_name:
        input.source_url === undefined
          ? undefined
          : input.source_url
            ? "User-entered source"
            : null,
      home_type:
        original === undefined ? undefined : propertyTypeToDb[original] ?? "other",
      transaction_type:
        input.intent === undefined
          ? undefined
          : input.intent === "rent" || input.intent === "buy"
          ? input.intent
          : "unknown",
      asking_price_cents:
        input.intent === undefined && input.asking_cost_cents === undefined
          ? undefined
          : input.intent === "buy"
            ? input.asking_cost_cents ?? null
            : null,
      monthly_cost_cents:
        input.intent === undefined && input.asking_cost_cents === undefined
          ? undefined
          : input.intent !== "buy"
            ? input.asking_cost_cents ?? null
            : null,
      bedrooms: nullableInput(input, "bedrooms"),
      bathrooms: nullableInput(input, "bathrooms"),
      status:
        input.status === undefined
          ? undefined
          : input.status === "touring"
          ? "tour_scheduled"
          : input.status === "offered"
            ? "offer_made"
            : input.status === "researching"
              ? "contacted"
              : input.status,
      notes: nullableInput(input, "details"),
      metadata:
        original === undefined &&
        input.monthly_utilities_cents === undefined &&
        input.monthly_fees_cents === undefined &&
        input.commute_text === undefined
          ? undefined
          : {
              originalHomeType: original ?? null,
              originalIntent: input.intent ?? null,
              monthlyUtilitiesCents: input.monthly_utilities_cents ?? null,
              monthlyFeesCents: input.monthly_fees_cents ?? null,
              commuteText: input.commute_text ?? null,
            },
    });
  }
  if (resource === "budget") {
    const phaseToDb: Record<string, string> = {
      before: "before_move",
      moving: "moving",
      after: "after_move",
    };
    return compact({
      name: input.name,
      category: input.category,
      planned_amount_cents: input.estimated_cents,
      actual_amount_cents:
        input.actual_cents === undefined ? undefined : input.actual_cents ?? 0,
      status:
        input.paid === undefined ? undefined : input.paid ? "paid" : "planned",
      currency_code: input.currency,
      phase:
        input.phase === undefined
          ? undefined
          : phaseToDb[String(input.phase)] ?? "moving",
      reimbursable: input.reimbursable,
    });
  }
  if (resource === "boxes") {
    return compact({
      label:
        input.box_number === undefined ? undefined : `Box ${input.box_number}`,
      box_code:
        input.box_number === undefined ? undefined : String(input.box_number),
      room: input.room,
      destination_room: nullableInput(input, "destination_room"),
      contents:
        input.contents === undefined
          ? undefined
          : typeof input.contents === "string"
          ? input.contents
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, 250)
          : [],
      fragile: input.fragile,
      priority:
        input.priority === undefined
          ? undefined
          : input.priority === "first-open"
            ? "open_first"
            : input.priority,
      status: input.status,
    });
  }
  if (resource === "movers") {
    const estimateTypes = new Set([
      "binding",
      "non_binding",
      "binding_not_to_exceed",
      "hourly",
      "unknown",
    ]);
    return compact({
      provider_name: input.company,
      quote_amount_cents: nullableInput(input, "amount_cents"),
      deposit_amount_cents: nullableInput(input, "deposit_cents"),
      estimate_type:
        input.estimate_type === undefined
          ? undefined
          : estimateTypes.has(String(input.estimate_type))
            ? input.estimate_type
            : "unknown",
      services:
        input.services === undefined ? undefined : input.services ?? [],
      insurance_summary: nullableInput(input, "insurance_notes"),
      cancellation_terms: nullableInput(input, "cancellation_notes"),
      availability_note: nullableInput(input, "availability_notes"),
      license_reference: nullableInput(input, "license_notes"),
      contact_name: nullableInput(input, "contact_note"),
      notes: nullableInput(input, "notes"),
      status:
        input.status === undefined
          ? undefined
          : input.status === "quoted"
          ? "received"
          : input.status === "booked"
            ? "accepted"
            : input.status,
    });
  }
  if (resource === "utilities") {
    return compact({
      utility_type: input.service_name === undefined ? undefined : "other",
      provider_name: input.service_name,
      stop_service_on: nullableInput(input, "old_shutoff_date"),
      start_service_on: nullableInput(input, "new_activation_date"),
      confirmation_note: nullableInput(input, "confirmation_reference"),
      notes: nullableInput(input, "notes"),
      status:
        input.status === undefined
          ? undefined
          : input.status === "not-started"
          ? "not_started"
          : input.status === "confirmed"
            ? "active"
            : input.status === "complete"
              ? "closed"
            : input.status,
    });
  }
  if (resource === "address") {
    return compact({
      organization_name: input.organization,
      category:
        input.category === undefined
          ? input.organization === undefined
            ? undefined
            : "other"
          : input.category ?? "other",
      due_date: nullableInput(input, "due_date"),
      confirmation_reference: nullableInput(input, "confirmation_reference"),
      notes: nullableInput(input, "notes"),
      status:
        input.status === undefined
          ? undefined
          : input.status === "not-started"
          ? "not_started"
          : input.status === "not-applicable"
            ? "not_needed"
            : input.status,
    });
  }
  if (resource === "documents") {
    const statuses: Record<string, string> = {
      missing: "needed",
      ready: "received",
      "not-applicable": "not_needed",
    };
    return compact({
      document_kind: input.category,
      title: input.title,
      need_level: input.need_level,
      timing_note: nullableInput(input, "timing_label"),
      rationale: nullableInput(input, "rationale"),
      status:
        input.status === undefined
          ? undefined
          : statuses[String(input.status)] ?? input.status,
      expires_on: nullableInput(input, "expiration_date"),
      notes: nullableInput(input, "custom_detail"),
    });
  }
  if (resource === "settling") {
    return compact({
      title: input.title,
      details: nullableInput(input, "timing_label"),
      phase: input.title === undefined ? undefined : "first_90_days",
      due_date: nullableInput(input, "due_date"),
      completed_at: nullableInput(input, "completed_at"),
      status:
        input.completed_at === undefined
          ? undefined
          : input.completed_at
            ? "completed"
            : "not_started",
    });
  }
  if (resource === "career") {
    const statusToDb: Record<string, string> = {
      researching: "saved",
      offered: "offer",
      closed: "archived",
    };
    const location = input.location_mode;
    const normalizedLocation =
      typeof location === "string" ? location.toLowerCase() : "";
    return compact({
      title: input.name,
      organization_name: nullableInput(input, "organization"),
      status:
        input.status === undefined
          ? undefined
          : statusToDb[String(input.status)] ?? input.status,
      location_label: nullableInput(input, "location_mode"),
      work_arrangement:
        input.location_mode === undefined
          ? undefined
          : ["onsite", "hybrid", "remote"].includes(normalizedLocation)
            ? normalizedLocation
            : "unknown",
      opportunity_type: input.name === undefined ? undefined : "job",
      notes: nullableInput(input, "notes"),
    });
  }
  return input;
}
