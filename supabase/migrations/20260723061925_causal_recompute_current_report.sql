-- Slice 10 continuation: current-report causal recomputation.
--
-- The queue is deliberately private and coalesces work per immutable activation.
-- Public writes only reach it through checked report RPCs or observation triggers;
-- the stateful worker resolves the workspace pointer again before doing any work.

alter table public.decision_report_activations
  add column primary_lever_source_id text,
  add column primary_lever_action_id uuid
    references public.actions(action_id) on delete restrict,
  add constraint decision_report_activations_primary_lever_check check (
    (primary_lever_source_id is null and primary_lever_action_id is null)
    or
    (
      btrim(primary_lever_source_id) <> ''
      and primary_lever_source_id = any(selected_action_source_ids)
      and primary_lever_action_id = any(action_ids)
    )
  );

alter table public.levers
  drop constraint levers_target_source_check,
  add constraint levers_target_source_check
    check (target_source in ('jira', 'github', 'manual'));

create table private.causal_recompute_jobs (
  activation_id uuid primary key
    references public.decision_report_activations(activation_id) on delete cascade,
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  report_id uuid not null references public.decision_reports(report_id) on delete cascade,
  metric_id uuid not null references public.metrics(metric_id) on delete cascade,
  requested_generation bigint not null default 1 check (requested_generation > 0),
  processed_generation bigint not null default 0 check (
    processed_generation >= 0 and processed_generation <= requested_generation
  ),
  requested_by uuid references auth.users(id) on delete set null,
  reasons text[] not null default '{}'::text[],
  requested_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 12),
  last_input_hash text check (last_input_hash ~ '^[0-9a-f]{64}$'),
  last_processed_at timestamptz,
  last_error_code text check (
    last_error_code is null
    or (char_length(last_error_code) between 1 and 80 and last_error_code !~ '[[:cntrl:]]')
  )
);

create index causal_recompute_jobs_pending_idx
  on private.causal_recompute_jobs(next_attempt_at, requested_at, activation_id)
  where processed_generation < requested_generation;

revoke all on private.causal_recompute_jobs from public, anon, authenticated;

-- Canonical report actions remain covered by the legacy broad actions/levers
-- UPDATE grants for compatibility with non-report connectors. A private,
-- one-use transaction capability lets only the checked completion RPC mutate a
-- report-native action and its exact primary manual lever. It is consumed by
-- row triggers and deleted before the RPC returns, so neither a caller-set GUC
-- nor a later statement in the same session can reuse it.
create table private.decision_report_completion_transitions (
  transaction_id xid8 not null,
  scope_id uuid not null,
  activation_id uuid not null,
  action_id uuid not null,
  action_consumed boolean not null default false,
  lever_required boolean not null,
  lever_consumed boolean not null default false,
  primary key (transaction_id, action_id),
  check (not lever_consumed or lever_required)
);

revoke all on private.decision_report_completion_transitions
  from public, anon, authenticated, service_role;

create function private.guard_decision_report_action_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    (old.source = 'manual' and coalesce(old.rationale_richtext #>> '{meta,source}', '') = 'decision_report')
    or
    (new.source = 'manual' and coalesce(new.rationale_richtext #>> '{meta,source}', '') = 'decision_report')
  ) then
    update private.decision_report_completion_transitions as transition
    set action_consumed = true
    where transition.transaction_id = pg_catalog.pg_current_xact_id()
      and transition.scope_id = old.scope_id
      and transition.scope_id = new.scope_id
      and transition.action_id = old.action_id
      and transition.action_id = new.action_id
      and not transition.action_consumed;
    if not found then
      raise exception 'Decision Report actions are application-managed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger actions_guard_decision_report_update
before update on public.actions
for each row execute function private.guard_decision_report_action_update();

create function private.guard_decision_report_primary_lever_update()
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
      and transition.action_id = old.action_id
      and transition.action_id = new.action_id
      and transition.lever_required
      and not transition.lever_consumed;
    if not found then
      raise exception 'Decision Report levers are application-managed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger levers_guard_decision_report_primary_update
before update on public.levers
for each row execute function private.guard_decision_report_primary_lever_update();

revoke all on function private.guard_decision_report_action_update()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_decision_report_primary_lever_update()
  from public, anon, authenticated, service_role;

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
  where workspace.workspace_id = p_scope_id
    and report.deleted_at is null
    and report.status = 'active'
    and report.active_metric_id = p_metric_id;

  -- Observation imports before activation, historical-report writes, and stale
  -- pointers intentionally create no work and reveal no target existence.
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

revoke all on function private.enqueue_current_causal_recompute(uuid, uuid, text, uuid)
  from public, anon, authenticated;

create or replace function private.enqueue_changed_metric_observations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target record;
begin
  for v_target in
    select distinct metric.scope_id, changed.metric_id
    from changed_observations as changed
    join public.metrics as metric on metric.metric_id = changed.metric_id
  loop
    perform private.enqueue_current_causal_recompute(
      v_target.scope_id,
      v_target.metric_id,
      'metric_observations_changed',
      auth.uid()
    );
  end loop;
  return null;
end;
$$;

revoke all on function private.enqueue_changed_metric_observations()
  from public, anon, authenticated;

create trigger metric_observations_enqueue_recompute_after_insert
after insert on public.metric_observations
referencing new table as changed_observations
for each statement execute function private.enqueue_changed_metric_observations();

create trigger metric_observations_enqueue_recompute_after_update
after update on public.metric_observations
referencing new table as changed_observations
for each statement execute function private.enqueue_changed_metric_observations();

-- Keep the original v1 materializer private and expose a guarded wrapper with
-- the same RPC signature. Calling a revoked v1 function through the local
-- authenticated role crashes the current local Postgres image before PL/pgSQL
-- can return a controlled denial. v2 therefore arms this exact invocation with
-- an ungrantable, one-use transaction capability; direct authenticated v1
-- calls enter the wrapper and fail closed with 42501 instead of reaching the
-- materializer. Trusted service-role/no-JWT fixtures retain their legacy path.
alter function public.activate_decision_report_v1(
  uuid, uuid, uuid, text, real, date, text[], uuid
) set schema private;

revoke all on function private.activate_decision_report_v1(
  uuid, uuid, uuid, text, real, date, text[], uuid
) from public, anon, authenticated, service_role;

create table private.decision_report_activation_v1_transitions (
  transaction_id xid8 not null,
  report_id uuid not null,
  revision_id uuid not null,
  metric_id uuid not null,
  prediction_direction text not null,
  prediction_magnitude_pct_mean real not null,
  prediction_resolution_date date not null,
  selected_action_source_ids text[] not null,
  -- Trusted service-role/bootstrap callers intentionally have no auth.uid().
  -- Authenticated callers are still bound to their validated JWT identity by
  -- assert_decision_report_write before this capability is armed.
  activated_by uuid,
  primary key (transaction_id, report_id, revision_id)
);

revoke all on private.decision_report_activation_v1_transitions
  from public, anon, authenticated, service_role;

create function public.activate_decision_report_v1(
  p_report_id uuid,
  p_revision_id uuid,
  p_metric_id uuid,
  p_prediction_direction text,
  p_prediction_magnitude_pct_mean real,
  p_prediction_resolution_date date,
  p_selected_action_source_ids text[],
  p_activated_by uuid
)
returns table (
  activation_id uuid,
  decision_id uuid,
  prediction_id uuid,
  action_ids uuid[],
  reused boolean,
  activated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jwt_role text := coalesce((select auth.jwt()->>'role'), '');
  v_request_role text := coalesce(pg_catalog.current_setting('role', true), 'none');
begin
  delete from private.decision_report_activation_v1_transitions as transition
  where transition.transaction_id = pg_catalog.pg_current_xact_id()
    and transition.report_id = p_report_id
    and transition.revision_id = p_revision_id
    and transition.metric_id = p_metric_id
    and transition.prediction_direction = p_prediction_direction
    and transition.prediction_magnitude_pct_mean is not distinct from p_prediction_magnitude_pct_mean
    and transition.prediction_resolution_date = p_prediction_resolution_date
    and transition.selected_action_source_ids is not distinct from p_selected_action_source_ids
    and transition.activated_by is not distinct from p_activated_by;
  if not found and (
    auth.uid() is not null
    or v_jwt_role not in ('', 'service_role')
    or v_request_role not in ('none', 'postgres', 'service_role')
  ) then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;

  return query
  select *
  from private.activate_decision_report_v1(
    p_report_id,
    p_revision_id,
    p_metric_id,
    p_prediction_direction,
    p_prediction_magnitude_pct_mean,
    p_prediction_resolution_date,
    p_selected_action_source_ids,
    p_activated_by
  );
end;
$$;

revoke all on function public.activate_decision_report_v1(
  uuid, uuid, uuid, text, real, date, text[], uuid
) from public, anon;
grant execute on function public.activate_decision_report_v1(
  uuid, uuid, uuid, text, real, date, text[], uuid
) to authenticated, service_role;

-- Activation v2 delegates the existing, checked materialization transaction to
-- v1, then records one explicit primary lever before that transaction commits.
-- A changed primary choice conflicts; an exact retry returns the same receipt.
create function public.activate_decision_report_v2(
  p_report_id uuid,
  p_revision_id uuid,
  p_metric_id uuid,
  p_prediction_direction text,
  p_prediction_magnitude_pct_mean real,
  p_prediction_resolution_date date,
  p_selected_action_source_ids text[],
  p_primary_lever_source_id text,
  p_activated_by uuid
)
returns table (
  activation_id uuid,
  decision_id uuid,
  prediction_id uuid,
  action_ids uuid[],
  primary_lever_action_id uuid,
  reused boolean,
  activated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
  v_report public.decision_reports%rowtype;
  v_activation public.decision_report_activations%rowtype;
  v_primary_source text := pg_catalog.btrim(coalesce(p_primary_lever_source_id, ''));
  v_primary_action_id uuid;
  v_series_current_report_id uuid;
  v_workspace_current_series_id uuid;
begin
  if v_primary_source = ''
     or not (v_primary_source = any(coalesce(p_selected_action_source_ids, '{}'::text[]))) then
    raise exception 'Choose one selected action as the primary lever.' using errcode = '22023';
  end if;

  -- v1 owns the materialization transaction, but its historical exact-retry
  -- path predates explicit workspace series selection. Authenticate and lock
  -- the same report -> series -> workspace chain before delegating so an
  -- iteration can neither activate nor replay after its lineage becomes
  -- historical. Iteration 1 intentionally remains able to switch series.
  select * into v_report
  from public.decision_reports as report
  where report.report_id = p_report_id
  for update;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
  perform private.assert_decision_report_write(v_report.scope_id, p_activated_by);

  if v_report.iteration_number > 1 then
    select current_active_report_id into v_series_current_report_id
    from public.decision_report_series as series
    where series.series_id = v_report.series_id
      and series.scope_id = v_report.scope_id
    for update;
    if not found then
      raise exception 'STALE_ITERATION_PARENT' using errcode = 'PT409';
    end if;

    select current_decision_report_series_id into v_workspace_current_series_id
    from public.workspaces as workspace
    where workspace.workspace_id = v_report.scope_id
    for update;
    if not found then
      raise exception 'Report not found or unavailable.' using errcode = '42501';
    end if;

    if v_workspace_current_series_id is distinct from v_report.series_id
       or (
         v_report.status = 'active'
         and v_series_current_report_id is distinct from v_report.report_id
       )
       or (
         v_report.status <> 'active'
         and v_series_current_report_id is distinct from v_report.predecessor_report_id
       ) then
      raise exception 'STALE_ITERATION_PARENT'
        using errcode = 'PT409', detail = coalesce(v_series_current_report_id::text, '');
    end if;
  end if;

  insert into private.decision_report_activation_v1_transitions (
    transaction_id,
    report_id,
    revision_id,
    metric_id,
    prediction_direction,
    prediction_magnitude_pct_mean,
    prediction_resolution_date,
    selected_action_source_ids,
    activated_by
  ) values (
    pg_catalog.pg_current_xact_id(),
    p_report_id,
    p_revision_id,
    p_metric_id,
    p_prediction_direction,
    p_prediction_magnitude_pct_mean,
    p_prediction_resolution_date,
    p_selected_action_source_ids,
    p_activated_by
  );

  select * into strict v_result
  from public.activate_decision_report_v1(
    p_report_id,
    p_revision_id,
    p_metric_id,
    p_prediction_direction,
    p_prediction_magnitude_pct_mean,
    p_prediction_resolution_date,
    p_selected_action_source_ids,
    p_activated_by
  );

  select * into strict v_activation
  from public.decision_report_activations as activation
  where activation.activation_id = v_result.activation_id
  for update;

  if v_activation.primary_lever_action_id is not null then
    if v_activation.primary_lever_source_id is distinct from v_primary_source then
      raise exception 'REPORT_ALREADY_ACTIVE'
        using errcode = 'PT409', detail = v_activation.activation_id::text;
    end if;
    return query select
      v_result.activation_id,
      v_result.decision_id,
      v_result.prediction_id,
      v_result.action_ids,
      v_activation.primary_lever_action_id,
      true,
      v_result.activated_at;
    return;
  end if;

  -- Never retrofit a legacy active report: the audited graph boundary remains
  -- immutable outside the new v2 activation transaction.
  if v_result.reused then
    raise exception 'REPORT_ALREADY_ACTIVE'
      using errcode = 'PT409', detail = v_activation.activation_id::text;
  end if;

  select action.action_id into v_primary_action_id
  from public.actions as action
  where action.action_id = any(v_result.action_ids)
    and action.scope_id = v_activation.scope_id
    and action.rationale_richtext #>> '{meta,source_item_id}' = v_primary_source;
  if not found then
    raise exception 'Choose one selected action as the primary lever.' using errcode = '22023';
  end if;

  update public.decision_report_activations as activation
  set primary_lever_source_id = v_primary_source,
      primary_lever_action_id = v_primary_action_id
  where activation.activation_id = v_activation.activation_id;

  insert into public.levers (
    scope_id,
    decision_id,
    action_id,
    metric_id,
    provenance_token,
    target_source,
    target_ref,
    status,
    drafted_payload
  ) values (
    v_activation.scope_id,
    v_activation.decision_id,
    v_primary_action_id,
    v_activation.metric_id,
    'decision-report:' || v_activation.activation_id::text || ':primary',
    'manual',
    null,
    'DRAFTED',
    pg_catalog.jsonb_build_object(
      'source', 'decision_report_activation',
      'activation_id', v_activation.activation_id,
      'report_id', v_activation.report_id,
      'source_item_id', v_primary_source
    )
  );

  perform private.enqueue_current_causal_recompute(
    v_activation.scope_id,
    v_activation.metric_id,
    'report_activated',
    p_activated_by
  );

  return query select
    v_result.activation_id,
    v_result.decision_id,
    v_result.prediction_id,
    v_result.action_ids,
    v_primary_action_id,
    false,
    v_result.activated_at;
end;
$$;

revoke all on function public.activate_decision_report_v2(
  uuid, uuid, uuid, text, real, date, text[], text, uuid
) from public, anon;
grant execute on function public.activate_decision_report_v2(
  uuid, uuid, uuid, text, real, date, text[], text, uuid
) to authenticated, service_role;

-- Authenticated callers retain EXECUTE only on the guarded public wrapper so a
-- direct legacy call reaches a controlled 42501 denial. The private
-- materializer remains unexecutable outside its owner.

-- Manual completion is current-pointer bound. It also advances the explicitly
-- selected manual lever to SHIPPED and queues the current activation atomically.
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
  v_lever_required boolean;
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

  select action.* into v_action
  from public.actions as action
  where action.action_id = p_action_id
    and action.scope_id = p_scope_id
  for update;
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

  v_lever_required := coalesce(v_activation.primary_lever_action_id = p_action_id, false);
  if v_lever_required then
    perform 1
    from public.levers as lever
    where lever.action_id = p_action_id
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
    lever_required
  ) values (
    pg_catalog.pg_current_xact_id(),
    p_scope_id,
    v_activation.activation_id,
    p_action_id,
    v_lever_required
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
                'recorded_at', pg_catalog.clock_timestamp()
              )
            )
        )
  where action.action_id = p_action_id
    and action.scope_id = p_scope_id;

  update public.levers as lever
  set status = 'SHIPPED',
      detected_at = coalesce(lever.detected_at, pg_catalog.clock_timestamp())
  where lever.action_id = p_action_id
    and lever.scope_id = p_scope_id
    and lever.decision_id = v_activation.decision_id
    and lever.metric_id = v_activation.metric_id
    and lever.target_source = 'manual'
    and lever.provenance_token =
      'decision-report:' || v_activation.activation_id::text || ':primary';

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

  perform private.enqueue_current_causal_recompute(
    p_scope_id,
    v_activation.metric_id,
    'manual_action_completed',
    p_authored_by
  );

  return query select p_action_id, p_completed_on, v_explanation, false;
end;
$$;

revoke all on function public.complete_manual_action_v1(uuid, uuid, date, text, uuid)
  from public, anon;
grant execute on function public.complete_manual_action_v1(uuid, uuid, date, text, uuid)
  to authenticated, service_role;

-- The report CSV importer now requires the explicit workspace -> series ->
-- current-report pointer. Historical active iterations can no longer receive
-- observations through this checked path.
create or replace function public.import_active_report_metric_csv_v1(
  p_scope_id uuid,
  p_report_id uuid,
  p_metric_id uuid,
  p_observations jsonb,
  p_authored_by uuid
)
returns table (
  metric_id uuid,
  metric_name text,
  accepted_rows integer,
  inserted_rows integer,
  updated_rows integer,
  start_date date,
  end_date date
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_report public.decision_reports%rowtype;
  v_metric public.metrics%rowtype;
  v_item jsonb;
  v_count integer;
  v_existing integer;
  v_start date;
  v_end date;
begin
  if p_scope_id is null or p_report_id is null or p_metric_id is null then
    raise exception 'The active report metric identity is required.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_observations) <> 'array' then
    raise exception 'Observations must be a JSON array.' using errcode = '22023';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_observations);
  if v_count not between 1 and 10000 then
    raise exception 'Import one to 10,000 daily observations.' using errcode = '22023';
  end if;

  perform 1 from public.workspaces
  where workspaces.workspace_id = p_scope_id
  for update;
  if not found then
    raise exception 'The active report metric is unavailable in this workspace.' using errcode = '42501';
  end if;
  perform private.assert_decision_report_write(p_scope_id, p_authored_by);

  select report.* into v_report
  from public.workspaces as workspace
  join public.decision_report_series as series
    on series.series_id = workspace.current_decision_report_series_id
   and series.scope_id = workspace.workspace_id
  join public.decision_reports as report
    on report.report_id = series.current_active_report_id
   and report.series_id = series.series_id
   and report.scope_id = workspace.workspace_id
  where workspace.workspace_id = p_scope_id
    and report.report_id = p_report_id
    and report.deleted_at is null
    and report.status = 'active'
    and report.active_metric_id = p_metric_id
  for update of report;
  if not found then
    raise exception 'The active report metric is unavailable in this workspace.' using errcode = '42501';
  end if;

  select * into v_metric
  from public.metrics
  where metrics.metric_id = p_metric_id
    and metrics.scope_id = p_scope_id
  for update;
  if not found then
    raise exception 'The active report metric is unavailable in this workspace.' using errcode = '42501';
  end if;
  if v_metric.granularity <> 'daily' then
    raise exception 'Only daily metrics can accept this CSV. Confirm a daily metric and try again.' using errcode = '22023';
  end if;
  if v_metric.source not in ('declared', 'csv') then
    raise exception 'This metric is managed by a connector. Confirm a declared or CSV metric before uploading.' using errcode = '22023';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_observations)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or (v_item - array['date', 'value']::text[]) <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(v_item->'date') <> 'string'
       or pg_catalog.jsonb_typeof(v_item->'value') <> 'number'
       or (v_item->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Every observation must contain only a YYYY-MM-DD date and finite numeric value.' using errcode = '22023';
    end if;
  end loop;

  if (
    select pg_catalog.count(distinct observation.date_value)
    from (
      select (item->>'date')::date as date_value
      from pg_catalog.jsonb_array_elements(p_observations) as items(item)
    ) observation
  ) <> v_count then
    raise exception 'Each daily date must appear exactly once.' using errcode = '22023';
  end if;

  select pg_catalog.min(observation.date_value), pg_catalog.max(observation.date_value)
  into v_start, v_end
  from (
    select (item->>'date')::date as date_value
    from pg_catalog.jsonb_array_elements(p_observations) as items(item)
  ) observation;

  select pg_catalog.count(*) into v_existing
  from public.metric_observations
  where metric_observations.metric_id = p_metric_id
    and metric_observations.obs_date in (
      select (item->>'date')::date
      from pg_catalog.jsonb_array_elements(p_observations) as items(item)
    );

  insert into public.metric_observations (metric_id, obs_date, value)
  select p_metric_id, (item->>'date')::date, (item->>'value')::numeric
  from pg_catalog.jsonb_array_elements(p_observations) as items(item)
  on conflict on constraint metric_observations_pkey do update
    set value = excluded.value;

  update public.metrics
  set source = 'csv'
  where metrics.metric_id = p_metric_id;

  return query select
    v_metric.metric_id,
    v_metric.name,
    v_count,
    v_count - v_existing,
    v_existing,
    v_start,
    v_end;
end;
$$;

revoke all on function public.import_active_report_metric_csv_v1(uuid, uuid, uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.import_active_report_metric_csv_v1(uuid, uuid, uuid, jsonb, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
