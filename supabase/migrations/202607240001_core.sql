-- Move Atlas production schema: identity, plans, and user-managed move data.
-- All user-owned child records repeat user_id and use composite foreign keys so
-- a record can never be attached to another user's move plan.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Move Atlas member'
    check (char_length(display_name) between 1 and 120),
  avatar_url text
    check (
      avatar_url is null
      or (
        char_length(avatar_url) <= 2048
        and avatar_url ~* '^https://'
      )
    ),
  locale text not null default 'en-US'
    check (char_length(locale) between 2 and 35),
  time_zone text not null default 'UTC'
    check (char_length(time_zone) between 1 and 64),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_profiles is
  'Non-sensitive application profile data. Authentication secrets remain exclusively in Supabase Auth.';

create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := nullif(
    pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')),
    ''
  );

  insert into public.user_profiles (user_id, display_name)
  values (
    new.id,
    left(
      coalesce(
        requested_name,
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Move Atlas member'
      ),
      120
    )
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill identities that existed before this migration. Authenticated browser
-- roles cannot insert profile rows directly, so every existing identity needs a
-- recoverable application profile before RLS is enabled below.
insert into public.user_profiles (user_id, display_name)
select
  users.id,
  left(
    coalesce(
      nullif(pg_catalog.btrim(users.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
      'Move Atlas member'
    ),
    120
  )
from auth.users as users
on conflict (user_id) do nothing;

create table public.move_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'planning'
    check (status in ('planning', 'scheduled', 'in_progress', 'settling_in', 'completed', 'archived')),
  is_current boolean not null default false,
  move_date date,
  origin jsonb not null default '{}'::jsonb
    check (jsonb_typeof(origin) = 'object'),
  destination jsonb not null default '{}'::jsonb
    check (jsonb_typeof(destination) = 'object'),
  household_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(household_summary) = 'object'),
  schema_version integer not null default 1 check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

comment on column public.move_plans.origin is
  'User-selected origin label and coordinates. Do not add provider credentials or opaque private provider payloads.';
comment on column public.move_plans.destination is
  'User-selected destination label and coordinates. Do not add provider credentials or opaque private provider payloads.';

create unique index move_plans_one_current_per_user_idx
  on public.move_plans (user_id)
  where is_current;
create index move_plans_user_updated_idx
  on public.move_plans (user_id, updated_at desc);
create index move_plans_user_status_idx
  on public.move_plans (user_id, status);

create trigger set_move_plans_updated_at
before update on public.move_plans
for each row execute function public.set_updated_at();

create table public.setup_preferences (
  move_plan_id uuid primary key,
  user_id uuid not null default auth.uid(),
  move_reason text check (move_reason is null or char_length(move_reason) <= 500),
  household_size integer check (household_size is null or household_size between 1 and 50),
  children_traveling boolean,
  pets_traveling boolean,
  desired_home_types text[] not null default '{}'::text[],
  accessibility_needs text[] not null default '{}'::text[],
  move_priorities jsonb not null default '{}'::jsonb
    check (jsonb_typeof(move_priorities) = 'object'),
  route_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(route_preferences) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create index setup_preferences_user_idx
  on public.setup_preferences (user_id, move_plan_id);

create trigger set_setup_preferences_updated_at
before update on public.setup_preferences
for each row execute function public.set_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  details text check (details is null or char_length(details) <= 10000),
  category text not null default 'general'
    check (char_length(category) between 1 and 80),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'completed', 'skipped')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  source text not null default 'user'
    check (source in ('user', 'guided_setup', 'template', 'assistant')),
  due_date date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create index tasks_plan_status_due_idx
  on public.tasks (user_id, move_plan_id, status, due_date);
create index tasks_plan_sort_idx
  on public.tasks (user_id, move_plan_id, sort_order, created_at);

create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  search_query text not null check (char_length(search_query) between 1 and 500),
  display_name text not null check (char_length(display_name) between 1 and 500),
  place_reference text check (place_reference is null or char_length(place_reference) <= 500),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  personal_fit_rating smallint check (personal_fit_rating is null or personal_fit_rating between 1 and 5),
  personal_notes text check (personal_notes is null or char_length(personal_notes) <= 20000),
  ranking_weights jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ranking_weights) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

comment on table public.areas is
  'User shortlist and personal fit data only. Official measures and scores are stored separately as server-derived evidence.';

create index areas_plan_updated_idx
  on public.areas (user_id, move_plan_id, updated_at desc);
create index areas_plan_location_idx
  on public.areas (user_id, move_plan_id, latitude, longitude);

create trigger set_areas_updated_at
before update on public.areas
for each row execute function public.set_updated_at();

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  label text not null check (char_length(label) between 1 and 240),
  address text check (address is null or char_length(address) <= 1000),
  home_type text not null default 'other'
    check (home_type in ('house', 'apartment', 'condo', 'townhome', 'duplex', 'manufactured_home', 'other')),
  transaction_type text not null default 'unknown'
    check (transaction_type in ('rent', 'buy', 'lease_takeover', 'unknown')),
  status text not null default 'saved'
    check (status in ('saved', 'contacted', 'tour_scheduled', 'applied', 'offer_made', 'accepted', 'rejected', 'archived')),
  source_name text check (source_name is null or char_length(source_name) <= 120),
  source_url text
    check (
      source_url is null
      or (
        char_length(source_url) <= 2048
        and source_url ~* '^https?://'
      )
    ),
  asking_price_cents bigint check (asking_price_cents is null or asking_price_cents >= 0),
  monthly_cost_cents bigint check (monthly_cost_cents is null or monthly_cost_cents >= 0),
  bedrooms numeric(4,1) check (bedrooms is null or bedrooms between 0 and 100),
  bathrooms numeric(4,1) check (bathrooms is null or bathrooms between 0 and 100),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  notes text check (notes is null or char_length(notes) <= 20000),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

comment on table public.properties is
  'Manually saved homes and rentals. This table is not evidence of current listing availability.';

create index properties_plan_status_idx
  on public.properties (user_id, move_plan_id, status);
create index properties_plan_type_idx
  on public.properties (user_id, move_plan_id, home_type, transaction_type);

create trigger set_properties_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

create table public.career_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  organization_name text check (organization_name is null or char_length(organization_name) <= 240),
  location_label text check (location_label is null or char_length(location_label) <= 500),
  opportunity_type text not null default 'job'
    check (opportunity_type in ('job', 'contract', 'business', 'education', 'other')),
  work_arrangement text not null default 'unknown'
    check (work_arrangement in ('onsite', 'hybrid', 'remote', 'unknown')),
  status text not null default 'saved'
    check (status in ('saved', 'applied', 'interviewing', 'offer', 'accepted', 'declined', 'archived')),
  compensation_min_cents bigint check (compensation_min_cents is null or compensation_min_cents >= 0),
  compensation_max_cents bigint check (
    compensation_max_cents is null
    or (
      compensation_max_cents >= 0
      and (compensation_min_cents is null or compensation_max_cents >= compensation_min_cents)
    )
  ),
  compensation_period text
    check (compensation_period is null or compensation_period in ('hour', 'month', 'year', 'project')),
  currency_code text not null default 'USD'
    check (currency_code ~ '^[A-Z]{3}$'),
  source_name text check (source_name is null or char_length(source_name) <= 120),
  source_url text
    check (
      source_url is null
      or (
        char_length(source_url) <= 2048
        and source_url ~* '^https?://'
      )
    ),
  notes text check (notes is null or char_length(notes) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

comment on table public.career_opportunities is
  'User-managed career research. Saved opportunities are not verified as open or current unless a configured provider supplies that fact.';

create index career_opportunities_plan_status_idx
  on public.career_opportunities (user_id, move_plan_id, status);
create index career_opportunities_plan_updated_idx
  on public.career_opportunities (user_id, move_plan_id, updated_at desc);

create trigger set_career_opportunities_updated_at
before update on public.career_opportunities
for each row execute function public.set_updated_at();

create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  name text not null check (char_length(name) between 1 and 240),
  category text not null default 'other'
    check (char_length(category) between 1 and 80),
  planned_amount_cents bigint not null default 0 check (planned_amount_cents >= 0),
  actual_amount_cents bigint not null default 0 check (actual_amount_cents >= 0),
  currency_code text not null default 'USD'
    check (currency_code ~ '^[A-Z]{3}$'),
  phase text not null default 'before_move'
    check (phase in ('before_move', 'moving', 'after_move')),
  reimbursable boolean not null default false,
  status text not null default 'planned'
    check (status in ('planned', 'quoted', 'committed', 'paid', 'refunded', 'canceled')),
  due_date date,
  vendor_name text check (vendor_name is null or char_length(vendor_name) <= 240),
  notes text check (notes is null or char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create index budget_items_plan_category_idx
  on public.budget_items (user_id, move_plan_id, category);
create index budget_items_plan_status_idx
  on public.budget_items (user_id, move_plan_id, status);
create index budget_items_plan_phase_idx
  on public.budget_items (user_id, move_plan_id, phase);

create trigger set_budget_items_updated_at
before update on public.budget_items
for each row execute function public.set_updated_at();

create table public.packing_boxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  label text not null check (char_length(label) between 1 and 240),
  box_code text check (box_code is null or char_length(box_code) <= 80),
  room text check (room is null or char_length(room) <= 120),
  destination_room text check (destination_room is null or char_length(destination_room) <= 120),
  status text not null default 'planned'
    check (status in ('planned', 'packing', 'packed', 'loaded', 'unloaded', 'unpacked')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'open_first')),
  contents text[] not null default '{}'::text[]
    check (cardinality(contents) <= 250),
  fragile boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create unique index packing_boxes_plan_code_idx
  on public.packing_boxes (user_id, move_plan_id, lower(box_code))
  where box_code is not null;
create index packing_boxes_plan_status_idx
  on public.packing_boxes (user_id, move_plan_id, status);
create index packing_boxes_plan_room_idx
  on public.packing_boxes (user_id, move_plan_id, room);

create trigger set_packing_boxes_updated_at
before update on public.packing_boxes
for each row execute function public.set_updated_at();

create table public.mover_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  provider_name text not null check (char_length(provider_name) between 1 and 240),
  quote_amount_cents bigint check (quote_amount_cents is null or quote_amount_cents >= 0),
  deposit_amount_cents bigint check (deposit_amount_cents is null or deposit_amount_cents >= 0),
  currency_code text not null default 'USD'
    check (currency_code ~ '^[A-Z]{3}$'),
  estimate_type text not null default 'unknown'
    check (estimate_type in ('binding', 'non_binding', 'binding_not_to_exceed', 'hourly', 'unknown')),
  quote_date date,
  expires_on date,
  status text not null default 'researching'
    check (status in ('researching', 'requested', 'received', 'shortlisted', 'accepted', 'declined', 'expired')),
  services text[] not null default '{}'::text[],
  contact_name text check (contact_name is null or char_length(contact_name) <= 240),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 80),
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  insurance_summary text check (insurance_summary is null or char_length(insurance_summary) <= 2000),
  cancellation_terms text check (cancellation_terms is null or char_length(cancellation_terms) <= 5000),
  availability_note text check (availability_note is null or char_length(availability_note) <= 1000),
  license_reference text check (license_reference is null or char_length(license_reference) <= 500),
  website_url text
    check (
      website_url is null
      or (
        char_length(website_url) <= 2048
        and website_url ~* '^https?://'
      )
    ),
  notes text check (notes is null or char_length(notes) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create index mover_quotes_plan_status_idx
  on public.mover_quotes (user_id, move_plan_id, status);
create index mover_quotes_plan_amount_idx
  on public.mover_quotes (user_id, move_plan_id, quote_amount_cents);

create trigger set_mover_quotes_updated_at
before update on public.mover_quotes
for each row execute function public.set_updated_at();

create table public.utilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  utility_type text not null
    check (utility_type in ('electricity', 'gas', 'water', 'sewer', 'internet', 'mobile', 'trash', 'security', 'other')),
  provider_name text check (provider_name is null or char_length(provider_name) <= 240),
  service_address text check (service_address is null or char_length(service_address) <= 1000),
  start_service_on date,
  stop_service_on date,
  status text not null default 'not_started'
    check (status in ('not_started', 'researching', 'scheduled', 'active', 'closed', 'not_needed')),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 80),
  website_url text
    check (
      website_url is null
      or (
        char_length(website_url) <= 2048
        and website_url ~* '^https?://'
      )
    ),
  confirmation_note text check (confirmation_note is null or char_length(confirmation_note) <= 500),
  notes text check (notes is null or char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

comment on table public.utilities is
  'Utility planning metadata. Full account numbers, passwords, and payment information must not be stored.';

create index utilities_plan_type_status_idx
  on public.utilities (user_id, move_plan_id, utility_type, status);

create trigger set_utilities_updated_at
before update on public.utilities
for each row execute function public.set_updated_at();

create table public.address_change_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  organization_name text not null check (char_length(organization_name) between 1 and 240),
  category text not null default 'other'
    check (char_length(category) between 1 and 80),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'submitted', 'confirmed', 'not_needed')),
  due_date date,
  completed_at timestamptz,
  confirmation_reference text
    check (confirmation_reference is null or char_length(confirmation_reference) <= 500),
  website_url text
    check (
      website_url is null
      or (
        char_length(website_url) <= 2048
        and website_url ~* '^https?://'
      )
    ),
  notes text check (notes is null or char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create index address_change_plan_status_idx
  on public.address_change_items (user_id, move_plan_id, status, due_date);

create trigger set_address_change_items_updated_at
before update on public.address_change_items
for each row execute function public.set_updated_at();

create table public.document_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  document_kind text not null default 'other'
    check (char_length(document_kind) between 1 and 100),
  need_level text not null default 'recommended'
    check (need_level in ('required', 'situation_dependent', 'recommended', 'optional')),
  timing_note text check (timing_note is null or char_length(timing_note) <= 240),
  rationale text check (rationale is null or char_length(rationale) <= 5000),
  status text not null default 'needed'
    check (status in ('needed', 'requested', 'received', 'verified', 'expired', 'not_needed')),
  expires_on date,
  reminder_on date,
  issuer_name text check (issuer_name is null or char_length(issuer_name) <= 240),
  notes text check (notes is null or char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

comment on table public.document_checklist_items is
  'Checklist metadata only. Document files, contents, government IDs, and account numbers are intentionally not stored.';

create index document_checklist_plan_status_idx
  on public.document_checklist_items (user_id, move_plan_id, status, reminder_on);

create trigger set_document_checklist_items_updated_at
before update on public.document_checklist_items
for each row execute function public.set_updated_at();

create table public.settling_in_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  details text check (details is null or char_length(details) <= 10000),
  phase text not null default 'first_week'
    check (phase in ('arrival_day', 'first_week', 'first_month', 'first_60_days', 'first_90_days')),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'skipped')),
  due_date date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create index settling_tasks_plan_phase_idx
  on public.settling_in_tasks (user_id, move_plan_id, phase, status);

create trigger set_settling_in_tasks_updated_at
before update on public.settling_in_tasks
for each row execute function public.set_updated_at();

create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  title text not null default 'Move planning conversation'
    check (char_length(title) between 1 and 240),
  assistant_mode text not null default 'planning'
    check (assistant_mode in ('planning', 'operator_model')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade
);

create index assistant_conversations_plan_idx
  on public.assistant_conversations (user_id, move_plan_id, updated_at desc);

create trigger set_assistant_conversations_updated_at
before update on public.assistant_conversations
for each row execute function public.set_updated_at();

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (char_length(content) between 1 and 20000),
  grounding jsonb not null default '{}'::jsonb
    check (jsonb_typeof(grounding) = 'object'),
  provider_name text check (provider_name is null or char_length(provider_name) <= 100),
  provider_request_id text check (provider_request_id is null or char_length(provider_request_id) <= 255),
  created_at timestamptz not null default now(),
  unique (user_id, move_plan_id, conversation_id, id),
  foreign key (user_id, move_plan_id, conversation_id)
    references public.assistant_conversations (user_id, move_plan_id, id) on delete cascade
);

comment on table public.assistant_messages is
  'Conversation text only. Application policy must reject passwords, payment data, document contents, and unnecessary sensitive information.';

create index assistant_messages_conversation_idx
  on public.assistant_messages (user_id, move_plan_id, conversation_id, created_at);

create table public.local_data_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null default 'legacy_local_storage'
    check (source_kind = 'legacy_local_storage'),
  source_fingerprint text not null
    check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_schema_version integer not null check (source_schema_version > 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  imported_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(imported_counts) = 'object'),
  failure_code text check (failure_code is null or char_length(failure_code) <= 120),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, source_kind)
);

comment on table public.local_data_imports is
  'Idempotency receipt only. Raw browser-local data is validated and imported into typed tables; it is never stored here.';

create index local_data_imports_user_status_idx
  on public.local_data_imports (user_id, status);

create trigger set_local_data_imports_updated_at
before update on public.local_data_imports
for each row execute function public.set_updated_at();

create table public.curated_templates (
  id uuid primary key,
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 1000),
  data_classification text not null
    check (data_classification in ('sample', 'template')),
  schema_version integer not null check (schema_version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.curated_templates is
  'Read-only curated sample/template content. It contains no live provider observations and is isolated from real user accounts.';
