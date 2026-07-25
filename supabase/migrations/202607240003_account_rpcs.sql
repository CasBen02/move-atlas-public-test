-- Authenticated transaction helpers used by the Next.js server layer.
-- Every function resolves ownership from auth.uid(); callers cannot choose a
-- user_id. Legacy import accepts only the documented sanitized v1 shape and
-- deliberately ignores passwords, email labels, provider credentials, cached
-- "official" data, mock routes, and document contents.

create or replace function public.safe_import_date(input text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if input is null or input !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return input::date;
exception when others then
  return null;
end;
$$;

create or replace function public.safe_import_number(
  input text,
  minimum numeric,
  maximum numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  result numeric;
begin
  if input is null or input !~ '^-?[0-9]+([.][0-9]+)?$' then
    return null;
  end if;
  result := input::numeric;
  if result < minimum or result > maximum then
    return null;
  end if;
  return result;
exception when others then
  return null;
end;
$$;

create or replace function public.safe_import_text_array(
  input jsonb,
  maximum_items integer,
  maximum_characters integer
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array_agg(left(pg_catalog.btrim(item #>> '{}'), maximum_characters) order by ordinal),
    '{}'::text[]
  )
  from jsonb_array_elements(
    case when jsonb_typeof(input) = 'array' then input else '[]'::jsonb end
  ) with ordinality as elements(item, ordinal)
  where ordinal <= maximum_items
    and jsonb_typeof(item) = 'string'
    and pg_catalog.btrim(item #>> '{}') <> '';
$$;

revoke all on function public.safe_import_date(text)
  from public, anon, authenticated;
revoke all on function public.safe_import_number(text, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.safe_import_text_array(jsonb, integer, integer)
  from public, anon, authenticated;

create or replace function public.create_move_plan(
  plan_name text,
  initial jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_initial jsonb := coalesce(initial, '{}'::jsonb);
  v_origin jsonb;
  v_destination jsonb;
  v_household jsonb;
  v_setup jsonb;
  v_make_current boolean;
  v_move_date date;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if plan_name is null or char_length(pg_catalog.btrim(plan_name)) not between 1 and 120 then
    raise exception 'plan name must contain 1 to 120 characters';
  end if;
  if jsonb_typeof(v_initial) <> 'object' then
    raise exception 'initial must be a JSON object';
  end if;
  if pg_catalog.octet_length(pg_catalog.convert_to(v_initial::text, 'UTF8')) > 200000 then
    raise exception 'initial move data is too large';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  v_origin := case
    when jsonb_typeof(v_initial -> 'origin') = 'object'
      then v_initial -> 'origin'
    when nullif(pg_catalog.btrim(v_initial ->> 'origin'), '') is not null
      then jsonb_build_object('label', left(pg_catalog.btrim(v_initial ->> 'origin'), 1000))
    else '{}'::jsonb
  end;
  v_destination := case
    when jsonb_typeof(v_initial -> 'destination') = 'object'
      then v_initial -> 'destination'
    when nullif(pg_catalog.btrim(v_initial ->> 'destination'), '') is not null
      then jsonb_build_object('label', left(pg_catalog.btrim(v_initial ->> 'destination'), 1000))
    else '{}'::jsonb
  end;
  v_household := case
    when jsonb_typeof(v_initial -> 'householdSummary') = 'object'
      then v_initial -> 'householdSummary'
    when nullif(pg_catalog.btrim(v_initial ->> 'household'), '') is not null
      then jsonb_build_object('label', left(pg_catalog.btrim(v_initial ->> 'household'), 240))
    else '{}'::jsonb
  end;
  v_setup := case
    when jsonb_typeof(v_initial -> 'setupPreferences') = 'object'
      then v_initial -> 'setupPreferences'
    else '{}'::jsonb
  end;
  v_move_date := public.safe_import_date(
    coalesce(v_initial ->> 'moveDate', v_initial ->> 'date')
  );
  v_make_current := case
    when lower(coalesce(v_initial ->> 'makeCurrent', v_initial ->> 'isCurrent', '')) in ('true', 'false')
      then lower(coalesce(v_initial ->> 'makeCurrent', v_initial ->> 'isCurrent')) = 'true'
    else not exists (
      select 1
      from public.move_plans
      where user_id = v_user_id and is_current
    )
  end;

  if v_make_current then
    update public.move_plans
    set is_current = false
    where user_id = v_user_id and is_current;
  end if;

  insert into public.move_plans (
    user_id,
    name,
    status,
    is_current,
    move_date,
    origin,
    destination,
    household_summary
  )
  values (
    v_user_id,
    pg_catalog.btrim(plan_name),
    case
      when v_initial ->> 'status' in ('planning', 'scheduled', 'in_progress', 'settling_in', 'completed', 'archived')
        then v_initial ->> 'status'
      else 'planning'
    end,
    v_make_current,
    v_move_date,
    v_origin,
    v_destination,
    v_household
  )
  returning id into v_plan_id;

  if v_setup <> '{}'::jsonb then
    insert into public.setup_preferences (
      user_id,
      move_plan_id,
      move_reason,
      household_size,
      children_traveling,
      pets_traveling,
      desired_home_types,
      accessibility_needs,
      move_priorities,
      route_preferences,
      completed_at
    )
    values (
      v_user_id,
      v_plan_id,
      left(nullif(pg_catalog.btrim(v_setup ->> 'moveReason'), ''), 500),
      public.safe_import_number(v_setup ->> 'householdSize', 1, 50)::integer,
      case when lower(v_setup ->> 'childrenTraveling') in ('true', 'false')
        then lower(v_setup ->> 'childrenTraveling') = 'true' else null end,
      case when lower(v_setup ->> 'petsTraveling') in ('true', 'false')
        then lower(v_setup ->> 'petsTraveling') = 'true' else null end,
      public.safe_import_text_array(v_setup -> 'desiredHomeTypes', 30, 120),
      public.safe_import_text_array(v_setup -> 'accessibilityNeeds', 30, 240),
      case when jsonb_typeof(v_setup -> 'movePriorities') = 'object'
        then v_setup -> 'movePriorities' else '{}'::jsonb end,
      case when jsonb_typeof(v_setup -> 'routePreferences') = 'object'
        then v_setup -> 'routePreferences' else '{}'::jsonb end,
      case when lower(v_setup ->> 'completed') = 'true' then now() else null end
    );
  end if;

  return v_plan_id;
end;
$$;

revoke all on function public.create_move_plan(text, jsonb)
  from public, anon;
grant execute on function public.create_move_plan(text, jsonb)
  to authenticated;

create or replace function public.set_active_move_plan(plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  if plan_id is null or not exists (
    select 1
    from public.move_plans
    where id = plan_id and user_id = v_user_id
  ) then
    raise exception 'move plan not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.move_plans
    where id = plan_id and user_id = v_user_id and is_current
  ) then
    return;
  end if;

  update public.move_plans
  set is_current = false
  where user_id = v_user_id
    and is_current;

  update public.move_plans
  set is_current = true
  where user_id = v_user_id
    and id = plan_id;
end;
$$;

revoke all on function public.set_active_move_plan(uuid)
  from public, anon;
grant execute on function public.set_active_move_plan(uuid)
  to authenticated;

create or replace function public.delete_move_plan(plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_was_current boolean;
  v_replacement_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  delete from public.move_plans
  where id = plan_id
    and user_id = v_user_id
  returning is_current into v_was_current;

  if not found then
    raise exception 'move plan not found' using errcode = 'P0002';
  end if;

  if v_was_current then
    select id
    into v_replacement_id
    from public.move_plans
    where user_id = v_user_id
    order by updated_at desc, created_at desc
    limit 1;

    if v_replacement_id is not null then
      update public.move_plans
      set is_current = true
      where user_id = v_user_id
        and id = v_replacement_id;
    end if;
  end if;

  return v_replacement_id;
end;
$$;

revoke all on function public.delete_move_plan(uuid)
  from public, anon;
grant execute on function public.delete_move_plan(uuid)
  to authenticated;

create or replace function public.import_legacy_v1(
  sanitized_payload jsonb,
  payload_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(sanitized_payload, '{}'::jsonb);
  v_plans jsonb;
  v_plan jsonb;
  v_item jsonb;
  v_plan_id uuid;
  v_first_plan_id uuid;
  v_requested_current_id uuid;
  v_effective_current_id uuid;
  v_conversation_id uuid;
  v_route jsonb;
  v_vehicle jsonb;
  v_trailer jsonb;
  v_fuel jsonb;
  v_operations jsonb;
  v_existing public.local_data_imports%rowtype;
  v_plan_count integer := 0;
  v_task_count integer := 0;
  v_area_count integer := 0;
  v_property_count integer := 0;
  v_career_count integer := 0;
  v_budget_count integer := 0;
  v_box_count integer := 0;
  v_quote_count integer := 0;
  v_utility_count integer := 0;
  v_address_count integer := 0;
  v_document_count integer := 0;
  v_settling_count integer := 0;
  v_message_count integer := 0;
  v_route_profile_count integer := 0;
  v_counts jsonb;
  v_name text;
  v_amount numeric;
  v_home_type text;
  v_transaction_type text;
  v_status text;
  v_trailer_enabled boolean;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'sanitized_payload must be a JSON object';
  end if;
  if pg_catalog.octet_length(pg_catalog.convert_to(v_payload::text, 'UTF8')) > 2000000 then
    raise exception 'legacy import payload exceeds 2 MB';
  end if;
  if payload_fingerprint is null or payload_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'payload_fingerprint must be a lowercase SHA-256 hex digest';
  end if;

  select *
  into v_existing
  from public.local_data_imports
  where user_id = v_user_id
    and source_kind = 'legacy_local_storage';

  if found and v_existing.status = 'completed' then
    return jsonb_build_object(
      'alreadyImported', true,
      'importId', v_existing.id,
      'counts', v_existing.imported_counts,
      'completedAt', v_existing.completed_at
    );
  elsif found then
    delete from public.local_data_imports
    where id = v_existing.id and user_id = v_user_id;
  end if;

  insert into public.local_data_imports (
    user_id,
    source_kind,
    source_fingerprint,
    source_schema_version,
    status
  )
  values (
    v_user_id,
    'legacy_local_storage',
    payload_fingerprint,
    1,
    'pending'
  );

  if jsonb_typeof(v_payload -> 'plans') = 'array' then
    v_plans := v_payload -> 'plans';
  elsif jsonb_typeof(v_payload -> 'moveLibrary') = 'array' then
    select coalesce(
      jsonb_agg(
        case
          when jsonb_typeof(library_item -> 'move') = 'object' then
            (library_item -> 'move') || jsonb_build_object(
              'name',
              coalesce(
                nullif(pg_catalog.btrim(library_item ->> 'name'), ''),
                nullif(pg_catalog.btrim(library_item #>> '{move,destination}'), ''),
                'Imported move'
              ),
              'isCurrent',
              library_item ->> 'id' = v_payload ->> 'activeMoveId'
            )
          else library_item
        end
        order by ordinal
      ),
      '[]'::jsonb
    )
    into v_plans
    from jsonb_array_elements(v_payload -> 'moveLibrary')
      with ordinality as library(library_item, ordinal);
  elsif jsonb_typeof(v_payload #> '{account,moveLibrary}') = 'array' then
    select coalesce(
      jsonb_agg(
        case
          when jsonb_typeof(library_item -> 'move') = 'object' then
            (library_item -> 'move') || jsonb_build_object(
              'name',
              coalesce(
                nullif(pg_catalog.btrim(library_item ->> 'name'), ''),
                nullif(pg_catalog.btrim(library_item #>> '{move,destination}'), ''),
                'Imported move'
              ),
              'isCurrent',
              library_item ->> 'id' = v_payload #>> '{account,activeMoveId}'
            )
          else library_item
        end
        order by ordinal
      ),
      '[]'::jsonb
    )
    into v_plans
    from jsonb_array_elements(v_payload #> '{account,moveLibrary}')
      with ordinality as library(library_item, ordinal);
  elsif jsonb_typeof(v_payload -> 'move') = 'object' then
    v_plans := jsonb_build_array(v_payload -> 'move');
  elsif jsonb_typeof(v_payload #> '{account,move}') = 'object' then
    v_plans := jsonb_build_array(v_payload #> '{account,move}');
  else
    raise exception 'legacy import contains no plans';
  end if;

  if jsonb_array_length(v_plans) < 1 or jsonb_array_length(v_plans) > 25 then
    raise exception 'legacy import must contain between 1 and 25 plans';
  end if;

  if nullif(pg_catalog.btrim(coalesce(
    v_payload #>> '{profile,displayName}',
    v_payload #>> '{account,name}'
  )), '') is not null then
    update public.user_profiles
    set display_name = left(pg_catalog.btrim(coalesce(
      v_payload #>> '{profile,displayName}',
      v_payload #>> '{account,name}'
    )), 120)
    where user_id = v_user_id;
  end if;

  for v_plan in
    select value
    from jsonb_array_elements(v_plans) as plans(value)
  loop
    if jsonb_typeof(v_plan) <> 'object' then
      continue;
    end if;

    v_name := left(coalesce(
      nullif(pg_catalog.btrim(v_plan ->> 'name'), ''),
      nullif(pg_catalog.btrim(v_plan ->> 'destination'), ''),
      'Imported move'
    ), 120);

    v_plan_id := public.create_move_plan(
      v_name,
      v_plan || jsonb_build_object(
        'makeCurrent',
        false,
        'setupPreferences',
        coalesce(
          case when jsonb_typeof(v_plan -> 'setupPreferences') = 'object'
            then v_plan -> 'setupPreferences' end,
          jsonb_build_object(
            'desiredHomeTypes', coalesce(v_plan -> 'propertyTypes', '[]'::jsonb),
            'accessibilityNeeds',
              case
                when nullif(pg_catalog.btrim(v_plan ->> 'accessibility'), '') is not null
                  then jsonb_build_array(v_plan ->> 'accessibility')
                else '[]'::jsonb
              end,
            'petsTraveling', lower(coalesce(v_plan ->> 'pets', 'no pets')) <> 'no pets',
            'movePriorities',
              case when jsonb_typeof(v_plan -> 'rankWeights') = 'object'
                then v_plan -> 'rankWeights' else '{}'::jsonb end,
            'completed', lower(coalesce(v_plan ->> 'onboarded', 'false')) = 'true'
          )
        )
      )
    );
    v_plan_count := v_plan_count + 1;
    if v_first_plan_id is null then
      v_first_plan_id := v_plan_id;
    end if;
    if lower(coalesce(v_plan ->> 'isCurrent', 'false')) = 'true' then
      v_requested_current_id := v_plan_id;
    end if;

    for v_item in
      select value
      from jsonb_array_elements(
        case when jsonb_typeof(v_plan -> 'tasks') = 'array'
          then v_plan -> 'tasks' else '[]'::jsonb end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 1000
    loop
      v_name := left(nullif(pg_catalog.btrim(v_item ->> 'title'), ''), 240);
      if v_name is null then continue; end if;
      insert into public.tasks (
        user_id, move_plan_id, title, details, category, status,
        priority, source, completed_at, sort_order
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(nullif(pg_catalog.btrim(v_item ->> 'details'), ''), 10000),
        left(coalesce(nullif(pg_catalog.btrim(v_item ->> 'category'), ''), nullif(pg_catalog.btrim(v_item ->> 'area'), ''), 'general'), 80),
        case
          when lower(coalesce(v_item ->> 'done', 'false')) = 'true' then 'completed'
          when v_item ->> 'status' in ('not_started', 'in_progress', 'blocked', 'completed', 'skipped')
            then v_item ->> 'status'
          else 'not_started'
        end,
        case when v_item ->> 'priority' in ('low', 'medium', 'high', 'critical')
          then v_item ->> 'priority' else 'medium' end,
        'user',
        case when lower(coalesce(v_item ->> 'done', 'false')) = 'true' then now() else null end,
        v_task_count
      );
      v_task_count := v_task_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case when jsonb_typeof(v_plan -> 'areas') = 'array'
          then v_plan -> 'areas' else '[]'::jsonb end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 200
    loop
      v_name := left(nullif(pg_catalog.btrim(v_item ->> 'name'), ''), 500);
      if v_name is null then continue; end if;
      insert into public.areas (
        user_id, move_plan_id, search_query, display_name,
        personal_fit_rating, personal_notes, ranking_weights
      )
      values (
        v_user_id,
        v_plan_id,
        left(concat_ws(', ', v_name, nullif(pg_catalog.btrim(v_item ->> 'region'), '')), 500),
        left(concat_ws(', ', v_name, nullif(pg_catalog.btrim(v_item ->> 'region'), '')), 500),
        public.safe_import_number(v_item ->> 'personalFitRating', 1, 5)::smallint,
        left(nullif(pg_catalog.btrim(v_item ->> 'notes'), ''), 20000),
        case
          when jsonb_typeof(v_plan -> 'rankWeights') = 'object'
            then v_plan -> 'rankWeights'
          when jsonb_typeof(v_plan #> '{setupPreferences,movePriorities,weights}') = 'object'
            then v_plan #> '{setupPreferences,movePriorities,weights}'
          else '{}'::jsonb
        end
      );
      v_area_count := v_area_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'properties') = 'array' then v_plan -> 'properties'
          when jsonb_typeof(v_plan -> 'housing') = 'array' then v_plan -> 'housing'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 1000
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'label'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'name'), '')
      ), 240);
      if v_name is null then continue; end if;
      v_home_type := case lower(coalesce(v_item ->> 'homeType', v_item ->> 'propertyType', ''))
        when 'house' then 'house'
        when 'single-family' then 'house'
        when 'single-family home' then 'house'
        when 'apartment' then 'apartment'
        when 'garden apartment' then 'apartment'
        when 'condo' then 'condo'
        when 'townhome' then 'townhome'
        when 'townhouse' then 'townhome'
        when 'duplex' then 'duplex'
        when 'multifamily' then 'duplex'
        when 'duplex / multi-family' then 'duplex'
        when 'manufactured home' then 'manufactured_home'
        else 'other'
      end;
      v_transaction_type := case lower(coalesce(v_item ->> 'transactionType', v_item ->> 'intent', ''))
        when 'rent' then 'rent'
        when 'buy' then 'buy'
        when 'lease takeover' then 'lease_takeover'
        else 'unknown'
      end;
      v_status := case lower(coalesce(v_item ->> 'status', ''))
        when 'saved' then 'saved'
        when 'contacted' then 'contacted'
        when 'tour scheduled' then 'tour_scheduled'
        when 'applied' then 'applied'
        when 'applying' then 'applied'
        when 'offer made' then 'offer_made'
        when 'offer planned' then 'offer_made'
        when 'accepted' then 'accepted'
        when 'under contract' then 'accepted'
        when 'passed' then 'rejected'
        when 'rejected' then 'rejected'
        else 'saved'
      end;
      v_amount := public.safe_import_number(v_item ->> 'baseCost', 0, 1000000000);
      insert into public.properties (
        user_id, move_plan_id, label, address, home_type,
        transaction_type, status, asking_price_cents, monthly_cost_cents,
        bedrooms, bathrooms, notes, metadata
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(nullif(pg_catalog.btrim(v_item ->> 'address'), ''), 1000),
        v_home_type,
        v_transaction_type,
        v_status,
        case when v_transaction_type = 'buy' and v_amount is not null then round(v_amount * 100)::bigint else null end,
        case when v_transaction_type <> 'buy' and v_amount is not null then round(v_amount * 100)::bigint else null end,
        public.safe_import_number(v_item ->> 'beds', 0, 100),
        public.safe_import_number(v_item ->> 'baths', 0, 100),
        left(coalesce(
          nullif(pg_catalog.btrim(v_item ->> 'notes'), ''),
          nullif(pg_catalog.btrim(v_item ->> 'detail'), '')
        ), 20000),
        jsonb_build_object(
          'originalHomeType',
          left(nullif(pg_catalog.btrim(coalesce(
            v_item ->> 'homeType',
            v_item ->> 'propertyType'
          )), ''), 80),
          'originalIntent',
          left(nullif(pg_catalog.btrim(coalesce(
            v_item ->> 'transactionType',
            v_item ->> 'intent'
          )), ''), 40)
        )
      );
      v_property_count := v_property_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'careerOpportunities') = 'array' then v_plan -> 'careerOpportunities'
          when jsonb_typeof(v_plan -> 'career') = 'array' then v_plan -> 'career'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 1000
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'title'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'name'), '')
      ), 240);
      if v_name is null then continue; end if;
      insert into public.career_opportunities (
        user_id, move_plan_id, title, organization_name, location_label,
        opportunity_type, work_arrangement, status, source_name, source_url, notes
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(nullif(pg_catalog.btrim(v_item ->> 'organizationName'), ''), 240),
        left(nullif(pg_catalog.btrim(v_item ->> 'locationLabel'), ''), 500),
        case when v_item ->> 'opportunityType' in ('job', 'contract', 'business', 'education', 'other')
          then v_item ->> 'opportunityType' else 'job' end,
        case when v_item ->> 'workArrangement' in ('onsite', 'hybrid', 'remote', 'unknown')
          then v_item ->> 'workArrangement'
          when lower(coalesce(v_item ->> 'detail', '')) like '%hybrid%' then 'hybrid'
          when lower(coalesce(v_item ->> 'detail', '')) like '%remote%' then 'remote'
          else 'unknown'
        end,
        case
          when v_item ->> 'status' in ('saved', 'applied', 'interviewing', 'offer', 'accepted', 'declined', 'archived')
            then v_item ->> 'status'
          when lower(coalesce(v_item ->> 'detail', '')) like '%interview%' then 'interviewing'
          else 'saved'
        end,
        left(nullif(pg_catalog.btrim(v_item ->> 'sourceName'), ''), 120),
        case when v_item ->> 'sourceUrl' ~* '^https?://'
          then left(v_item ->> 'sourceUrl', 2048) else null end,
        left(coalesce(
          nullif(pg_catalog.btrim(v_item ->> 'notes'), ''),
          nullif(pg_catalog.btrim(v_item ->> 'detail'), '')
        ), 20000)
      );
      v_career_count := v_career_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'budgetItems') = 'array' then v_plan -> 'budgetItems'
          when jsonb_typeof(v_plan -> 'budget') = 'array' then v_plan -> 'budget'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 1000
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'name'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'label'), '')
      ), 240);
      if v_name is null then continue; end if;
      v_amount := public.safe_import_number(
        coalesce(v_item ->> 'plannedAmount', v_item ->> 'amount'),
        0,
        1000000000
      );
      insert into public.budget_items (
        user_id, move_plan_id, name, category, planned_amount_cents,
        actual_amount_cents, phase, reimbursable, status, notes
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(coalesce(nullif(pg_catalog.btrim(v_item ->> 'category'), ''), 'other'), 80),
        coalesce(round(v_amount * 100)::bigint, 0),
        coalesce(round(public.safe_import_number(v_item ->> 'actualAmount', 0, 1000000000) * 100)::bigint, 0),
        case lower(coalesce(v_item ->> 'phase', ''))
          when 'move' then 'moving'
          when 'moving' then 'moving'
          when 'arrival' then 'after_move'
          when 'after' then 'after_move'
          when 'after_move' then 'after_move'
          else 'before_move'
        end,
        lower(coalesce(v_item ->> 'reimbursable', 'false')) = 'true',
        case when v_item ->> 'status' in ('planned', 'quoted', 'committed', 'paid', 'refunded', 'canceled')
          then v_item ->> 'status' else 'planned' end,
        left(nullif(pg_catalog.btrim(v_item ->> 'notes'), ''), 10000)
      );
      v_budget_count := v_budget_count + 1;
    end loop;

    v_operations := case when jsonb_typeof(v_plan -> 'operations') = 'object'
      then v_plan -> 'operations' else '{}'::jsonb end;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'packingBoxes') = 'array' then v_plan -> 'packingBoxes'
          when jsonb_typeof(v_operations #> '{packing,boxes}') = 'array' then v_operations #> '{packing,boxes}'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 3000
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'label'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'number'), ''),
        'Imported box'
      ), 240);
      v_status := case lower(replace(coalesce(v_item ->> 'status', ''), '-', '_'))
        when 'packing' then 'packing'
        when 'packed' then 'packed'
        when 'loaded' then 'loaded'
        when 'unloaded' then 'unloaded'
        when 'unpacked' then 'unpacked'
        else 'planned'
      end;
      insert into public.packing_boxes (
        user_id, move_plan_id, label, box_code, room, destination_room, status,
        priority, contents, fragile, notes
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(nullif(pg_catalog.btrim(coalesce(v_item ->> 'boxCode', v_item ->> 'number')), ''), 80),
        left(nullif(pg_catalog.btrim(v_item ->> 'room'), ''), 120),
        left(nullif(pg_catalog.btrim(coalesce(v_item ->> 'destinationRoom', v_item ->> 'destination')), ''), 120),
        v_status,
        case lower(coalesce(v_item ->> 'priority', ''))
          when 'low' then 'low'
          when 'high' then 'high'
          when 'open first' then 'open_first'
          when 'open_first' then 'open_first'
          else 'normal'
        end,
        case
          when jsonb_typeof(v_item -> 'contents') = 'array'
            then public.safe_import_text_array(v_item -> 'contents', 250, 500)
          when nullif(pg_catalog.btrim(v_item ->> 'contents'), '') is not null
            then array[left(pg_catalog.btrim(v_item ->> 'contents'), 500)]
          else '{}'::text[]
        end,
        lower(coalesce(v_item ->> 'fragile', 'false')) = 'true',
        left(nullif(pg_catalog.btrim(v_item ->> 'notes'), ''), 10000)
      );
      v_box_count := v_box_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'moverQuotes') = 'array' then v_plan -> 'moverQuotes'
          when jsonb_typeof(v_operations -> 'movers') = 'array' then v_operations -> 'movers'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 500
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'providerName'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'company'), '')
      ), 240);
      if v_name is null then continue; end if;
      v_amount := public.safe_import_number(v_item ->> 'amount', 0, 1000000000);
      insert into public.mover_quotes (
        user_id, move_plan_id, provider_name, quote_amount_cents,
        deposit_amount_cents, estimate_type, status, services, contact_name,
        insurance_summary, cancellation_terms, availability_note,
        license_reference, notes
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        case when v_amount is null then null else round(v_amount * 100)::bigint end,
        case
          when public.safe_import_number(v_item ->> 'deposit', 0, 1000000000) is null then null
          else round(public.safe_import_number(v_item ->> 'deposit', 0, 1000000000) * 100)::bigint
        end,
        case
          when lower(coalesce(v_item ->> 'estimateType', v_item ->> 'estimate', '')) like 'binding not to exceed%' then 'binding_not_to_exceed'
          when lower(coalesce(v_item ->> 'estimateType', v_item ->> 'estimate', '')) like 'non-binding%' then 'non_binding'
          when lower(coalesce(v_item ->> 'estimateType', v_item ->> 'estimate', '')) like 'binding%' then 'binding'
          when lower(coalesce(v_item ->> 'estimateType', v_item ->> 'estimate', '')) like 'hourly%' then 'hourly'
          else 'unknown'
        end,
        case lower(coalesce(v_item ->> 'status', ''))
          when 'requested' then 'requested'
          when 'received' then 'received'
          when 'shortlist' then 'shortlisted'
          when 'shortlisted' then 'shortlisted'
          when 'accepted' then 'accepted'
          when 'declined' then 'declined'
          when 'expired' then 'expired'
          else 'researching'
        end,
        case
          when jsonb_typeof(v_item -> 'services') = 'array'
            then public.safe_import_text_array(v_item -> 'services', 50, 240)
          when nullif(pg_catalog.btrim(v_item ->> 'services'), '') is not null
            then array[left(pg_catalog.btrim(v_item ->> 'services'), 240)]
          else '{}'::text[]
        end,
        left(nullif(pg_catalog.btrim(v_item ->> 'contact'), ''), 240),
        left(nullif(pg_catalog.btrim(v_item ->> 'insurance'), ''), 2000),
        left(nullif(pg_catalog.btrim(v_item ->> 'cancellation'), ''), 5000),
        left(nullif(pg_catalog.btrim(v_item ->> 'availability'), ''), 1000),
        left(nullif(pg_catalog.btrim(v_item ->> 'license'), ''), 500),
        left(nullif(pg_catalog.btrim(v_item ->> 'notes'), ''), 20000)
      );
      v_quote_count := v_quote_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'utilities') = 'array' then v_plan -> 'utilities'
          when jsonb_typeof(v_operations -> 'utilities') = 'array' then v_operations -> 'utilities'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 250
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'providerName'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'name'), '')
      ), 240);
      if v_name is null then continue; end if;
      v_status := case lower(replace(coalesce(v_item ->> 'status', ''), '-', '_'))
        when 'researching' then 'researching'
        when 'scheduled' then 'scheduled'
        when 'active' then 'active'
        when 'confirmed' then 'active'
        when 'closed' then 'closed'
        when 'complete' then 'closed'
        when 'not_needed' then 'not_needed'
        when 'not_applicable' then 'not_needed'
        else 'not_started'
      end;
      insert into public.utilities (
        user_id, move_plan_id, utility_type, provider_name,
        start_service_on, stop_service_on, status, confirmation_note, notes
      )
      values (
        v_user_id,
        v_plan_id,
        case lower(coalesce(v_item ->> 'utilityType', v_item ->> 'name', ''))
          when 'electricity' then 'electricity'
          when 'gas' then 'gas'
          when 'water' then 'water'
          when 'sewer' then 'sewer'
          when 'internet' then 'internet'
          when 'mobile service' then 'mobile'
          when 'trash' then 'trash'
          when 'trash & recycling' then 'trash'
          when 'security system' then 'security'
          else 'other'
        end,
        v_name,
        public.safe_import_date(coalesce(v_item ->> 'startServiceOn', v_item ->> 'newDate')),
        public.safe_import_date(coalesce(v_item ->> 'stopServiceOn', v_item ->> 'oldDate')),
        v_status,
        left(nullif(pg_catalog.btrim(coalesce(v_item ->> 'confirmationNote', v_item ->> 'confirmation')), ''), 500),
        left(nullif(pg_catalog.btrim(v_item ->> 'notes'), ''), 10000)
      );
      v_utility_count := v_utility_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'addressChangeItems') = 'array' then v_plan -> 'addressChangeItems'
          when jsonb_typeof(v_operations -> 'address') = 'array' then v_operations -> 'address'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 500
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'organizationName'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'name'), '')
      ), 240);
      if v_name is null then continue; end if;
      insert into public.address_change_items (
        user_id, move_plan_id, organization_name, category, status,
        due_date, completed_at, confirmation_reference, notes
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(coalesce(nullif(pg_catalog.btrim(v_item ->> 'category'), ''), 'other'), 80),
        case lower(replace(coalesce(v_item ->> 'status', ''), '-', '_'))
          when 'in_progress' then 'in_progress'
          when 'submitted' then 'submitted'
          when 'confirmed' then 'confirmed'
          when 'complete' then 'confirmed'
          when 'not_needed' then 'not_needed'
          when 'not_applicable' then 'not_needed'
          else 'not_started'
        end,
        public.safe_import_date(coalesce(v_item ->> 'dueDate', v_item ->> 'due')),
        case when lower(coalesce(v_item ->> 'status', '')) in ('complete', 'confirmed') then now() else null end,
        left(nullif(pg_catalog.btrim(coalesce(
          v_item ->> 'confirmationReference',
          v_item ->> 'confirmation'
        )), ''), 120),
        left(nullif(pg_catalog.btrim(v_item ->> 'notes'), ''), 10000)
      );
      v_address_count := v_address_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'documentChecklistItems') = 'array' then v_plan -> 'documentChecklistItems'
          when jsonb_typeof(v_plan -> 'documentChecklist') = 'array' then v_plan -> 'documentChecklist'
          when jsonb_typeof(v_plan -> 'documents') = 'array' then v_plan -> 'documents'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 1000
    loop
      v_name := left(coalesce(
        nullif(pg_catalog.btrim(v_item ->> 'title'), ''),
        nullif(pg_catalog.btrim(v_item ->> 'name'), '')
      ), 240);
      if v_name is null then continue; end if;
      insert into public.document_checklist_items (
        user_id, move_plan_id, title, document_kind, need_level,
        timing_note, rationale, status,
        expires_on, reminder_on, issuer_name, notes
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(coalesce(
          nullif(pg_catalog.btrim(v_item ->> 'documentKind'), ''),
          nullif(pg_catalog.btrim(v_item ->> 'category'), ''),
          'other'
        ), 100),
        case lower(replace(coalesce(v_item ->> 'needLevel', v_item ->> 'need', ''), '-', '_'))
          when 'required' then 'required'
          when 'situation_dependent' then 'situation_dependent'
          when 'recommended' then 'recommended'
          when 'optional' then 'optional'
          else 'recommended'
        end,
        left(nullif(pg_catalog.btrim(coalesce(v_item ->> 'timingNote', v_item ->> 'when')), ''), 240),
        left(nullif(pg_catalog.btrim(coalesce(v_item ->> 'rationale', v_item ->> 'why')), ''), 5000),
        case lower(replace(coalesce(v_item ->> 'status', ''), ' ', '_'))
          when 'requested' then 'requested'
          when 'received' then 'received'
          when 'ready' then 'verified'
          when 'verified' then 'verified'
          when 'expired' then 'expired'
          when 'not_needed' then 'not_needed'
          else 'needed'
        end,
        public.safe_import_date(v_item ->> 'expiresOn'),
        public.safe_import_date(v_item ->> 'reminderOn'),
        left(nullif(pg_catalog.btrim(v_item ->> 'issuerName'), ''), 240),
        left(coalesce(
          nullif(pg_catalog.btrim(v_item ->> 'notes'), ''),
          nullif(pg_catalog.btrim(v_item ->> 'detail'), '')
        ), 10000)
      );
      v_document_count := v_document_count + 1;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_plan -> 'settlingTasks') = 'array' then v_plan -> 'settlingTasks'
          when jsonb_typeof(v_operations -> 'settling') = 'array' then v_operations -> 'settling'
          else '[]'::jsonb
        end
      ) with ordinality as items(value, ordinal)
      where ordinal <= 500
    loop
      v_name := left(nullif(pg_catalog.btrim(v_item ->> 'title'), ''), 240);
      if v_name is null then continue; end if;
      insert into public.settling_in_tasks (
        user_id, move_plan_id, title, details, phase, status,
        completed_at, sort_order
      )
      values (
        v_user_id,
        v_plan_id,
        v_name,
        left(nullif(pg_catalog.btrim(v_item ->> 'details'), ''), 10000),
        case lower(coalesce(v_item ->> 'phase', v_item ->> 'when', ''))
          when 'day 1' then 'arrival_day'
          when 'arrival_day' then 'arrival_day'
          when 'week 1' then 'first_week'
          when 'first_week' then 'first_week'
          when 'first 30 days' then 'first_month'
          when 'first_month' then 'first_month'
          when 'first 60 days' then 'first_60_days'
          when 'first_60_days' then 'first_60_days'
          else 'first_90_days'
        end,
        case when lower(coalesce(v_item ->> 'done', 'false')) = 'true'
          then 'completed' else 'not_started' end,
        case when lower(coalesce(v_item ->> 'done', 'false')) = 'true'
          then now() else null end,
        v_settling_count
      );
      v_settling_count := v_settling_count + 1;
    end loop;

    if jsonb_typeof(v_plan #> '{assistant,messages}') = 'array' then
      if jsonb_array_length(v_plan #> '{assistant,messages}') > 0 then
        insert into public.assistant_conversations (
          user_id, move_plan_id, title, assistant_mode
        )
        values (
          v_user_id, v_plan_id, 'Imported planning conversation', 'planning'
        )
        returning id into v_conversation_id;

        for v_item in
          select value
          from jsonb_array_elements(v_plan #> '{assistant,messages}')
            with ordinality as items(value, ordinal)
          where ordinal <= 500
        loop
          v_name := left(coalesce(
            nullif(pg_catalog.btrim(v_item ->> 'content'), ''),
            nullif(pg_catalog.btrim(v_item ->> 'text'), '')
          ), 20000);
          if v_name is null then continue; end if;
          insert into public.assistant_messages (
            user_id, move_plan_id, conversation_id, role, content
          )
          values (
            v_user_id,
            v_plan_id,
            v_conversation_id,
            case when v_item ->> 'role' = 'user' then 'user' else 'assistant' end,
            v_name
          );
          v_message_count := v_message_count + 1;
        end loop;
      end if;
    end if;

    v_route := case
      when jsonb_typeof(v_plan -> 'routeProfile') = 'object' then v_plan -> 'routeProfile'
      when jsonb_typeof(v_plan -> 'travel') = 'object' then v_plan -> 'travel'
      else '{}'::jsonb
    end;
    if v_route <> '{}'::jsonb then
      v_vehicle := case
        when jsonb_typeof(v_route -> 'vehicle') = 'object' then v_route -> 'vehicle'
        else v_route
      end;
      v_trailer := case
        when jsonb_typeof(v_vehicle -> 'trailer') = 'object' then v_vehicle -> 'trailer'
        else '{}'::jsonb
      end;
      v_fuel := case
        when jsonb_typeof(v_route -> 'fuel') = 'object' then v_route -> 'fuel'
        else v_route
      end;
      v_trailer_enabled :=
        lower(coalesce(v_trailer ->> 'enabled', 'false')) = 'true'
        and coalesce(
          public.safe_import_number(v_trailer ->> 'lengthM', 0.5, 40),
          public.safe_import_number(v_trailer ->> 'lengthFt', 1.65, 131.23) * 0.3048
        ) is not null;

      insert into public.route_profiles (
        user_id, move_plan_id, name, vehicle_category,
        vehicle_height_m, vehicle_length_m, gross_weight_kg,
        trailer_enabled, trailer_height_m, trailer_length_m, trailer_weight_kg,
        loaded_status, fuel_type, tank_or_battery_capacity, capacity_unit,
        efficiency_value, efficiency_unit, starting_capacity_percent,
        preferred_minimum_percent, clearance_buffer_m,
        avoidance_preferences, party_preferences, hotel_preferences
      )
      values (
        v_user_id,
        v_plan_id,
        left(coalesce(nullif(pg_catalog.btrim(v_route ->> 'name'), ''), 'Imported vehicle profile'), 160),
        case
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) in ('moving_truck_towing_vehicle', 'moving truck towing vehicle') then 'moving_truck_towing_vehicle'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) like '%moving truck%towing%' then 'moving_truck_towing_vehicle'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) in ('moving_truck', 'moving truck') then 'moving_truck'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) like '%moving truck%' then 'moving_truck'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) in ('cargo_van', 'cargo van') then 'cargo_van'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) like '%cargo van%' then 'cargo_van'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) like '%pickup%' then 'pickup'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) = 'suv' then 'suv'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) like '%recreational%' then 'rv'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) = 'rv' then 'rv'
          when lower(coalesce(v_vehicle ->> 'category', v_vehicle ->> 'vehicleCategory', v_vehicle ->> 'type', '')) like '%oversize%' then 'oversized_vehicle'
          when v_trailer_enabled then 'car_towing_trailer'
          else 'passenger_car'
        end,
        coalesce(
          public.safe_import_number(coalesce(v_vehicle ->> 'heightM', v_vehicle ->> 'vehicleHeightM'), 0.5, 10),
          public.safe_import_number(v_vehicle ->> 'heightIn', 19.69, 393.7) * 0.0254
        ),
        coalesce(
          public.safe_import_number(coalesce(v_vehicle ->> 'lengthM', v_vehicle ->> 'vehicleLengthM'), 1, 60),
          public.safe_import_number(v_vehicle ->> 'lengthFt', 3.28, 196.85) * 0.3048
        ),
        coalesce(
          public.safe_import_number(v_vehicle ->> 'grossWeightKg', 1, 200000),
          public.safe_import_number(v_vehicle ->> 'weightLb', 2.2, 440924) * 0.45359237
        ),
        v_trailer_enabled,
        case when v_trailer_enabled then coalesce(
          public.safe_import_number(v_trailer ->> 'heightM', 0.2, 10),
          public.safe_import_number(v_trailer ->> 'heightIn', 7.87, 393.7) * 0.0254
        ) else null end,
        case when v_trailer_enabled then coalesce(
          public.safe_import_number(v_trailer ->> 'lengthM', 0.5, 40),
          public.safe_import_number(v_trailer ->> 'lengthFt', 1.65, 131.23) * 0.3048
        ) else null end,
        case when v_trailer_enabled then coalesce(
          public.safe_import_number(v_trailer ->> 'weightKg', 0, 100000),
          public.safe_import_number(v_trailer ->> 'weightLb', 0, 220462) * 0.45359237
        ) else null end,
        case lower(coalesce(v_vehicle ->> 'loadedStatus', v_vehicle ->> 'load', ''))
          when 'unloaded' then 'unloaded'
          when 'empty' then 'unloaded'
          when 'lightly loaded' then 'lightly_loaded'
          when 'lightly_loaded' then 'lightly_loaded'
          when 'loaded' then 'loaded'
          else 'unknown'
        end,
        case lower(coalesce(v_fuel ->> 'type', ''))
          when 'diesel' then 'diesel'
          when 'mid-grade gasoline' then 'midgrade_gasoline'
          when 'midgrade gasoline' then 'midgrade_gasoline'
          when 'premium gasoline' then 'premium_gasoline'
          when 'electric' then 'electric'
          when 'ev' then 'electric'
          else 'regular_gasoline'
        end,
        public.safe_import_number(coalesce(v_fuel ->> 'capacity', v_fuel ->> 'tankCapacity'), 0.01, 10000),
        case when lower(coalesce(v_fuel ->> 'type', '')) in ('electric', 'ev')
          then 'kwh' else 'us_gallon' end,
        public.safe_import_number(coalesce(v_fuel ->> 'efficiencyValue', v_fuel ->> 'efficiency'), 0.01, 10000),
        case when lower(coalesce(v_fuel ->> 'type', '')) in ('electric', 'ev')
          then 'kwh_per_100km' else 'mpg_us' end,
        public.safe_import_number(coalesce(v_fuel ->> 'startingCapacityPercent', v_fuel ->> 'startingPercent'), 0, 100),
        public.safe_import_number(coalesce(v_fuel ->> 'preferredMinimumPercent', v_fuel ->> 'reservePercent'), 0, 100),
        coalesce(
          public.safe_import_number(v_route ->> 'clearanceBufferM', 0, 3),
          public.safe_import_number(v_route ->> 'clearanceBufferIn', 0, 118.11) * 0.0254,
          0.152
        ),
        case when jsonb_typeof(v_route -> 'avoidancePreferences') = 'object'
          then v_route -> 'avoidancePreferences'
          else jsonb_build_object(
            'avoidText', left(coalesce(v_route ->> 'avoidText', ''), 1000),
            'weights', case when jsonb_typeof(v_route -> 'weights') = 'object'
              then v_route -> 'weights' else '{}'::jsonb end
          )
        end,
        case when jsonb_typeof(v_route -> 'partyPreferences') = 'object'
          then v_route -> 'partyPreferences'
          when jsonb_typeof(v_route -> 'party') = 'object'
            then v_route -> 'party'
          else '{}'::jsonb
        end,
        case when jsonb_typeof(v_route -> 'hotelPreferences') = 'object'
          then v_route -> 'hotelPreferences'
          when jsonb_typeof(v_route -> 'lodging') = 'object'
            then v_route -> 'lodging'
          else '{}'::jsonb
        end
      );
      v_route_profile_count := v_route_profile_count + 1;
    end if;
  end loop;

  if v_requested_current_id is not null then
    perform public.set_active_move_plan(v_requested_current_id);
  elsif not exists (
    select 1 from public.move_plans where user_id = v_user_id and is_current
  ) then
    perform public.set_active_move_plan(v_first_plan_id);
  end if;

  select id
  into v_effective_current_id
  from public.move_plans
  where user_id = v_user_id and is_current
  limit 1;

  v_counts := jsonb_build_object(
    'movePlans', v_plan_count,
    'tasks', v_task_count,
    'areas', v_area_count,
    'properties', v_property_count,
    'careerOpportunities', v_career_count,
    'budgetItems', v_budget_count,
    'packingBoxes', v_box_count,
    'moverQuotes', v_quote_count,
    'utilities', v_utility_count,
    'addressChangeItems', v_address_count,
    'documentChecklistItems', v_document_count,
    'settlingTasks', v_settling_count,
    'assistantMessages', v_message_count,
    'routeProfiles', v_route_profile_count
  );

  update public.local_data_imports
  set
    status = 'completed',
    imported_counts = v_counts,
    completed_at = now(),
    failure_code = null
  where user_id = v_user_id
    and source_kind = 'legacy_local_storage';

  return jsonb_build_object(
    'alreadyImported', false,
    'counts', v_counts,
    'activeMovePlanId', v_effective_current_id
  );
end;
$$;

revoke all on function public.import_legacy_v1(jsonb, text)
  from public, anon;
grant execute on function public.import_legacy_v1(jsonb, text)
  to authenticated;
