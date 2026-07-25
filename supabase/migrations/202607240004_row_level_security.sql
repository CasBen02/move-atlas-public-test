-- Row-level security and least-privilege grants.
-- FORCE ROW LEVEL SECURITY is used on every application table. The Supabase
-- service role retains BYPASSRLS for protected server integrations.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_profiles',
    'move_plans',
    'setup_preferences',
    'tasks',
    'areas',
    'properties',
    'career_opportunities',
    'budget_items',
    'packing_boxes',
    'mover_quotes',
    'utilities',
    'address_change_items',
    'document_checklist_items',
    'settling_in_tasks',
    'assistant_conversations',
    'assistant_messages',
    'local_data_imports',
    'curated_templates',
    'area_snapshots',
    'area_metrics',
    'route_profiles',
    'saved_route_plans',
    'route_stops',
    'route_restrictions',
    'route_weather_snapshots',
    'route_weather_points',
    'route_weather_alerts',
    'provider_cache',
    'api_rate_limits'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

grant select, update on table public.user_profiles to authenticated;

create policy "profile owner can read"
on public.user_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profile owner can update"
on public.user_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'move_plans',
    'setup_preferences',
    'tasks',
    'areas',
    'properties',
    'career_opportunities',
    'budget_items',
    'packing_boxes',
    'mover_quotes',
    'utilities',
    'address_change_items',
    'document_checklist_items',
    'settling_in_tasks',
    'assistant_conversations',
    'route_profiles'
  ]
  loop
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      table_name
    );
    execute format(
      'create policy "owner can read" on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "owner can insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "owner can update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy "owner can delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end;
$$;

-- Move-plan creation, activation, and deletion use transaction-safe RPCs.
-- Browser sessions may edit ordinary plan details, but cannot bypass those
-- invariants by writing is_current or creating/deleting rows directly.
revoke insert, update, delete on table public.move_plans from authenticated;
grant update (
  name,
  status,
  move_date,
  origin,
  destination,
  household_summary
) on table public.move_plans to authenticated;
drop policy "owner can insert" on public.move_plans;
drop policy "owner can delete" on public.move_plans;

grant select, insert, delete on table public.assistant_messages to authenticated;

create policy "message owner can read"
on public.assistant_messages
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "message owner can add user messages"
on public.assistant_messages
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and role = 'user'
);

create policy "message owner can delete"
on public.assistant_messages
for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select on table public.local_data_imports to authenticated;

create policy "import owner can read receipt"
on public.local_data_imports
for select
to authenticated
using ((select auth.uid()) = user_id);

grant select on table public.curated_templates to anon, authenticated;

create policy "published templates are public"
on public.curated_templates
for select
to anon, authenticated
using (is_published);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'area_snapshots',
    'area_metrics',
    'saved_route_plans',
    'route_stops',
    'route_restrictions',
    'route_weather_snapshots',
    'route_weather_points',
    'route_weather_alerts'
  ]
  loop
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format(
      'create policy "owner can read derived data" on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end;
$$;

grant delete on table public.saved_route_plans to authenticated;

create policy "owner can delete saved route"
on public.saved_route_plans
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- provider_cache and api_rate_limits intentionally have no client policies or
-- client grants. They are available only to protected server code using the
-- service role.
