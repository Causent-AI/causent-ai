-- T05–T10: explicit measurement contracts and customer workspace lifecycle.
-- Existing evaluations and source identities remain intact. No demo data or
-- customer membership is added by this migration.
begin;

alter table public.workspaces add column archived_at timestamptz;

-- Archival retains authorized history reads but pauses ordinary workspace writes.
-- Restoring an archive is an explicit operator action, not data restoration.
create or replace function public.has_scope_access(target_scope uuid, min_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select public.has_scope_grant(p.org_id, w.project_id, w.workspace_id, min_role)
      and (w.archived_at is null or min_role = 'viewer')
    from public.workspaces w join public.projects p on p.project_id = w.project_id
    where w.workspace_id = target_scope
  ), false);
$$;

create table private.customer_provisioning_requests (
  request_id uuid primary key,
  owner_id uuid not null,
  organization_name text not null,
  project_name text not null,
  workspace_name text not null,
  organization_id uuid not null references public.orgs(org_id),
  project_id uuid not null references public.projects(project_id),
  workspace_id uuid not null references public.workspaces(workspace_id),
  created_at timestamptz not null default now()
);
revoke all on private.customer_provisioning_requests from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert on private.customer_provisioning_requests to service_role;

create function public.provision_customer_workspace_v1(
  p_request_id uuid, p_owner uuid, p_organization text, p_project text, p_workspace text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  prior private.customer_provisioning_requests;
  organization_uuid uuid;
  project_uuid uuid;
  workspace_uuid uuid;
begin
  if p_request_id is null or p_owner is null or p_organization is null or
     p_project is null or p_workspace is null or
     length(trim(p_organization)) not between 1 and 120 or
     length(trim(p_project)) not between 1 and 120 or
     length(trim(p_workspace)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Owner, request identity and names are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into prior from private.customer_provisioning_requests where request_id = p_request_id;
  if found then
    if (prior.owner_id, prior.organization_name, prior.project_name, prior.workspace_name)
       is distinct from (p_owner, trim(p_organization), trim(p_project), trim(p_workspace)) then
      raise exception using errcode = '23505', message = 'Provisioning request conflicts with its original inputs';
    end if;
    return prior.workspace_id;
  end if;
  -- The existing user FK on memberships validates the owner atomically. This
  -- operation does not create credentials, invite anyone or copy demo grants.
  insert into public.orgs(name) values(trim(p_organization)) returning org_id into organization_uuid;
  insert into public.projects(org_id, name) values(organization_uuid, trim(p_project))
    returning project_id into project_uuid;
  insert into public.workspaces(project_id, name) values(project_uuid, trim(p_workspace))
    returning workspace_id into workspace_uuid;
  insert into public.memberships(user_id, org_id, role) values(p_owner, organization_uuid, 'owner');
  insert into private.customer_provisioning_requests(
    request_id, owner_id, organization_name, project_name, workspace_name,
    organization_id, project_id, workspace_id
  ) values(p_request_id, p_owner, trim(p_organization), trim(p_project), trim(p_workspace),
    organization_uuid, project_uuid, workspace_uuid);
  return workspace_uuid;
end;
$$;
revoke all on function public.provision_customer_workspace_v1(uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.provision_customer_workspace_v1(uuid,uuid,text,text,text) to service_role;

create function public.set_customer_workspace_archived_v1(p_scope_id uuid, p_archived boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_scope_id is null or p_archived is null then
    raise exception using errcode = '22023', message = 'Workspace and archive state are required';
  end if;
  update public.workspaces set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
    where workspace_id = p_scope_id;
  if not found then
    raise exception using errcode = '22023', message = 'Workspace is unavailable';
  end if;
end;
$$;
revoke all on function public.set_customer_workspace_archived_v1(uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_customer_workspace_archived_v1(uuid,boolean) to service_role;

-- A metric identity has one immutable semantic definition. Corrections use a
-- new metric identity, so already committed predictions keep their definition.
create table public.metric_definitions (
  definition_id uuid primary key default gen_random_uuid(),
  definition_version integer not null default 1 check (definition_version = 1),
  metric_id uuid not null unique references public.metrics(metric_id) on delete cascade,
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  unit text not null check (unit in ('count', 'percent', 'USD')),
  numeric_scale text not null check (numeric_scale in ('native', 'ratio', 'points')),
  beneficial_direction text not null check (beneficial_direction in ('higher', 'lower', 'neutral')),
  aggregation text not null check (aggregation in ('sum', 'mean', 'rate', 'snapshot')),
  denominator text not null check (length(trim(denominator)) between 1 and 500),
  timezone text not null default 'UTC' check (timezone = 'UTC'),
  granularity text not null default 'daily' check (granularity = 'daily'),
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (definition_id, metric_id, scope_id),
  check ((unit = 'percent' and numeric_scale in ('ratio', 'points'))
    or (unit <> 'percent' and numeric_scale = 'native'))
);
alter table public.metric_definitions enable row level security;
revoke all on public.metric_definitions from public, anon, authenticated;
grant select, insert on public.metric_definitions to authenticated, service_role;
create index metric_definitions_scope_idx on public.metric_definitions(scope_id);
create index metric_definitions_actor_idx on public.metric_definitions(confirmed_by);
create policy metric_definitions_read on public.metric_definitions for select to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));
create policy metric_definitions_write on public.metric_definitions for insert to authenticated
  with check (public.has_scope_access(scope_id, 'member') and confirmed_by = (select auth.uid()));

create function private.reject_measurement_contract_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Preserve the existing authorized parent-cleanup contract. Ordinary direct
  -- updates/deletes remain forbidden; this is not a production cleanup path.
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then return old; end if;
  raise exception using errcode = '55000', message = 'Immutable measurement contract: create a new version';
end;
$$;
create trigger metric_definition_immutable before update or delete on public.metric_definitions
  for each row execute function private.reject_measurement_contract_update();

create function private.validate_metric_definition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.metrics m where m.metric_id = new.metric_id and m.scope_id = new.scope_id
      and m.unit = new.unit and m.tz = new.timezone and m.granularity = new.granularity
  ) then
    raise exception using errcode = '22023', message = 'Definition must match its metric, workspace and daily UTC cadence';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger validate_metric_definition before insert on public.metric_definitions
  for each row execute function private.validate_metric_definition();

create function private.protect_metric_semantics() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.unit, new.tz, new.granularity, new.scope_id) is distinct from
     (old.unit, old.tz, old.granularity, old.scope_id)
     and exists (select 1 from public.metric_definitions where metric_id = old.metric_id) then
    raise exception using errcode = '55000', message = 'Create a new metric version to change its definition';
  end if;
  return new;
end;
$$;
create trigger protect_metric_semantics before update on public.metrics
  for each row execute function private.protect_metric_semantics();

create function public.begin_workspace_metric_csv_import_v3(
  p_scope_id uuid, p_name text, p_unit text, p_content_hash text, p_total_rows integer,
  p_start_date date, p_end_date date, p_authored_by uuid, p_numeric_scale text,
  p_beneficial_direction text, p_aggregation text, p_denominator text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare receipt record; definition public.metric_definitions;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') and
     (auth.uid() is null or p_authored_by is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'Authenticated metric author required';
  end if;
  select * into receipt from public.begin_workspace_metric_csv_import_v2(
    p_scope_id, p_name, p_unit, p_content_hash, p_total_rows, p_start_date, p_end_date, p_authored_by
  );
  insert into public.metric_definitions(
    metric_id, scope_id, unit, numeric_scale, beneficial_direction, aggregation, denominator, confirmed_by
  ) values(receipt.metric_id, p_scope_id, p_unit, p_numeric_scale, p_beneficial_direction,
    p_aggregation, trim(p_denominator), p_authored_by) on conflict (metric_id) do nothing;
  select * into definition from public.metric_definitions where metric_id = receipt.metric_id;
  if (definition.unit, definition.numeric_scale, definition.beneficial_direction,
      definition.aggregation, definition.denominator) is distinct from
     (p_unit, p_numeric_scale, p_beneficial_direction, p_aggregation, trim(p_denominator)) then
    raise exception using errcode = '22023', message = 'Definition differs from this metric. Create a new metric version with a distinct name.';
  end if;
  return jsonb_build_array(to_jsonb(receipt));
end;
$$;
revoke all on function public.begin_workspace_metric_csv_import_v3(uuid,text,text,text,integer,date,date,uuid,text,text,text,text)
  from public, anon;
grant execute on function public.begin_workspace_metric_csv_import_v3(uuid,text,text,text,integer,date,date,uuid,text,text,text,text)
  to authenticated, service_role;

create or replace function public.list_decision_report_activation_metrics_v2(
  p_scope_id uuid
)
returns table (
  metric_id uuid,
  name text,
  source text,
  unit text,
  is_core boolean,
  has_observations boolean,
  last_observation_date date,
  last_observation_value double precision,
  pre_history_observation_count integer,
  pre_history_days integer,
  readiness text,
  earliest_confident_review_date date,
  percent_scale text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jwt_role text := coalesce((select auth.jwt()->>'role'), '');
begin
  if p_scope_id is null then
    raise exception 'Workspace not found or unavailable.' using errcode = '42501';
  end if;
  if v_jwt_role <> 'service_role' and (
    auth.uid() is null
    or not public.has_scope_access(p_scope_id, 'viewer')
  ) then
    raise exception 'Workspace not found or unavailable.' using errcode = '42501';
  end if;

  return query
  select
    metric.metric_id,
    metric.name,
    metric.source,
    metric.unit,
    metric.is_core,
    observation.observation_count > 0,
    observation.last_date,
    observation.last_value,
    observation.observation_count,
    observation.history_days,
    case
      when definition.definition_id is null then 'Confirm metric definition'
      when observation.observation_count = 0 then 'Needs data'
      when observation.observation_count < 45 or observation.history_days < 45
        then 'Causal window not ready'
      else 'Ready to monitor'
    end,
    (
      current_date + 45 + greatest(
        0,
        45 - observation.observation_count,
        45 - observation.history_days
      )
    ),
    case
      when metric.unit <> 'percent' then 'points'
      when definition.numeric_scale = 'ratio' then 'ratio'
      when definition.numeric_scale = 'points' then 'points'
      else 'unknown'
    end
  from public.metrics as metric
  left join public.metric_definitions definition on definition.metric_id = metric.metric_id
  cross join lateral (
    select
      count(value)::integer as observation_count,
      max(obs_date) filter (where value is not null) as last_date,
      (pg_catalog.array_agg(value::double precision order by obs_date desc)
        filter (where value is not null))[1] as last_value,
      case
        when count(value) = 0 then 0
        else (
          max(obs_date) filter (where value is not null)
          - min(obs_date) filter (where value is not null)
          + 1
        )::integer
      end as history_days
    from public.metric_observations as observation
    where observation.metric_id = metric.metric_id
  ) as observation
  where metric.scope_id = p_scope_id
    and metric.granularity = 'daily'
  order by pg_catalog.lower(metric.name), metric.metric_id;
end;
$$;

revoke all on function public.list_decision_report_activation_metrics_v2(uuid)
  from public, anon;
grant execute on function public.list_decision_report_activation_metrics_v2(uuid)
  to authenticated, service_role;


-- Bounded release: one fixed, explicitly registered primary outcome per immutable
-- activation. There is no PR fishing family and no adaptive repeated-look claim.
create table public.measurement_plans (
  plan_id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  activation_id uuid not null unique references public.decision_report_activations(activation_id) on delete cascade,
  metric_id uuid not null references public.metrics(metric_id) on delete cascade,
  definition_id uuid not null,
  design text not null check(design='observational_its'),
  estimand text not null check(estimand='immediate_level_change'),
  family_version text not null default 'registered-primary-v1' check(family_version='registered-primary-v1'),
  exposure_start date not null,
  exposure_end date not null,
  lag_days integer not null check(lag_days between 0 and 30),
  window_start date not null,
  window_end date not null,
  exposure_source text not null check(length(exposure_source) between 5 and 1000),
  population text not null check(length(population) between 3 and 500),
  concurrent_changes text not null check(length(concurrent_changes) between 3 and 2000),
  concurrent_change_status text not null check(concurrent_change_status in ('none_known','present','unknown')),
  decision_threshold numeric not null check(decision_threshold > 0 and decision_threshold::text not in ('NaN','Infinity','-Infinity')),
  registered_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key(definition_id,metric_id,scope_id) references public.metric_definitions(definition_id,metric_id,scope_id) on delete cascade,
  check(exposure_end >= exposure_start),
  check(window_start < exposure_start and window_end > exposure_end + lag_days),
  check(exposure_start-window_start between 45 and 180),
  check(window_end-(exposure_end+lag_days) between 44 and 179)
);
alter table public.measurement_plans enable row level security;
revoke all on public.measurement_plans from public,anon,authenticated,service_role;
grant select,insert on public.measurement_plans to authenticated, service_role;
create policy measurement_plan_read on public.measurement_plans for select to authenticated using(public.has_scope_access(scope_id,'viewer'));
create policy measurement_plan_write on public.measurement_plans for insert to authenticated
with check(public.has_scope_access(scope_id,'member') and registered_by=auth.uid() and exists(
select 1 from public.decision_report_activations a where a.activation_id=measurement_plans.activation_id and a.scope_id=measurement_plans.scope_id and a.metric_id=measurement_plans.metric_id));
create trigger measurement_plan_immutable before update or delete on public.measurement_plans for each row execute function private.reject_measurement_contract_update();
-- Prospectivity is enforced, not inferred from a checkbox. Retrospective datasets
-- can retain legacy history but cannot masquerade as a registered family.
create function private.validate_measurement_plan() returns trigger language plpgsql set search_path='' as $$
begin
  if new.exposure_start <= current_date or exists(
    select 1 from public.metric_observations where metric_id=new.metric_id and obs_date>=new.exposure_start
  ) then
    raise exception using errcode='22023',message='Register before first exposure and before observing post-exposure data';
  end if;
  if not exists (
    select 1 from public.decision_report_activations a
    join public.decision_reports r on r.active_activation_id=a.activation_id and r.report_id=a.report_id
    join public.decision_report_series s on s.series_id=r.series_id and s.current_active_report_id=r.report_id
    join public.workspaces w on w.current_decision_report_series_id=s.series_id and w.workspace_id=a.scope_id
    where a.activation_id=new.activation_id and a.scope_id=new.scope_id and a.metric_id=new.metric_id
      and a.primary_lever_action_id=any(a.action_ids) and w.archived_at is null
      and r.status='active' and r.deleted_at is null
  ) then
    raise exception using errcode='22023',message='A current activation with a registered primary outcome is required';
  end if;
  new.created_at:=now();
  return new;
end $$;
create trigger measurement_plan_prospective before insert on public.measurement_plans for each row execute function private.validate_measurement_plan();

create table public.measurement_exposures (
  plan_id uuid not null references public.measurement_plans(plan_id) on delete cascade,
  action_id uuid not null references public.actions(action_id) on delete cascade,
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  first_exposure date not null,
  fully_exposed date not null check(fully_exposed >= first_exposure),
  source text not null check(length(source) between 5 and 1000),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  primary key(plan_id,action_id)
);
alter table public.measurement_exposures enable row level security;
revoke all on public.measurement_exposures from public,anon,authenticated,service_role;
grant select,insert on public.measurement_exposures to authenticated, service_role;
create policy exposure_read on public.measurement_exposures for select to authenticated using(public.has_scope_access(scope_id,'viewer'));
create policy exposure_write on public.measurement_exposures for insert to authenticated with check(
 public.has_scope_access(scope_id,'member') and recorded_by=auth.uid() and fully_exposed<=current_date and exists(
 select 1 from public.measurement_plans p join public.decision_report_activations a on a.activation_id=p.activation_id
 where p.plan_id=measurement_exposures.plan_id and p.scope_id=measurement_exposures.scope_id
 and measurement_exposures.action_id=any(a.action_ids)));
create trigger exposure_immutable before update or delete on public.measurement_exposures for each row execute function private.reject_measurement_contract_update();


create function private.validate_measurement_exposure() returns trigger language plpgsql set search_path='' as $$
begin
  if new.fully_exposed > current_date or not exists (
    select 1 from public.measurement_plans p join public.decision_report_activations a using(activation_id)
    where p.plan_id=new.plan_id and p.scope_id=new.scope_id and new.action_id=any(a.action_ids)
  ) then
    raise exception using errcode='22023',message='Exposure must reference an included action and an observed date';
  end if;
  new.recorded_at:=now();
  return new;
end $$;
create trigger exposure_validate before insert on public.measurement_exposures for each row execute function private.validate_measurement_exposure();
create index measurement_plans_scope_idx on public.measurement_plans(scope_id);
create index measurement_plans_metric_idx on public.measurement_plans(metric_id);
create index measurement_plans_definition_idx on public.measurement_plans(definition_id,metric_id,scope_id);
create index measurement_plans_actor_idx on public.measurement_plans(registered_by);
create index measurement_exposures_scope_idx on public.measurement_exposures(scope_id);
create index measurement_exposures_action_idx on public.measurement_exposures(action_id);
create index measurement_exposures_actor_idx on public.measurement_exposures(recorded_by);
create function private.enqueue_measurement_contract() returns trigger
language plpgsql security definer set search_path='' as $$
declare metric_uuid uuid;
begin
 if tg_table_name='measurement_exposures' then
  select metric_id into metric_uuid from public.measurement_plans where plan_id=new.plan_id;
 else metric_uuid:=new.metric_id; end if;
 perform private.enqueue_current_causal_recompute(new.scope_id,metric_uuid,'measurement_contract',auth.uid());
 return new;
end $$;
create trigger plan_enqueue after insert on public.measurement_plans for each row execute function private.enqueue_measurement_contract();
create trigger exposure_enqueue after insert on public.measurement_exposures for each row execute function private.enqueue_measurement_contract();


-- Statistical confidence and causal identification are independent. Old runs
-- retain their original bytes and receive a conservative legacy classification.
alter table public.evaluation_runs add column interpretation text not null default 'legacy_unverified'
  check(interpretation in ('legacy_unverified','observational','cannot_attribute','waiting'));
alter table public.evaluation_runs add column refusal_reason text;

create or replace view public.current_edge_readouts with (security_invoker = true) as
select e.edge_id, e.scope_id, s.semantic_ref as action_id, t.semantic_ref as metric_id,
  r.evaluation_id, r.input_hash, r.model_version,
  case when i.evidence_id is not null then 'computed'
       when e.evaluation_id is not null then 'incomplete'
       when e.authoritative_method = 'MANUAL' then 'manual' else 'legacy_unverified' end as provenance,
  coalesce(i.result_direction, 'INCONCLUSIVE') as direction,
  i.result_belief as belief_score, i.result_reason as belief_reason,
  i.lift, i.ci_low, i.ci_high, i.n_pre, i.n_post,
  d.lift as descriptive_lift, d.ci_low as descriptive_ci_low, d.ci_high as descriptive_ci_high,
  d.n_pre as descriptive_n_pre, d.n_post as descriptive_n_post, coalesce(d.clustered, false) as descriptive_clustered,
  coalesce(r.interpretation,'legacy_unverified') as interpretation, r.refusal_reason
from public.causal_edges e
-- Keep identity lookups parameterized even before a fresh import is analyzed.
-- LIMIT 1 is exact because node_id is unique; it prevents a quadratic RLS join.
join lateral (
  select semantic_ref from public.nodes where node_id = e.source_node_id
    and scope_id = e.scope_id and type = 'ACTION' limit 1
) s on true
join lateral (
  select semantic_ref from public.nodes where node_id = e.target_node_id
    and scope_id = e.scope_id and type = 'METRIC' limit 1
) t on true
left join public.evaluation_runs r on r.evaluation_id = e.evaluation_id and r.scope_id = e.scope_id and r.metric_id = t.semantic_ref
left join lateral (
  select i.* from public.evidence_objects i where i.edge_id = e.edge_id and i.scope_id = e.scope_id
    and i.evaluation_id = r.evaluation_id and i.methodology = 'ITS'
  order by i.created_at desc, i.evidence_id desc limit 1
) i on true
left join lateral (
  select d.* from public.evidence_objects d where d.edge_id = e.edge_id and d.scope_id = e.scope_id
    and d.evaluation_id = r.evaluation_id and d.methodology = 'BEFORE_AFTER_14D'
  order by d.created_at desc, d.evidence_id desc limit 1
) d on i.evidence_id is not null;
grant select on public.current_edge_readouts to authenticated, service_role;

-- Service-role connector ingestion also respects archive state. Membership RLS
-- alone cannot protect these calls because service_role intentionally bypasses it.
create function private.reject_archived_measurement_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_scope uuid;
begin
  if tg_table_name='metric_observations' then
    select scope_id into target_scope from public.metrics where metric_id=new.metric_id;
  else target_scope:=new.scope_id;
  end if;
  if exists(select 1 from public.workspaces where workspace_id=target_scope and archived_at is not null) then
    raise exception using errcode='55000',message='Workspace is archived; restore it before writing new data';
  end if;
  return new;
end $$;
revoke all on function private.reject_archived_measurement_write() from public,anon,authenticated,service_role;
create trigger archive_actions before insert or update on public.actions for each row execute function private.reject_archived_measurement_write();
create trigger archive_metrics before insert or update on public.metrics for each row execute function private.reject_archived_measurement_write();
create trigger archive_observations before insert or update on public.metric_observations for each row execute function private.reject_archived_measurement_write();
create trigger archive_levers before insert or update on public.levers for each row execute function private.reject_archived_measurement_write();
create trigger archive_definitions before insert on public.metric_definitions for each row execute function private.reject_archived_measurement_write();
create trigger archive_plans before insert on public.measurement_plans for each row execute function private.reject_archived_measurement_write();
create trigger archive_exposures before insert on public.measurement_exposures for each row execute function private.reject_archived_measurement_write();

commit;
