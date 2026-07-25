-- Curated, immutable application examples.
-- These rows are read-only to browser roles and are intentionally not linked
-- to auth.users. They contain sample planning content only: no live routes,
-- official area observations, weather, restrictions, listings, or prices.

insert into public.curated_templates (
  id,
  slug,
  title,
  description,
  data_classification,
  schema_version,
  payload,
  is_published,
  published_at
)
values
(
  '00000000-0000-4000-8000-000000000101'::uuid,
  'move-atlas-curated-demo-v1',
  'Move Atlas curated demo',
  'A clearly labeled sample workspace for exploring the Move Atlas workflow without entering personal data.',
  'sample',
  1,
  $json$
  {
    "isDemo": true,
    "dataClassification": "sample",
    "notice": "Every person, plan, property, price, quote, and status in this workspace is sample data. Route, weather, restriction, and official area evidence must be requested from configured providers and are not seeded.",
    "profile": {
      "displayName": "Maya Bennett · sample"
    },
    "movePlan": {
      "name": "Austin to Portland · sample move",
      "status": "planning",
      "moveDate": "2026-10-15",
      "origin": {"label": "Austin, TX"},
      "destination": {"label": "Portland, OR"},
      "householdSummary": {
        "label": "Couple and dog · sample",
        "childrenTraveling": false,
        "petsTraveling": true
      }
    },
    "setupPreferences": {
      "desiredHomeTypes": ["Apartment", "Condo", "Townhome"],
      "accessibilityNeeds": [],
      "movePriorities": {
        "housing": 30,
        "reportedCrimeContext": 20,
        "mobility": 20,
        "market": 15,
        "dailyLife": 15
      },
      "completed": true
    },
    "tasks": [
      {
        "title": "Compare two shortlisted areas",
        "category": "Location",
        "status": "in_progress",
        "source": "template"
      },
      {
        "title": "Request two written moving quotes",
        "category": "Logistics",
        "status": "not_started",
        "source": "template"
      },
      {
        "title": "Verify the moving vehicle dimensions",
        "category": "Route",
        "status": "not_started",
        "source": "template"
      }
    ],
    "areas": [
      {
        "displayName": "Sellwood-Moreland, Portland, OR",
        "personalFitRating": 5,
        "personalNotes": "Sample personal note. Official evidence is intentionally absent from the seed."
      },
      {
        "displayName": "Beaverton, OR",
        "personalFitRating": 4,
        "personalNotes": "Sample personal note. No area score is seeded."
      }
    ],
    "properties": [
      {
        "label": "Sample two-bedroom apartment",
        "homeType": "apartment",
        "transactionType": "rent",
        "status": "saved",
        "notes": "Sample manually saved home; not a current listing."
      },
      {
        "label": "Sample three-bedroom townhome",
        "homeType": "townhome",
        "transactionType": "rent",
        "status": "tour_scheduled",
        "notes": "Sample manually saved home; availability and terms are not verified."
      }
    ],
    "careerOpportunities": [
      {
        "title": "Director, Brand · sample opportunity",
        "organizationName": "Field Notes · sample organization",
        "locationLabel": "Portland, OR / hybrid · sample",
        "workArrangement": "hybrid",
        "status": "interviewing",
        "notes": "Sample planning record; it does not represent a current job opening."
      }
    ],
    "budgetItems": [
      {
        "name": "Move fund target",
        "category": "Reserve",
        "plannedAmountCents": 1800000,
        "phase": "before_move",
        "reimbursable": false,
        "status": "planned"
      },
      {
        "name": "Housing setup and deposits",
        "category": "Housing",
        "plannedAmountCents": 420000,
        "phase": "before_move",
        "reimbursable": false,
        "status": "planned"
      },
      {
        "name": "Moving and transport",
        "category": "Logistics",
        "plannedAmountCents": 315000,
        "phase": "moving",
        "reimbursable": true,
        "status": "quoted"
      }
    ],
    "packingBoxes": [
      {
        "label": "Everyday cookware",
        "boxCode": "K-01",
        "room": "Kitchen",
        "destinationRoom": "Kitchen",
        "status": "loaded",
        "priority": "open_first",
        "fragile": false
      },
      {
        "label": "Monitor, cables, and notebooks",
        "boxCode": "O-01",
        "room": "Office",
        "destinationRoom": "Office",
        "status": "packed",
        "priority": "high",
        "fragile": true
      }
    ],
    "moverQuotes": [
      {
        "providerName": "Northstar Moving Co. · sample",
        "quoteAmountCents": 615000,
        "depositAmountCents": 50000,
        "estimateType": "binding",
        "status": "shortlisted",
        "insuranceSummary": "Sample valuation note; verify actual coverage.",
        "cancellationTerms": "Sample terms only; no real contract exists.",
        "availabilityNote": "Sample availability only.",
        "licenseReference": "Manual verification required"
      }
    ],
    "routeProfile": {
      "name": "26-foot moving truck · sample setup",
      "vehicleCategory": "moving_truck",
      "vehicleHeightM": 3.81,
      "vehicleLengthM": 7.925,
      "grossWeightKg": 9979.03,
      "clearanceBufferM": 0.305,
      "dimensionsVerification": "sample_unverified"
    },
    "providerState": {
      "route": "not_requested",
      "restrictions": "not_requested",
      "weather": "not_requested",
      "areaEvidence": "not_requested"
    }
  }
  $json$::jsonb,
  true,
  '2026-07-24T00:00:00Z'::timestamptz
),
(
  '00000000-0000-4000-8000-000000000102'::uuid,
  'standard-us-move-v1',
  'Standard U.S. move plan',
  'A starter checklist that can be copied into a user-owned move plan after guided setup.',
  'template',
  1,
  $json$
  {
    "isDemo": false,
    "dataClassification": "template",
    "tasks": [
      {"title": "Confirm the move date and decision owners", "category": "Foundation", "relativeDueDays": -90},
      {"title": "Create a realistic move budget and emergency buffer", "category": "Budget", "relativeDueDays": -85},
      {"title": "Compare moving methods and request written quotes", "category": "Movers", "relativeDueDays": -75},
      {"title": "Inventory important records without uploading document contents", "category": "Documents", "relativeDueDays": -60},
      {"title": "Verify vehicle and trailer dimensions from official documentation", "category": "Route", "relativeDueDays": -30},
      {"title": "Review official route restrictions and weather before departure", "category": "Route", "relativeDueDays": -1},
      {"title": "Pack medication, documents, pet supplies, and first-night essentials separately", "category": "Packing", "relativeDueDays": -1},
      {"title": "Confirm utility starts and stops", "category": "Utilities", "relativeDueDays": -7},
      {"title": "Complete priority address changes", "category": "Address", "relativeDueDays": 7},
      {"title": "Review the first-30-day settling checklist", "category": "Settling in", "relativeDueDays": 3}
    ],
    "documentChecklist": [
      {"title": "Current lease or closing metadata", "documentKind": "housing"},
      {"title": "Mover quote and contract metadata", "documentKind": "moving"},
      {"title": "Vehicle registration checklist", "documentKind": "vehicle"},
      {"title": "Veterinary record checklist", "documentKind": "pets"},
      {"title": "School record checklist", "documentKind": "education"}
    ],
    "settlingTasks": [
      {"title": "Set up sleep, medication, food, and a working bathroom", "phase": "arrival_day"},
      {"title": "Confirm utilities and essential local services", "phase": "first_week"},
      {"title": "Handle time-sensitive registration requirements", "phase": "first_month"},
      {"title": "Establish healthcare and pharmacy continuity", "phase": "first_month"},
      {"title": "Review the new-home maintenance baseline", "phase": "first_90_days"}
    ]
  }
  $json$::jsonb,
  true,
  '2026-07-24T00:00:00Z'::timestamptz
)
on conflict do nothing;
