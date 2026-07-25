-- Move Atlas production schema: provider-derived area, route, restriction,
-- weather, cache, and rate-limit data.

create table public.area_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  area_id uuid not null,
  status text not null
    check (status in ('available', 'partial', 'unavailable')),
  weighted_score numeric(5,2)
    check (weighted_score is null or weighted_score between 0 and 100),
  requested_weight_total numeric(12,4) not null default 0
    check (requested_weight_total >= 0),
  supported_weight_total numeric(12,4) not null default 0
    check (
      supported_weight_total >= 0
      and supported_weight_total <= requested_weight_total
    ),
  coverage_percent numeric(5,2) not null default 0
    check (coverage_percent between 0 and 100),
  resolved_geographies jsonb not null default '[]'::jsonb
    check (jsonb_typeof(resolved_geographies) = 'array'),
  source_summary jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_summary) = 'array'),
  caveats text[] not null default '{}'::text[],
  generated_at timestamptz not null default now(),
  stale_after timestamptz not null,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  unique (user_id, move_plan_id, area_id, id),
  foreign key (user_id, move_plan_id, area_id)
    references public.areas (user_id, move_plan_id, id) on delete cascade,
  check (
    (
      status = 'unavailable'
      and weighted_score is null
      and supported_weight_total = 0
    )
    or (
      status in ('available', 'partial')
      and weighted_score is not null
      and requested_weight_total > 0
      and supported_weight_total > 0
    )
  )
);

comment on table public.area_snapshots is
  'Server-derived, timestamped area evidence summary. Missing measures are excluded from the weighted denominator; coverage_percent is the share of requested categories with reliable data and is intentionally separate from the weighted denominator.';

create index area_snapshots_area_generated_idx
  on public.area_snapshots (user_id, move_plan_id, area_id, generated_at desc);
create index area_snapshots_stale_idx
  on public.area_snapshots (stale_after);

create table public.area_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  area_id uuid not null,
  snapshot_id uuid not null,
  measure_key text not null
    check (measure_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  measure_name text not null check (char_length(measure_name) between 1 and 160),
  availability text not null
    check (availability in ('available', 'unavailable')),
  raw_value jsonb,
  raw_display text check (raw_display is null or char_length(raw_display) <= 240),
  unit text check (unit is null or char_length(unit) <= 80),
  normalized_fit_score numeric(5,2)
    check (normalized_fit_score is null or normalized_fit_score between 0 and 100),
  applied_weight numeric(12,4) check (applied_weight is null or applied_weight >= 0),
  source_name text check (source_name is null or char_length(source_name) <= 160),
  source_url text
    check (
      source_url is null
      or (
        char_length(source_url) <= 2048
        and source_url ~* '^https://'
      )
    ),
  geography_type text check (geography_type is null or char_length(geography_type) <= 80),
  geography_label text check (geography_label is null or char_length(geography_label) <= 240),
  geography_identifier text check (geography_identifier is null or char_length(geography_identifier) <= 160),
  reference_period text check (reference_period is null or char_length(reference_period) <= 120),
  coverage_note text check (coverage_note is null or char_length(coverage_note) <= 1000),
  caveats text[] not null default '{}'::text[],
  retrieved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, move_plan_id, area_id, snapshot_id)
    references public.area_snapshots (user_id, move_plan_id, area_id, id) on delete cascade,
  unique (snapshot_id, measure_key),
  check (
    (
      availability = 'available'
      and raw_value is not null
      and source_name is not null
      and reference_period is not null
      and retrieved_at is not null
      and (
        (
          normalized_fit_score is not null
          and applied_weight is not null
        )
        or (
          normalized_fit_score is null
          and applied_weight is null
        )
      )
    )
    or (
      availability = 'unavailable'
      and raw_value is null
      and normalized_fit_score is null
      and applied_weight is null
    )
  )
);

comment on table public.area_metrics is
  'Evidence rows retain value, normalized fit, geography, period, source, retrieval time, coverage, and caveats. Crime measures must be labeled as reported crime/incidents in application copy.';

create index area_metrics_snapshot_idx
  on public.area_metrics (user_id, move_plan_id, area_id, snapshot_id);
create index area_metrics_measure_idx
  on public.area_metrics (measure_key, reference_period);

create table public.route_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  move_plan_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  vehicle_category text not null
    check (
      vehicle_category in (
        'passenger_car',
        'suv',
        'pickup',
        'cargo_van',
        'moving_truck',
        'moving_truck_towing_vehicle',
        'car_towing_trailer',
        'rv',
        'oversized_vehicle'
      )
    ),
  display_unit_system text not null default 'us'
    check (display_unit_system in ('us', 'metric')),
  vehicle_height_m numeric(8,3)
    check (vehicle_height_m is null or vehicle_height_m between 0.5 and 10),
  vehicle_width_m numeric(8,3)
    check (vehicle_width_m is null or vehicle_width_m between 0.5 and 10),
  vehicle_length_m numeric(9,3)
    check (vehicle_length_m is null or vehicle_length_m between 1 and 60),
  gross_weight_kg numeric(12,2)
    check (gross_weight_kg is null or gross_weight_kg between 1 and 200000),
  axle_weight_kg numeric(12,2)
    check (
      axle_weight_kg is null
      or (
        axle_weight_kg between 1 and 100000
        and (gross_weight_kg is null or axle_weight_kg <= gross_weight_kg)
      )
    ),
  trailer_enabled boolean not null default false,
  trailer_height_m numeric(8,3)
    check (trailer_height_m is null or trailer_height_m between 0.2 and 10),
  trailer_width_m numeric(8,3)
    check (trailer_width_m is null or trailer_width_m between 0.2 and 10),
  trailer_length_m numeric(9,3)
    check (trailer_length_m is null or trailer_length_m between 0.5 and 40),
  trailer_weight_kg numeric(12,2)
    check (trailer_weight_kg is null or trailer_weight_kg between 0 and 100000),
  loaded_status text not null default 'unknown'
    check (loaded_status in ('unloaded', 'lightly_loaded', 'loaded', 'unknown')),
  fuel_type text not null default 'regular_gasoline'
    check (fuel_type in ('regular_gasoline', 'midgrade_gasoline', 'premium_gasoline', 'diesel', 'electric')),
  tank_or_battery_capacity numeric(12,3)
    check (tank_or_battery_capacity is null or tank_or_battery_capacity > 0),
  capacity_unit text
    check (capacity_unit is null or capacity_unit in ('us_gallon', 'liter', 'kwh')),
  efficiency_value numeric(12,4)
    check (efficiency_value is null or efficiency_value > 0),
  efficiency_unit text
    check (efficiency_unit is null or efficiency_unit in ('mpg_us', 'l_per_100km', 'kwh_per_100km')),
  starting_capacity_percent numeric(5,2)
    check (starting_capacity_percent is null or starting_capacity_percent between 0 and 100),
  preferred_minimum_percent numeric(5,2)
    check (preferred_minimum_percent is null or preferred_minimum_percent between 0 and 100),
  clearance_buffer_m numeric(8,3) not null default 0.152
    check (clearance_buffer_m between 0 and 3),
  avoidance_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(avoidance_preferences) = 'object'),
  party_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(party_preferences) = 'object'),
  hotel_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(hotel_preferences) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade,
  check (
    (trailer_enabled and trailer_length_m is not null)
    or (
      not trailer_enabled
      and trailer_height_m is null
      and trailer_width_m is null
      and trailer_length_m is null
      and trailer_weight_kg is null
    )
  ),
  check (
    (
      fuel_type = 'electric'
      and (capacity_unit is null or capacity_unit = 'kwh')
      and (efficiency_unit is null or efficiency_unit = 'kwh_per_100km')
    )
    or (
      fuel_type <> 'electric'
      and (capacity_unit is null or capacity_unit in ('us_gallon', 'liter'))
      and (efficiency_unit is null or efficiency_unit in ('mpg_us', 'l_per_100km'))
    )
  )
);

comment on table public.route_profiles is
  'Vehicle values are stored in explicit canonical units. The app must confirm exact height with vehicle or rental documentation before routing.';

create index route_profiles_plan_idx
  on public.route_profiles (user_id, move_plan_id, updated_at desc);

create trigger set_route_profiles_updated_at
before update on public.route_profiles
for each row execute function public.set_updated_at();

create table public.saved_route_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  route_profile_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  provider_name text not null check (char_length(provider_name) between 1 and 100),
  provider_route_id text check (provider_route_id is null or char_length(provider_route_id) <= 500),
  provider_api_version text check (provider_api_version is null or char_length(provider_api_version) <= 80),
  route_mode text not null
    check (route_mode in ('car', 'truck')),
  route_strategy text not null
    check (
      route_strategy in (
        'fastest',
        'shortest',
        'fuel_conscious',
        'truck_suitable',
        'weather_aware',
        'custom'
      )
    ),
  origin jsonb not null check (jsonb_typeof(origin) = 'object'),
  destination jsonb not null check (jsonb_typeof(destination) = 'object'),
  waypoints jsonb not null default '[]'::jsonb
    check (jsonb_typeof(waypoints) = 'array'),
  flexible_polyline text check (flexible_polyline is null or char_length(flexible_polyline) <= 2000000),
  distance_m bigint check (distance_m is null or distance_m >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  base_duration_seconds integer check (base_duration_seconds is null or base_duration_seconds >= 0),
  traffic_duration_seconds integer check (traffic_duration_seconds is null or traffic_duration_seconds >= 0),
  estimated_arrival_at timestamptz,
  planned_departure_at timestamptz not null,
  toll_amount numeric(12,2) check (toll_amount is null or toll_amount >= 0),
  toll_currency text check (toll_currency is null or toll_currency ~ '^[A-Z]{3}$'),
  selected_alternative_index smallint not null default 0
    check (selected_alternative_index >= 0),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  restriction_coverage text not null default 'unavailable'
    check (restriction_coverage in ('available', 'partial', 'unavailable')),
  data_state text not null
    check (data_state in ('live', 'recently_updated', 'cached', 'stale', 'unavailable')),
  provider_retrieved_at timestamptz,
  stale_after timestamptz,
  unavailable_reason text check (unavailable_reason is null or char_length(unavailable_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, move_plan_id, id),
  foreign key (user_id, move_plan_id, route_profile_id)
    references public.route_profiles (user_id, move_plan_id, id) on delete cascade,
  check (
    (data_state = 'unavailable' and unavailable_reason is not null)
    or data_state <> 'unavailable'
  )
);

comment on table public.saved_route_plans is
  'Server-derived route results. No row represents a guarantee that a route is safe, legal, open, or suitable.';

create index saved_routes_plan_departure_idx
  on public.saved_route_plans (user_id, move_plan_id, planned_departure_at);
create index saved_routes_profile_idx
  on public.saved_route_plans (user_id, move_plan_id, route_profile_id, updated_at desc);
create index saved_routes_stale_idx
  on public.saved_route_plans (stale_after)
  where stale_after is not null;

create trigger set_saved_route_plans_updated_at
before update on public.saved_route_plans
for each row execute function public.set_updated_at();

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  route_plan_id uuid not null,
  stop_order integer not null check (stop_order >= 0),
  stop_type text not null
    check (
      stop_type in (
        'waypoint',
        'fuel',
        'hotel',
        'food',
        'rest_area',
        'park',
        'pet_break',
        'urgent_care',
        'veterinary',
        'repair',
        'towing',
        'attraction'
      )
    ),
  provider_place_id text check (provider_place_id is null or char_length(provider_place_id) <= 500),
  name text not null check (char_length(name) between 1 and 500),
  address text check (address is null or char_length(address) <= 1000),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  planned_arrival_at timestamptz,
  planned_duration_minutes integer check (planned_duration_minutes is null or planned_duration_minutes between 0 and 10080),
  route_deviation_m integer check (route_deviation_m is null or route_deviation_m >= 0),
  additional_drive_seconds integer check (additional_drive_seconds is null or additional_drive_seconds >= 0),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  verification_state text not null default 'unverified'
    check (verification_state in ('provider_verified', 'user_entered', 'unverified')),
  provider_retrieved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, move_plan_id, route_plan_id)
    references public.saved_route_plans (user_id, move_plan_id, id) on delete cascade,
  unique (route_plan_id, stop_order)
);

comment on table public.route_stops is
  'Provider details are stored only when supplied. Missing hours, prices, access, parking, or pet policies remain unverified.';

create index route_stops_route_order_idx
  on public.route_stops (user_id, move_plan_id, route_plan_id, stop_order);

create table public.route_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  route_plan_id uuid not null,
  segment_index integer check (segment_index is null or segment_index >= 0),
  restriction_type text not null
    check (
      restriction_type in (
        'clearance',
        'weight',
        'axle_weight',
        'length',
        'width',
        'trailer',
        'truck_prohibition',
        'narrow_road',
        'sharp_turn',
        'steep_grade',
        'mountain_pass',
        'seasonal_closure',
        'construction',
        'flood',
        'high_wind',
        'turnaround',
        'coverage'
      )
    ),
  finding text not null
    check (
      finding in (
        'confirmed_conflict',
        'possible_conflict',
        'narrow_margin',
        'data_unavailable',
        'restriction_notice',
        'no_conflict_in_available_data'
      )
    ),
  severity text not null
    check (severity in ('info', 'low', 'moderate', 'high', 'severe')),
  provider_description text check (provider_description is null or char_length(provider_description) <= 5000),
  location_name text check (location_name is null or char_length(location_name) <= 500),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  entered_vehicle_value numeric(12,3),
  known_restriction_value numeric(12,3),
  safety_buffer_value numeric(12,3),
  measurement_unit text check (measurement_unit is null or measurement_unit in ('m', 'kg', 'percent', 'degrees')),
  source_name text not null check (char_length(source_name) between 1 and 160),
  source_reference text check (source_reference is null or char_length(source_reference) <= 2048),
  coverage_note text not null check (char_length(coverage_note) between 1 and 2000),
  provider_retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, move_plan_id, route_plan_id)
    references public.saved_route_plans (user_id, move_plan_id, id) on delete cascade,
  check (
    finding <> 'data_unavailable'
    or known_restriction_value is null
  )
);

comment on table public.route_restrictions is
  'Critical warnings are provider-derived and timestamped. Missing data is never treated as proof that no restriction exists.';

create index route_restrictions_route_severity_idx
  on public.route_restrictions (user_id, move_plan_id, route_plan_id, severity);

create table public.route_weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  route_plan_id uuid not null,
  source_name text not null default 'National Weather Service'
    check (char_length(source_name) between 1 and 160),
  status text not null
    check (status in ('available', 'partial', 'unavailable')),
  checked_at timestamptz not null,
  stale_after timestamptz not null,
  valid_until timestamptz,
  unavailable_reason text check (unavailable_reason is null or char_length(unavailable_reason) <= 1000),
  coverage_note text not null check (char_length(coverage_note) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (user_id, move_plan_id, route_plan_id, id),
  foreign key (user_id, move_plan_id, route_plan_id)
    references public.saved_route_plans (user_id, move_plan_id, id) on delete cascade,
  check (
    (status = 'unavailable' and unavailable_reason is not null)
    or status <> 'unavailable'
  )
);

create index route_weather_snapshots_route_idx
  on public.route_weather_snapshots (user_id, move_plan_id, route_plan_id, checked_at desc);
create index route_weather_snapshots_stale_idx
  on public.route_weather_snapshots (stale_after);

create table public.route_weather_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  route_plan_id uuid not null,
  weather_snapshot_id uuid not null,
  sample_order integer not null check (sample_order >= 0),
  route_distance_m bigint check (route_distance_m is null or route_distance_m >= 0),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  expected_arrival_at timestamptz not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  temperature_c numeric(6,2),
  precipitation_probability numeric(5,2)
    check (precipitation_probability is null or precipitation_probability between 0 and 100),
  sustained_wind_kph numeric(8,2)
    check (sustained_wind_kph is null or sustained_wind_kph >= 0),
  gust_wind_kph numeric(8,2)
    check (gust_wind_kph is null or gust_wind_kph >= 0),
  wind_direction_degrees numeric(6,2)
    check (wind_direction_degrees is null or wind_direction_degrees between 0 and 360),
  crosswind_severity text
    check (crosswind_severity is null or crosswind_severity in ('low', 'moderate', 'high', 'severe', 'unavailable')),
  visibility_m integer check (visibility_m is null or visibility_m >= 0),
  short_forecast text check (short_forecast is null or char_length(short_forecast) <= 1000),
  snow_or_ice_concern boolean,
  source_forecast_url text
    check (
      source_forecast_url is null
      or (
        char_length(source_forecast_url) <= 2048
        and source_forecast_url ~* '^https://'
      )
    ),
  issued_at timestamptz,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, move_plan_id, route_plan_id, weather_snapshot_id)
    references public.route_weather_snapshots (user_id, move_plan_id, route_plan_id, id) on delete cascade,
  unique (weather_snapshot_id, sample_order),
  check (valid_until > valid_from)
);

create index route_weather_points_route_order_idx
  on public.route_weather_points (user_id, move_plan_id, route_plan_id, weather_snapshot_id, sample_order);
create index route_weather_points_arrival_idx
  on public.route_weather_points (expected_arrival_at);

create table public.route_weather_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  move_plan_id uuid not null,
  route_plan_id uuid not null,
  weather_snapshot_id uuid not null,
  provider_alert_id text not null check (char_length(provider_alert_id) between 1 and 500),
  affected_segment_start integer check (affected_segment_start is null or affected_segment_start >= 0),
  affected_segment_end integer check (affected_segment_end is null or affected_segment_end >= 0),
  event_name text not null check (char_length(event_name) between 1 and 500),
  severity text not null
    check (severity in ('Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown')),
  urgency text not null
    check (urgency in ('Immediate', 'Expected', 'Future', 'Past', 'Unknown')),
  certainty text not null
    check (certainty in ('Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown')),
  headline text check (headline is null or char_length(headline) <= 2000),
  description text check (description is null or char_length(description) <= 50000),
  instruction text check (instruction is null or char_length(instruction) <= 50000),
  affected_area text check (affected_area is null or char_length(affected_area) <= 5000),
  sent_at timestamptz,
  effective_at timestamptz,
  onset_at timestamptz,
  expires_at timestamptz,
  ends_at timestamptz,
  expected_user_arrival_at timestamptz,
  official_url text not null
    check (char_length(official_url) <= 2048 and official_url ~* '^https://'),
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, move_plan_id, route_plan_id, weather_snapshot_id)
    references public.route_weather_snapshots (user_id, move_plan_id, route_plan_id, id) on delete cascade,
  unique (weather_snapshot_id, provider_alert_id)
);

comment on table public.route_weather_alerts is
  'Official alert facts are retained separately from any application recommendation or assistant text.';

create index route_weather_alerts_route_severity_idx
  on public.route_weather_alerts (user_id, move_plan_id, route_plan_id, severity, urgency);
create index route_weather_alerts_expiry_idx
  on public.route_weather_alerts (expires_at);

create table public.provider_cache (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null check (char_length(provider_name) between 1 and 100),
  operation_name text not null check (char_length(operation_name) between 1 and 120),
  cache_key_hash text not null check (cache_key_hash ~ '^[a-f0-9]{64}$'),
  cache_scope text not null default 'shared'
    check (cache_scope in ('shared', 'user')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  move_plan_id uuid,
  response_payload jsonb not null,
  response_schema_version integer not null default 1 check (response_schema_version > 0),
  source_issued_at timestamptz,
  retrieved_at timestamptz not null,
  expires_at timestamptz not null,
  stale_until timestamptz,
  etag text check (etag is null or char_length(etag) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_user_id, move_plan_id)
    references public.move_plans (user_id, id) on delete cascade,
  check (
    (cache_scope = 'shared' and owner_user_id is null and move_plan_id is null)
    or (cache_scope = 'user' and owner_user_id is not null)
  ),
  check (expires_at > retrieved_at),
  check (stale_until is null or stale_until >= expires_at)
);

comment on table public.provider_cache is
  'Service-only validated provider responses. Cache keys are hashes; credentials and sensitive request headers must never be cached.';

create unique index provider_cache_shared_key_idx
  on public.provider_cache (provider_name, operation_name, cache_key_hash)
  where cache_scope = 'shared';
create unique index provider_cache_user_key_idx
  on public.provider_cache (provider_name, operation_name, cache_key_hash, owner_user_id)
  where cache_scope = 'user';
create index provider_cache_expiry_idx
  on public.provider_cache (expires_at);
create index provider_cache_owner_idx
  on public.provider_cache (owner_user_id, move_plan_id)
  where owner_user_id is not null;

create trigger set_provider_cache_updated_at
before update on public.provider_cache
for each row execute function public.set_updated_at();

create table public.api_rate_limits (
  bucket_hash text not null check (bucket_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  request_count integer not null default 0 check (request_count >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (bucket_hash, window_start, window_seconds)
);

comment on table public.api_rate_limits is
  'Service-only fixed-window counters. Raw IP addresses and user identifiers are not stored; callers pass an application-scoped key which is hashed before storage.';

create index api_rate_limits_expiry_idx
  on public.api_rate_limits (expires_at);

create or replace function public.check_rate_limit(
  bucket_key text,
  max_requests integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window_start timestamptz;
  v_bucket_hash text;
  v_count integer;
begin
  if bucket_key is null or char_length(bucket_key) < 8 or char_length(bucket_key) > 1000 then
    raise exception 'invalid rate-limit bucket';
  end if;
  if max_requests is null or max_requests < 1 or max_requests > 100000 then
    raise exception 'invalid rate-limit maximum';
  end if;
  if window_seconds is null or window_seconds < 1 or window_seconds > 86400 then
    raise exception 'invalid rate-limit window';
  end if;

  v_bucket_hash := encode(
    extensions.digest(pg_catalog.convert_to(bucket_key, 'UTF8'), 'sha256'),
    'hex'
  );
  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / window_seconds) * window_seconds
  );

  insert into public.api_rate_limits (
    bucket_hash,
    window_start,
    window_seconds,
    request_count,
    expires_at,
    updated_at
  )
  values (
    v_bucket_hash,
    v_window_start,
    window_seconds,
    1,
    v_window_start + pg_catalog.make_interval(secs => window_seconds * 2),
    v_now
  )
  on conflict (bucket_hash, window_start, window_seconds)
  do update set
    request_count = public.api_rate_limits.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into v_count;

  delete from public.api_rate_limits
  where bucket_hash = v_bucket_hash
    and expires_at < v_now;

  return v_count <= max_requests;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer)
  to service_role;
