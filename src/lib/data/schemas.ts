import { z } from "zod";

const shortText = z.string().trim().min(1).max(160);
const optionalText = z.string().trim().max(2_000).nullable().optional();
const moneyCents = z.coerce.number().int().min(0).max(1_000_000_000);
const date = z.iso.date().nullable().optional();
const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL.")
  .nullable()
  .optional();

export const movePlanInputSchema = z.object({
  name: shortText.max(80),
  personName: shortText.max(80),
  household: shortText.max(80),
  originLabel: shortText.max(200),
  destinationLabel: shortText.max(200),
  moveType: z.enum(["local", "long-distance", "international", "undecided"]),
  targetDate: date,
  timeframe: shortText.max(80),
  housingIntent: z.enum(["rent", "buy", "either", "temporary"]),
  housingMaxCents: moneyCents,
  savingsCents: moneyCents,
  moveFundTargetCents: moneyCents,
  propertyTypes: z.array(shortText.max(40)).max(12),
  bedrooms: z.coerce.number().int().min(0).max(20).nullable(),
  bathrooms: z.coerce.number().min(0).max(20).nullable(),
  pets: z.array(shortText.max(60)).max(12),
  accessibilityNeeds: z.array(shortText.max(100)).max(20),
  commuteMode: shortText.max(60),
  maxCommuteMinutes: z.coerce.number().int().min(0).max(360),
  dailyNeeds: z.array(shortText.max(100)).max(30),
  priorityTags: z.array(shortText.max(80)).max(20),
  weights: z.object({
    housing: z.coerce.number().int().min(0).max(100),
    reportedCrime: z.coerce.number().int().min(0).max(100),
    mobility: z.coerce.number().int().min(0).max(100),
    market: z.coerce.number().int().min(0).max(100),
    dailyLife: z.coerce.number().int().min(0).max(100),
    schools: z.coerce.number().int().min(0).max(100).default(0),
  }),
});

const taskSchema = z.object({
  title: shortText,
  category: shortText.max(80).default("General"),
  timing_label: z.string().trim().max(80).nullable().optional(),
  due_date: date,
  status: z.enum(["open", "done"]).default("open"),
  source: z.enum(["user", "setup", "assistant", "demo_copy"]).default("user"),
});

const areaSchema = z.object({
  user_label: shortText.max(200),
  canonical_name: z.string().trim().max(240).nullable().optional(),
  place_type: z.string().trim().max(80).nullable().optional(),
  provider_place_id: z.string().trim().max(240).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  notes: optionalText,
  personal_fit_score: z.coerce.number().min(0).max(100).nullable().optional(),
});

const propertySchema = z.object({
  label: shortText.max(200),
  address: z.string().trim().max(300).nullable().optional(),
  source_url: httpsUrl,
  property_type: z.enum([
    "apartment",
    "condo",
    "townhome",
    "single-family",
    "multifamily",
    "co-living",
    "new-build",
    "temporary",
    "other",
  ]),
  intent: z.enum(["rent", "buy", "either", "temporary"]),
  asking_cost_cents: moneyCents.nullable().optional(),
  monthly_utilities_cents: moneyCents.nullable().optional(),
  monthly_fees_cents: moneyCents.nullable().optional(),
  bedrooms: z.coerce.number().min(0).max(50).nullable().optional(),
  bathrooms: z.coerce.number().min(0).max(50).nullable().optional(),
  commute_text: z.string().trim().max(160).nullable().optional(),
  status: z
    .enum(["saved", "researching", "touring", "applied", "offered", "archived"])
    .default("saved"),
  details: optionalText,
});

const budgetSchema = z.object({
  name: shortText,
  category: shortText.max(80),
  phase: z.enum(["before", "moving", "after"]).default("moving"),
  estimated_cents: moneyCents,
  actual_cents: moneyCents.nullable().optional(),
  paid: z.boolean().default(false),
  reimbursable: z.boolean().default(false),
  currency: z.literal("USD").default("USD"),
});

const boxSchema = z.object({
  box_number: z.coerce.number().int().min(1).max(100_000),
  room: shortText.max(80),
  destination_room: z.string().trim().max(80).nullable().optional(),
  contents: z.string().trim().max(1_000).nullable().optional(),
  fragile: z.boolean().default(false),
  priority: z.enum(["low", "normal", "first-open"]).default("normal"),
  status: z
    .enum(["planned", "packed", "loaded", "unloaded", "unpacked"])
    .default("planned"),
});

const moverQuoteSchema = z.object({
  company: shortText.max(160),
  amount_cents: moneyCents.nullable().optional(),
  deposit_cents: moneyCents.nullable().optional(),
  estimate_type: z.string().trim().max(80).nullable().optional(),
  services: z.array(shortText.max(100)).max(30).default([]),
  insurance_notes: optionalText,
  cancellation_notes: optionalText,
  availability_notes: optionalText,
  license_notes: optionalText,
  contact_note: optionalText,
  notes: optionalText,
  status: z.enum(["researching", "quoted", "shortlisted", "booked", "declined"]),
});

const utilitySchema = z.object({
  service_name: shortText.max(120),
  old_shutoff_date: date,
  new_activation_date: date,
  confirmation_reference: z.string().trim().max(120).nullable().optional(),
  notes: optionalText,
  status: z.enum(["not-started", "scheduled", "confirmed", "complete"]),
});

const addressSchema = z.object({
  organization: shortText.max(160),
  category: z.string().trim().max(80).nullable().optional(),
  due_date: date,
  confirmation_reference: z.string().trim().max(120).nullable().optional(),
  notes: optionalText,
  status: z.enum(["not-started", "submitted", "confirmed", "not-applicable"]),
});

const documentSchema = z.object({
  category: shortText.max(80),
  title: shortText.max(160),
  need_level: z
    .enum(["required", "situation_dependent", "recommended", "optional"])
    .default("recommended"),
  timing_label: z.string().trim().max(80).nullable().optional(),
  rationale: optionalText,
  status: z.enum(["missing", "requested", "ready", "expired", "not-applicable"]),
  expiration_date: date,
  custom_detail: optionalText,
});

const settlingSchema = z.object({
  title: shortText,
  timing_label: z.string().trim().max(80).nullable().optional(),
  due_date: date,
  completed_at: z.iso.datetime().nullable().optional(),
});

const careerSchema = z.object({
  name: shortText.max(160),
  organization: z.string().trim().max(160).nullable().optional(),
  status: z
    .enum(["saved", "researching", "applied", "interviewing", "offered", "closed"])
    .default("saved"),
  location_mode: z.string().trim().max(120).nullable().optional(),
  notes: optionalText,
  user_rating: z.coerce.number().min(0).max(100).nullable().optional(),
});

export const recordDefinitions = {
  tasks: { table: "tasks", schema: taskSchema },
  areas: { table: "areas", schema: areaSchema },
  properties: { table: "properties", schema: propertySchema },
  budget: { table: "budget_items", schema: budgetSchema },
  boxes: { table: "packing_boxes", schema: boxSchema },
  movers: { table: "mover_quotes", schema: moverQuoteSchema },
  utilities: { table: "utilities", schema: utilitySchema },
  address: { table: "address_change_items", schema: addressSchema },
  documents: { table: "document_checklist_items", schema: documentSchema },
  settling: { table: "settling_in_tasks", schema: settlingSchema },
  career: { table: "career_opportunities", schema: careerSchema },
} as const;

export type ResourceName = keyof typeof recordDefinitions;

export function isResourceName(value: string): value is ResourceName {
  return Object.prototype.hasOwnProperty.call(recordDefinitions, value);
}

export const safeExternalUrlSchema = httpsUrl.unwrap().unwrap();
