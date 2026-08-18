-- Decision Report scientific-contract hardening.
--
-- Multi-metric activations keep one causal outcome. Supporting bindings gain
-- optional monitoring context, metric selection exposes measurement readiness,
-- and a completed multi-action plan is measured as one decision package whose
-- intervention date is the latest effective date across its included actions.

alter table public.decision_report_activation_action_metrics
  add column monitoring_expected_direction text check (
    monitoring_expected_direction is null
    or monitoring_expected_direction in ('INCREASE', 'DECREASE')
  ),
  add column monitoring_check_date date;

create function private.populate_decision_report_monitoring_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract_version smallint;
  v_primary_source_item_id text;
  v_action jsonb;
  v_direction text;
  v_check_date text;
begin
  select activation.contract_version, activation.primary_lever_source_id
  into v_contract_version, v_primary_source_item_id
  from public.decision_report_activations as activation
  where activation.activation_id = new.activation_id
    and activation.scope_id = new.scope_id;
  if not found then
    raise exception 'Activation audit is unavailable.' using errcode = '55000';
  end if;

  -- The registered primary action owns the one prospective causal prediction.
  -- Monitoring context is supporting-plan metadata only.
  if new.action_source_item_id = v_primary_source_item_id then
    new.monitoring_expected_direction := null;
    new.monitoring_check_date := null;
    return new;
  end if;

  select report_action.value into v_action
  from public.decision_report_activations as activation
  join public.decision_report_revisions as revision
    on revision.revision_id = activation.revision_id
   and revision.report_id = activation.report_id
   and revision.scope_id = activation.scope_id
  cross join lateral pg_catalog.jsonb_array_elements(
    coalesce(revision.snapshot #> '{implementation,actions}', '[]'::jsonb)
  ) as report_action(value)
  where activation.activation_id = new.activation_id
    and activation.scope_id = new.scope_id
    and report_action.value->>'sourceItemId' = new.action_source_item_id;

  if not found then
    if coalesce(v_contract_version, 1) = 2 then
      raise exception 'Monitoring context source action is unavailable.' using errcode = '55000';
    end if;
    return new;
  end if;

  v_direction := nullif(pg_catalog.btrim(coalesce(
    v_action->>'monitoringExpectedDirection',
    ''
  )), '');
  if v_direction is not null and v_direction not in ('INCREASE', 'DECREASE') then
    raise exception 'Monitoring direction is invalid.' using errcode = '22023';
  end if;

  v_check_date := nullif(pg_catalog.btrim(coalesce(
    v_action->>'monitoringCheckDate',
    ''
  )), '');
  if v_check_date is not null then
    begin
      new.monitoring_check_date := v_check_date::date;
    exception when others then
      raise exception 'Monitoring check date is invalid.' using errcode = '22023';
    end;
  end if;
  new.monitoring_expected_direction := v_direction;
  return new;
end;
$$;

create trigger decision_report_action_metrics_monitoring_context
before insert on public.decision_report_activation_action_metrics
for each row execute function private.populate_decision_report_monitoring_context();

revoke all on function private.populate_decision_report_monitoring_context()
  from public, anon, authenticated, service_role;

create function private.try_decision_report_date(p_value text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

revoke all on function private.try_decision_report_date(text)
  from public, anon, authenticated, service_role;

create function private.try_decision_report_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.btrim(p_value) = '' then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

revoke all on function private.try_decision_report_timestamptz(text)
  from public, anon, authenticated, service_role;

-- Existing rows are immutable activation audit. Backfill only values that can
-- be proven from their exact immutable revision snapshot.
with monitoring as (
  select
    binding.activation_id,
    binding.action_id,
    case
      when binding.action_source_item_id <> activation.primary_lever_source_id
       and report_action.value->>'monitoringExpectedDirection' in ('INCREASE', 'DECREASE')
        then report_action.value->>'monitoringExpectedDirection'
      else null
    end as expected_direction,
    case
      when binding.action_source_item_id <> activation.primary_lever_source_id
        then private.try_decision_report_date(
          report_action.value->>'monitoringCheckDate'
        )
      else null
    end as check_date
  from public.decision_report_activation_action_metrics as binding
  join public.decision_report_activations as activation
    on activation.activation_id = binding.activation_id
   and activation.scope_id = binding.scope_id
  join public.decision_report_revisions as revision
    on revision.revision_id = activation.revision_id
   and revision.report_id = activation.report_id
   and revision.scope_id = activation.scope_id
  cross join lateral pg_catalog.jsonb_array_elements(
    coalesce(revision.snapshot #> '{implementation,actions}', '[]'::jsonb)
  ) as report_action(value)
  where report_action.value->>'sourceItemId' = binding.action_source_item_id
)
update public.decision_report_activation_action_metrics as binding
set monitoring_expected_direction = monitoring.expected_direction,
    monitoring_check_date = monitoring.check_date
from monitoring
where monitoring.activation_id = binding.activation_id
  and monitoring.action_id = binding.action_id;

-- Readiness is descriptive and does not block prospective activation. Forty-five
-- observations on each side remains the current confident ITS floor.
create function public.list_decision_report_activation_metrics_v2(
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
      when metric.unit = 'percent'
       and observation.observation_count > 0
       and observation.ratio_percent then 'ratio'
      else 'points'
    end
  from public.metrics as metric
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
      end as history_days,
      coalesce(bool_and(abs(value) <= 1) filter (where value is not null), false)
        as ratio_percent
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

create function private.decision_report_package_hash(
  p_activation_id uuid,
  p_report_id uuid,
  p_decision_id uuid,
  p_metric_id uuid,
  p_registered_primary_action_id uuid,
  p_intervention_action_id uuid,
  p_intervention_date date,
  p_included_action_ids uuid[]
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'causalObject', 'decision_package',
          'interventionRule', 'latest_effective_included_action',
          'activationId', p_activation_id,
          'reportId', p_report_id,
          'decisionId', p_decision_id,
          'metricId', p_metric_id,
          'registeredPrimaryActionId', p_registered_primary_action_id,
          'interventionActionId', p_intervention_action_id,
          'interventionDate', p_intervention_date,
          'includedActionIds', pg_catalog.to_jsonb(p_included_action_ids)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function private.decision_report_package_hash(
  uuid, uuid, uuid, uuid, uuid, uuid, date, uuid[]
) from public, anon, authenticated, service_role;

-- The package becomes effective on the latest actual implementation date,
-- independent of the order in which completion RPCs were recorded. When two
-- actions share that date, the later action in the immutable report plan wins.
create function private.resolve_decision_report_package_intervention(
  p_scope_id uuid,
  p_included_action_ids uuid[]
)
returns table (
  intervention_action_id uuid,
  intervention_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select included.action_id, action.effective_date
  from pg_catalog.unnest(p_included_action_ids)
    with ordinality as included(action_id, plan_ordinality)
  join public.actions as action
    on action.action_id = included.action_id
   and action.scope_id = p_scope_id
  where action.effective_date is not null
  order by action.effective_date desc, included.plan_ordinality desc
  limit 1;
$$;

revoke all on function private.resolve_decision_report_package_intervention(uuid, uuid[])
  from public, anon, authenticated, service_role;

create table public.decision_report_package_interventions (
  activation_id uuid primary key,
  scope_id uuid not null,
  report_id uuid not null,
  decision_id uuid not null,
  metric_id uuid not null,
  causal_object text not null default 'decision_package' check (
    causal_object = 'decision_package'
  ),
  intervention_rule text not null default 'latest_effective_included_action' check (
    intervention_rule = 'latest_effective_included_action'
  ),
  registered_primary_action_id uuid not null,
  intervention_action_id uuid not null,
  intervention_date date not null,
  included_action_ids uuid[] not null check (
    cardinality(included_action_ids) between 1 and 25
    and registered_primary_action_id = any(included_action_ids)
    and intervention_action_id = any(included_action_ids)
  ),
  package_hash text not null check (
    package_hash ~ '^[0-9a-f]{64}$'
    and package_hash = private.decision_report_package_hash(
      activation_id,
      report_id,
      decision_id,
      metric_id,
      registered_primary_action_id,
      intervention_action_id,
      intervention_date,
      included_action_ids
    )
  ),
  completed_at timestamptz not null default now(),
  foreign key (activation_id, scope_id)
    references public.decision_report_activations(activation_id, scope_id)
    on delete cascade,
  foreign key (activation_id, registered_primary_action_id)
    references public.decision_report_activation_action_metrics(activation_id, action_id)
    on delete no action deferrable initially deferred,
  foreign key (activation_id, intervention_action_id)
    references public.decision_report_activation_action_metrics(activation_id, action_id)
    on delete no action deferrable initially deferred
);

create index decision_report_package_interventions_scope_report_idx
  on public.decision_report_package_interventions(scope_id, report_id, activation_id);

create function private.assert_decision_report_package_intervention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation public.decision_report_activations%rowtype;
  v_included_action_count integer;
  v_incomplete_action_count integer;
  v_expected_intervention_action_id uuid;
  v_expected_intervention_date date;
begin
  select activation.* into v_activation
  from public.decision_report_activations as activation
  where activation.activation_id = new.activation_id
    and activation.scope_id = new.scope_id;
  if not found
     or v_activation.contract_version <> 2
     or new.report_id is distinct from v_activation.report_id
     or new.decision_id is distinct from v_activation.decision_id
     or new.metric_id is distinct from v_activation.metric_id
     or new.registered_primary_action_id is distinct from v_activation.primary_lever_action_id
     or new.included_action_ids is distinct from v_activation.action_ids then
    raise exception 'Decision package intervention does not match its immutable activation.'
      using errcode = '55000';
  end if;

  select
    count(*)::integer,
    count(*) filter (where action.effective_date is null)::integer
  into v_included_action_count, v_incomplete_action_count
  from public.actions as action
  where action.scope_id = new.scope_id
    and action.action_id = any(new.included_action_ids);
  if v_included_action_count <> cardinality(new.included_action_ids)
     or v_incomplete_action_count <> 0 then
    raise exception 'A decision package cannot be measured before every included action is complete.'
      using errcode = '55000';
  end if;

  select resolved.intervention_action_id, resolved.intervention_date
  into v_expected_intervention_action_id, v_expected_intervention_date
  from private.resolve_decision_report_package_intervention(
    new.scope_id,
    new.included_action_ids
  ) as resolved;
  if not found
     or new.intervention_action_id is distinct from v_expected_intervention_action_id
     or new.intervention_date is distinct from v_expected_intervention_date then
    raise exception 'Decision package intervention does not match the latest effective action.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger decision_report_package_interventions_assert_contract
before insert on public.decision_report_package_interventions
for each row execute function private.assert_decision_report_package_intervention();

revoke all on function private.assert_decision_report_package_intervention()
  from public, anon, authenticated, service_role;

alter table public.decision_report_package_interventions enable row level security;

create policy decision_report_package_interventions_select
  on public.decision_report_package_interventions
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

revoke all on public.decision_report_package_interventions
  from public, anon, authenticated, service_role;
grant select on public.decision_report_package_interventions
  to authenticated, service_role;

-- A migration-time backfill is possible only when every immutable included
-- action already has a completion date. The intervention uses the latest
-- effective date with immutable plan order as its deterministic tie-break;
-- completed_at separately records the latest available completion receipt.
insert into public.decision_report_package_interventions (
  activation_id,
  scope_id,
  report_id,
  decision_id,
  metric_id,
  registered_primary_action_id,
  intervention_action_id,
  intervention_date,
  included_action_ids,
  package_hash,
  completed_at
)
select
  activation.activation_id,
  activation.scope_id,
  activation.report_id,
  activation.decision_id,
  activation.metric_id,
  activation.primary_lever_action_id,
  final_action.intervention_action_id,
  final_action.intervention_date,
  activation.action_ids,
  private.decision_report_package_hash(
    activation.activation_id,
    activation.report_id,
    activation.decision_id,
    activation.metric_id,
    activation.primary_lever_action_id,
    final_action.intervention_action_id,
    final_action.intervention_date,
    activation.action_ids
  ),
  package_completion.completed_at
from public.decision_report_activations as activation
cross join lateral (
  select resolved.intervention_action_id, resolved.intervention_date
  from private.resolve_decision_report_package_intervention(
    activation.scope_id,
    activation.action_ids
  ) as resolved
) as final_action
cross join lateral (
  select max(coalesce(
    private.try_decision_report_timestamptz(
      action.rationale_richtext #>> '{meta,manual_completion,recorded_at}'
    ),
    action.ship_ts,
    action.effective_date::timestamp at time zone 'UTC',
    activation.activated_at
  )) as completed_at
  from public.actions as action
  where action.scope_id = activation.scope_id
    and action.action_id = any(activation.action_ids)
    and action.effective_date is not null
) as package_completion
where activation.contract_version = 2
  and activation.primary_lever_action_id is not null
  and not exists (
    select 1
    from public.actions as action
    where action.scope_id = activation.scope_id
      and action.action_id = any(activation.action_ids)
      and action.effective_date is null
  );

alter table private.decision_report_completion_transitions
  add column lever_action_id uuid,
  add constraint decision_report_completion_transition_lever_action_check check (
    lever_required = (lever_action_id is not null)
  );

create or replace function private.guard_decision_report_primary_lever_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation_id uuid;
begin
  select activation.activation_id into v_activation_id
  from public.decision_report_activations as activation
  where (
    activation.scope_id = old.scope_id
    and activation.primary_lever_action_id = old.action_id
    and old.provenance_token =
      'decision-report:' || activation.activation_id::text || ':primary'
  ) or (
    activation.scope_id = new.scope_id
    and activation.primary_lever_action_id = new.action_id
    and new.provenance_token =
      'decision-report:' || activation.activation_id::text || ':primary'
  )
  limit 1;

  if found then
    update private.decision_report_completion_transitions as transition
    set lever_consumed = true
    where transition.transaction_id = pg_catalog.pg_current_xact_id()
      and transition.scope_id = old.scope_id
      and transition.scope_id = new.scope_id
      and transition.activation_id = v_activation_id
      and transition.lever_action_id = old.action_id
      and transition.lever_action_id = new.action_id
      and transition.lever_required
      and not transition.lever_consumed;
    if not found then
      raise exception 'Decision Report levers are application-managed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.enqueue_current_causal_recompute(
  p_scope_id uuid,
  p_metric_id uuid,
  p_reason text,
  p_requested_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if p_scope_id is null or p_metric_id is null or v_reason = ''
     or pg_catalog.length(v_reason) > 80 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'A valid causal recompute target is required.' using errcode = '22023';
  end if;

  select
    activation.activation_id,
    activation.scope_id,
    activation.report_id,
    activation.metric_id,
    coalesce(p_requested_by, activation.activated_by) as requested_by
  into v_target
  from public.workspaces as workspace
  join public.decision_report_series as series
    on series.series_id = workspace.current_decision_report_series_id
   and series.scope_id = workspace.workspace_id
  join public.decision_reports as report
    on report.report_id = series.current_active_report_id
   and report.series_id = series.series_id
   and report.scope_id = workspace.workspace_id
  join public.decision_report_activations as activation
    on activation.activation_id = report.active_activation_id
   and activation.report_id = report.report_id
   and activation.scope_id = report.scope_id
   and activation.metric_id = report.active_metric_id
  left join public.decision_report_package_interventions as package
    on package.activation_id = activation.activation_id
   and package.scope_id = activation.scope_id
  where workspace.workspace_id = p_scope_id
    and report.deleted_at is null
    and report.status = 'active'
    and report.active_metric_id = p_metric_id
    and (activation.contract_version = 1 or package.activation_id is not null);

  -- Multi-action v2 plans have no causal breakpoint until every included action
  -- is complete. Observation writes before that point intentionally enqueue no work.
  if not found then
    return;
  end if;

  insert into private.causal_recompute_jobs (
    activation_id,
    scope_id,
    report_id,
    metric_id,
    requested_by,
    reasons
  ) values (
    v_target.activation_id,
    v_target.scope_id,
    v_target.report_id,
    v_target.metric_id,
    v_target.requested_by,
    array[v_reason]
  )
  on conflict (activation_id) do update
  set requested_generation = causal_recompute_jobs.requested_generation + 1,
      requested_by = coalesce(excluded.requested_by, causal_recompute_jobs.requested_by),
      reasons = (
        select pg_catalog.array_agg(distinct reason order by reason)
        from pg_catalog.unnest(causal_recompute_jobs.reasons || excluded.reasons) as reason
      ),
      requested_at = pg_catalog.now(),
      next_attempt_at = least(causal_recompute_jobs.next_attempt_at, pg_catalog.now()),
      attempts = 0,
      last_error_code = null;
end;
$$;

create or replace function public.complete_manual_action_v1(
  p_scope_id uuid,
  p_action_id uuid,
  p_completed_on date,
  p_explanation text,
  p_authored_by uuid
)
returns table (
  completed_action_id uuid,
  completed_on date,
  explanation text,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.actions%rowtype;
  v_activation public.decision_report_activations%rowtype;
  v_explanation text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_explanation, ''), '\s+', ' ', 'g'));
  v_existing_explanation text;
  v_is_package boolean;
  v_package_will_complete boolean := false;
  v_lever_required boolean;
  v_completed_at timestamptz := pg_catalog.clock_timestamp();
  v_package_hash text;
  v_intervention_action_id uuid;
  v_intervention_date date;
begin
  if p_scope_id is null or p_action_id is null or p_completed_on is null then
    raise exception 'Choose an action and completion date.' using errcode = '22023';
  end if;
  if p_completed_on > current_date then
    raise exception 'The completion date cannot be in the future.' using errcode = '22023';
  end if;
  if v_explanation = '' or pg_catalog.length(v_explanation) > 1000 or v_explanation ~ '[[:cntrl:]]' then
    raise exception 'Enter a completion explanation between 1 and 1000 characters.' using errcode = '22023';
  end if;

  perform 1
  from public.workspaces
  where workspaces.workspace_id = p_scope_id
  for update;
  if not found then
    raise exception 'The workspace is unavailable.' using errcode = '42501';
  end if;
  perform private.assert_decision_report_write(p_scope_id, p_authored_by);

  select activation.* into v_activation
  from public.workspaces as workspace
  join public.decision_report_series as series
    on series.series_id = workspace.current_decision_report_series_id
   and series.scope_id = workspace.workspace_id
  join public.decision_reports as report
    on report.report_id = series.current_active_report_id
   and report.series_id = series.series_id
   and report.scope_id = workspace.workspace_id
  join public.decision_report_activations as activation
    on activation.activation_id = report.active_activation_id
   and activation.report_id = report.report_id
   and activation.scope_id = report.scope_id
  where workspace.workspace_id = p_scope_id
    and report.deleted_at is null
    and report.status = 'active'
    and p_action_id = any(activation.action_ids)
  for update of activation;
  if not found then
    raise exception 'The action is unavailable in this workspace.' using errcode = '42501';
  end if;

  perform action.action_id
  from public.actions as action
  where action.scope_id = p_scope_id
    and action.action_id = any(v_activation.action_ids)
  order by action.action_id
  for update;

  select action.* into v_action
  from public.actions as action
  where action.action_id = p_action_id
    and action.scope_id = p_scope_id;
  if not found then
    raise exception 'The action is unavailable in this workspace.' using errcode = '42501';
  end if;
  if v_action.source <> 'manual'
     or coalesce(v_action.rationale_richtext #>> '{meta,source}', '') <> 'decision_report' then
    raise exception 'Only planned Decision Report actions can be completed manually.' using errcode = '22023';
  end if;

  v_existing_explanation := v_action.rationale_richtext #>> '{meta,manual_completion,explanation}';
  if v_action.effective_date is not null then
    if v_action.effective_date = p_completed_on
       and v_existing_explanation = v_explanation then
      return query select p_action_id, p_completed_on, v_explanation, true;
      return;
    end if;
    raise exception 'This action is already complete.' using errcode = '22023';
  end if;

  v_is_package := v_activation.contract_version = 2;
  if v_is_package then
    v_package_will_complete := not exists (
      select 1
      from public.actions as action
      where action.scope_id = p_scope_id
        and action.action_id = any(v_activation.action_ids)
        and action.action_id <> p_action_id
        and action.effective_date is null
    );
  end if;
  v_lever_required := case
    when v_is_package then v_package_will_complete
    else coalesce(v_activation.primary_lever_action_id = p_action_id, false)
  end;

  if v_lever_required then
    perform 1
    from public.levers as lever
    where lever.action_id = v_activation.primary_lever_action_id
      and lever.scope_id = p_scope_id
      and lever.decision_id = v_activation.decision_id
      and lever.metric_id = v_activation.metric_id
      and lever.target_source = 'manual'
      and lever.provenance_token =
        'decision-report:' || v_activation.activation_id::text || ':primary'
    for update;
    if not found then
      raise exception 'The action completion state is inconsistent.' using errcode = '55000';
    end if;
  end if;

  insert into private.decision_report_completion_transitions (
    transaction_id,
    scope_id,
    activation_id,
    action_id,
    lever_required,
    lever_action_id
  ) values (
    pg_catalog.pg_current_xact_id(),
    p_scope_id,
    v_activation.activation_id,
    p_action_id,
    v_lever_required,
    case when v_lever_required then v_activation.primary_lever_action_id else null end
  );

  update public.actions as action
  set effective_date = p_completed_on,
      ship_ts = (p_completed_on::timestamp at time zone 'UTC'),
      status = 'complete',
      rationale_richtext = coalesce(action.rationale_richtext, '{"type":"doc","content":[],"meta":{}}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'meta',
          coalesce(action.rationale_richtext->'meta', '{}'::jsonb)
            || pg_catalog.jsonb_build_object(
              'manual_completion', pg_catalog.jsonb_build_object(
                'completed_on', p_completed_on,
                'explanation', v_explanation,
                'completed_by', p_authored_by,
                'recorded_at', v_completed_at
              )
            )
        )
  where action.action_id = p_action_id
    and action.scope_id = p_scope_id;

  if v_is_package and v_package_will_complete then
    select resolved.intervention_action_id, resolved.intervention_date
    into v_intervention_action_id, v_intervention_date
    from private.resolve_decision_report_package_intervention(
      p_scope_id,
      v_activation.action_ids
    ) as resolved;
    if not found then
      raise exception 'The completed decision package has no intervention action.'
        using errcode = '55000';
    end if;

    v_package_hash := private.decision_report_package_hash(
      v_activation.activation_id,
      v_activation.report_id,
      v_activation.decision_id,
      v_activation.metric_id,
      v_activation.primary_lever_action_id,
      v_intervention_action_id,
      v_intervention_date,
      v_activation.action_ids
    );
    insert into public.decision_report_package_interventions (
      activation_id,
      scope_id,
      report_id,
      decision_id,
      metric_id,
      registered_primary_action_id,
      intervention_action_id,
      intervention_date,
      included_action_ids,
      package_hash,
      completed_at
    ) values (
      v_activation.activation_id,
      p_scope_id,
      v_activation.report_id,
      v_activation.decision_id,
      v_activation.metric_id,
      v_activation.primary_lever_action_id,
      v_intervention_action_id,
      v_intervention_date,
      v_activation.action_ids,
      v_package_hash,
      v_completed_at
    );
  end if;

  if v_lever_required then
    update public.levers as lever
    set status = 'SHIPPED',
        detected_at = coalesce(lever.detected_at, v_completed_at)
    where lever.action_id = v_activation.primary_lever_action_id
      and lever.scope_id = p_scope_id
      and lever.decision_id = v_activation.decision_id
      and lever.metric_id = v_activation.metric_id
      and lever.target_source = 'manual'
      and lever.provenance_token =
        'decision-report:' || v_activation.activation_id::text || ':primary';
  end if;

  delete from private.decision_report_completion_transitions as transition
  where transition.transaction_id = pg_catalog.pg_current_xact_id()
    and transition.scope_id = p_scope_id
    and transition.activation_id = v_activation.activation_id
    and transition.action_id = p_action_id
    and transition.action_consumed
    and (not transition.lever_required or transition.lever_consumed);
  if not found then
    raise exception 'The action completion state is inconsistent.' using errcode = '55000';
  end if;

  if not v_is_package or v_package_will_complete then
    perform private.enqueue_current_causal_recompute(
      p_scope_id,
      v_activation.metric_id,
      case when v_is_package then 'decision_package_completed' else 'manual_action_completed' end,
      p_authored_by
    );
  end if;

  return query select p_action_id, p_completed_on, v_explanation, false;
end;
$$;

revoke all on function public.complete_manual_action_v1(uuid, uuid, date, text, uuid)
  from public, anon;
grant execute on function public.complete_manual_action_v1(uuid, uuid, date, text, uuid)
  to authenticated, service_role;

-- Queue completed packages discovered by the backfill after the new readiness
-- guard is in place. The private queue remains current-pointer bound.
do $$
declare
  v_package record;
begin
  for v_package in
    select scope_id, metric_id
    from public.decision_report_package_interventions
  loop
    perform private.enqueue_current_causal_recompute(
      v_package.scope_id,
      v_package.metric_id,
      'decision_package_backfilled',
      null
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
