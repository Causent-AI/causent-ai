-- Async, workspace-scoped baseline-drift materialization.
--
-- Dashboard reads never execute Python. Source writes enqueue a coalesced private
-- workspace job; the engine worker owns the existing detector and atomically
-- replaces only the current unresolved-prediction projection. Viewers can read
-- the finished projection, but only service_role can mutate it.

create table private.drift_refresh_jobs (
  scope_id uuid primary key
    references public.workspaces(workspace_id) on delete cascade,
  requested_generation bigint not null default 1
    check (requested_generation > 0),
  processed_generation bigint not null default 0
    check (
      processed_generation >= 0
      and processed_generation <= requested_generation
    ),
  reasons text[] not null default '{}'::text[]
    check (cardinality(reasons) <= 16),
  requested_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 8),
  claimed_generation bigint check (
    claimed_generation is null
    or (claimed_generation > 0 and claimed_generation <= requested_generation)
  ),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_input_hash text check (last_input_hash ~ '^[0-9a-f]{64}$'),
  last_processed_at timestamptz,
  last_error_code text check (
    last_error_code is null
    or (
      char_length(last_error_code) between 1 and 80
      and last_error_code !~ '[[:cntrl:]]'
    )
  ),
  constraint drift_refresh_jobs_lease_shape_check check (
    (
      claimed_generation is null
      and lease_token is null
      and lease_expires_at is null
    )
    or (
      claimed_generation is not null
      and lease_token is not null
      and lease_expires_at is not null
    )
  )
);

create index drift_refresh_jobs_pending_idx
  on private.drift_refresh_jobs(next_attempt_at, requested_at, scope_id)
  where processed_generation < requested_generation;

revoke all on private.drift_refresh_jobs
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on private.drift_refresh_jobs to service_role;

create table public.current_prediction_drift (
  prediction_id uuid primary key,
  scope_id uuid not null,
  detector_status text not null
    check (detector_status in ('FIRED', 'NOT_FIRED', 'NO_BASELINE_YET')),
  reason text check (
    reason is null
    or (char_length(reason) between 1 and 120 and reason !~ '[[:cntrl:]]')
  ),
  shift_date date,
  pre_level double precision,
  post_level double precision,
  delta_native double precision,
  pct_change double precision,
  direction text check (direction is null or direction in ('up', 'down')),
  ci_low double precision,
  ci_high double precision,
  n_pre integer not null check (n_pre >= 0),
  n_post integer not null check (n_post >= 0),
  computed_generation bigint not null check (computed_generation > 0),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  computed_at timestamptz not null default now(),
  constraint current_prediction_drift_shape_check check (
    (
      detector_status = 'FIRED'
      and shift_date is not null
      and pre_level is not null
      and post_level is not null
      and delta_native is not null
      and pct_change is not null
      and direction is not null
      and ci_low is not null
      and ci_high is not null
      and n_pre > 0
      and n_post > 0
    )
    or detector_status in ('NOT_FIRED', 'NO_BASELINE_YET')
  )
);

-- This is a replaceable projection rather than canonical history. Deliberately
-- avoid a parent FK: a source DELETE holds the prediction row before its AFTER
-- trigger can enqueue, while the worker holds the queue row. An FK check in the
-- worker would invert those locks and deadlock. This guard proves the same
-- prediction/workspace relationship without taking a parent key-share lock;
-- the prediction DELETE trigger below removes derived rows explicitly.
create function private.guard_current_prediction_drift_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.predictions as prediction
    where prediction.prediction_id = new.prediction_id
      and prediction.scope_id = new.scope_id
      and prediction.resolved_at is null
  ) then
    raise exception 'Current drift prediction scope is invalid.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger current_prediction_drift_scope_guard
before insert or update on public.current_prediction_drift
for each row execute function private.guard_current_prediction_drift_scope();

revoke all on function private.guard_current_prediction_drift_scope()
  from public, anon, authenticated, service_role;

create index current_prediction_drift_scope_prediction_idx
  on public.current_prediction_drift(scope_id, prediction_id);

alter table public.current_prediction_drift enable row level security;

create policy current_prediction_drift_select
  on public.current_prediction_drift
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

revoke all on public.current_prediction_drift from public, anon, authenticated;
grant select on public.current_prediction_drift to authenticated;
grant select, insert, update, delete on public.current_prediction_drift to service_role;

create function private.enqueue_drift_refresh(
  p_scope_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if p_scope_id is null
     or v_reason = ''
     or pg_catalog.length(v_reason) > 80
     or v_reason ~ '[[:cntrl:]]' then
    raise exception 'A valid drift refresh target is required.' using errcode = '22023';
  end if;

  -- A deleted workspace needs no queue row. Treat it as an exact no-op rather
  -- than leaking whether the target once existed.
  if not exists (
    select 1
    from public.workspaces as workspace
    where workspace.workspace_id = p_scope_id
  ) then
    return;
  end if;

  insert into private.drift_refresh_jobs (
    scope_id,
    reasons
  ) values (
    p_scope_id,
    array[v_reason]
  )
  on conflict (scope_id) do update
  set requested_generation = drift_refresh_jobs.requested_generation + 1,
      reasons = (
        select coalesce(
          pg_catalog.array_agg(bounded.reason order by bounded.reason),
          '{}'::text[]
        )
        from (
          select distinct queued.reason
          from pg_catalog.unnest(
            drift_refresh_jobs.reasons || excluded.reasons
          ) as queued(reason)
          order by queued.reason
          limit 16
        ) as bounded
      ),
      requested_at = pg_catalog.now(),
      next_attempt_at = least(
        drift_refresh_jobs.next_attempt_at,
        pg_catalog.now()
      ),
      attempts = 0,
      claimed_generation = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null;

  -- Invalidate before the source transaction commits. The queue row is locked
  -- first, matching the worker's queue -> projection lock order and avoiding a
  -- deadlock with an in-flight refresh. Viewers therefore never read a stale
  -- drift fact while a newer source generation is queued or retrying.
  delete from public.current_prediction_drift as drift
  where drift.scope_id = p_scope_id;
end;
$$;

revoke all on function private.enqueue_drift_refresh(uuid, text)
  from public, anon, authenticated;
grant execute on function private.enqueue_drift_refresh(uuid, text) to service_role;

create function private.enqueue_drift_for_observation_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in
    select distinct metric.scope_id
    from changed_observations as changed
    join public.metrics as metric on metric.metric_id = changed.metric_id
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'metric_observations_inserted');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_observation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in
    select distinct metric.scope_id
    from (
      select metric_id from old_observations
      union
      select metric_id from new_observations
    ) as changed
    join public.metrics as metric on metric.metric_id = changed.metric_id
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'metric_observations_updated');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_observation_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in
    select distinct metric.scope_id
    from removed_observations as removed
    join public.metrics as metric on metric.metric_id = removed.metric_id
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'metric_observations_deleted');
  end loop;
  return null;
end;
$$;

create trigger metric_observations_enqueue_drift_after_insert
after insert on public.metric_observations
referencing new table as changed_observations
for each statement execute function private.enqueue_drift_for_observation_insert();

create trigger metric_observations_enqueue_drift_after_update
after update on public.metric_observations
referencing old table as old_observations new table as new_observations
for each statement execute function private.enqueue_drift_for_observation_update();

create trigger metric_observations_enqueue_drift_after_delete
after delete on public.metric_observations
referencing old table as removed_observations
for each statement execute function private.enqueue_drift_for_observation_delete();

create function private.enqueue_drift_for_prediction_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in select distinct scope_id from changed_predictions
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'predictions_inserted');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_prediction_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in
    select distinct scope_id
    from (
      select old_prediction.scope_id
      from old_predictions as old_prediction
      join new_predictions as new_prediction using (prediction_id)
      where (
        old_prediction.scope_id,
        old_prediction.decision_id,
        old_prediction.metric_id,
        old_prediction.committed_at,
        old_prediction.resolved_at
      ) is distinct from (
        new_prediction.scope_id,
        new_prediction.decision_id,
        new_prediction.metric_id,
        new_prediction.committed_at,
        new_prediction.resolved_at
      )
      union
      select new_prediction.scope_id
      from old_predictions as old_prediction
      join new_predictions as new_prediction using (prediction_id)
      where (
        old_prediction.scope_id,
        old_prediction.decision_id,
        old_prediction.metric_id,
        old_prediction.committed_at,
        old_prediction.resolved_at
      ) is distinct from (
        new_prediction.scope_id,
        new_prediction.decision_id,
        new_prediction.metric_id,
        new_prediction.committed_at,
        new_prediction.resolved_at
      )
    ) as changed_scopes
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'predictions_updated');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_prediction_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  delete from public.current_prediction_drift as drift
  using removed_predictions as removed
  where drift.prediction_id = removed.prediction_id
    and drift.scope_id = removed.scope_id;

  for v_scope_id in select distinct scope_id from removed_predictions
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'predictions_deleted');
  end loop;
  return null;
end;
$$;

create trigger predictions_enqueue_drift_after_insert
after insert on public.predictions
referencing new table as changed_predictions
for each statement execute function private.enqueue_drift_for_prediction_insert();

create trigger predictions_enqueue_drift_after_update
after update on public.predictions
referencing old table as old_predictions new table as new_predictions
for each statement execute function private.enqueue_drift_for_prediction_update();

create trigger predictions_enqueue_drift_after_delete
after delete on public.predictions
referencing old table as removed_predictions
for each statement execute function private.enqueue_drift_for_prediction_delete();

create function private.enqueue_drift_for_action_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in select distinct scope_id from changed_actions
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'actions_inserted');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_action_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in
    select distinct scope_id
    from (
      select old_action.scope_id
      from old_actions as old_action
      join new_actions as new_action using (action_id)
      where (
        old_action.scope_id,
        old_action.effective_date,
        old_action.ship_ts,
        old_action.status
      ) is distinct from (
        new_action.scope_id,
        new_action.effective_date,
        new_action.ship_ts,
        new_action.status
      )
      union
      select new_action.scope_id
      from old_actions as old_action
      join new_actions as new_action using (action_id)
      where (
        old_action.scope_id,
        old_action.effective_date,
        old_action.ship_ts,
        old_action.status
      ) is distinct from (
        new_action.scope_id,
        new_action.effective_date,
        new_action.ship_ts,
        new_action.status
      )
    ) as changed_scopes
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'actions_updated');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_action_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in select distinct scope_id from removed_actions
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'actions_deleted');
  end loop;
  return null;
end;
$$;

create trigger actions_enqueue_drift_after_insert
after insert on public.actions
referencing new table as changed_actions
for each statement execute function private.enqueue_drift_for_action_insert();

create trigger actions_enqueue_drift_after_update
after update on public.actions
referencing old table as old_actions new table as new_actions
for each statement execute function private.enqueue_drift_for_action_update();

create trigger actions_enqueue_drift_after_delete
after delete on public.actions
referencing old table as removed_actions
for each statement execute function private.enqueue_drift_for_action_delete();

-- Lever status/assignment defines the end of the pre-intervention window, so it
-- is queued alongside the action row that supplies its effective date.
create function private.enqueue_drift_for_lever_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in
    select distinct scope_id
    from (
      select scope_id from old_levers
      union
      select scope_id from new_levers
    ) as changed_scopes
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'levers_changed');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_lever_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in select distinct scope_id from new_levers
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'levers_inserted');
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_lever_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in select distinct scope_id from old_levers
  loop
    perform private.enqueue_drift_refresh(v_scope_id, 'levers_deleted');
  end loop;
  return null;
end;
$$;

create trigger levers_enqueue_drift_after_insert
after insert on public.levers
referencing new table as new_levers
for each statement execute function private.enqueue_drift_for_lever_insert();

create trigger levers_enqueue_drift_after_update
after update on public.levers
referencing old table as old_levers new table as new_levers
for each statement execute function private.enqueue_drift_for_lever_change();

create trigger levers_enqueue_drift_after_delete
after delete on public.levers
referencing old table as old_levers
for each statement execute function private.enqueue_drift_for_lever_delete();

-- A v2 Decision Report is not causally measurable until its immutable package
-- intervention exists. Its audit row supplies the pre-intervention cutoff and
-- participates in the worker input hash, so insert/delete must invalidate the
-- materialized drift projection independently of the action/lever triggers.
create function private.enqueue_drift_for_package_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in select distinct scope_id from new_package_interventions
  loop
    perform private.enqueue_drift_refresh(
      v_scope_id,
      'decision_package_intervention_inserted'
    );
  end loop;
  return null;
end;
$$;

create function private.enqueue_drift_for_package_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
begin
  for v_scope_id in select distinct scope_id from old_package_interventions
  loop
    perform private.enqueue_drift_refresh(
      v_scope_id,
      'decision_package_intervention_deleted'
    );
  end loop;
  return null;
end;
$$;

create trigger package_interventions_enqueue_drift_after_insert
after insert on public.decision_report_package_interventions
referencing new table as new_package_interventions
for each statement execute function private.enqueue_drift_for_package_insert();

create trigger package_interventions_enqueue_drift_after_delete
after delete on public.decision_report_package_interventions
referencing old table as old_package_interventions
for each statement execute function private.enqueue_drift_for_package_delete();

revoke all on function private.enqueue_drift_for_observation_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_observation_update()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_observation_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_prediction_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_prediction_update()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_prediction_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_action_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_action_update()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_action_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_lever_change()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_lever_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_lever_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_package_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_drift_for_package_delete()
  from public, anon, authenticated, service_role;

create function public.get_current_prediction_drift_v1(
  p_scope_id uuid
)
returns table (
  prediction_id uuid,
  refresh_status text,
  detector_status text,
  reason text,
  shift_date date,
  pre_level double precision,
  post_level double precision,
  delta_native double precision,
  pct_change double precision,
  direction text,
  ci_low double precision,
  ci_high double precision,
  n_pre integer,
  n_post integer,
  requested_generation bigint,
  processed_generation bigint,
  requested_at timestamptz,
  computed_at timestamptz,
  last_processed_at timestamptz,
  next_attempt_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jwt_role text := coalesce((select auth.jwt()->>'role'), '');
  v_prediction_count integer;
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

  select count(*) into v_prediction_count
  from (
    select 1
    from public.predictions as prediction
    where prediction.scope_id = p_scope_id
      and prediction.resolved_at is null
    limit 501
  ) as bounded_predictions;

  if v_prediction_count > 500 then
    raise exception 'Current prediction drift exceeds the bounded read limit.'
      using errcode = '54000';
  end if;

  return query
  with current_rows as (
    select
      prediction.prediction_id,
      case
        when job.scope_id is null then 'missing'
        when job.processed_generation < job.requested_generation
             and job.lease_token is not null
             and job.lease_expires_at > pg_catalog.now() then 'processing'
        when job.processed_generation < job.requested_generation
             and job.attempts > 0 then 'retrying'
        when job.processed_generation < job.requested_generation then 'queued'
        when job.last_error_code is not null then 'failed'
        when drift.prediction_id is null
          or drift.computed_generation <> job.processed_generation
          or drift.input_hash is distinct from job.last_input_hash then 'missing'
        else 'current'
      end as refresh_status,
      drift.detector_status,
      drift.reason,
      drift.shift_date,
      drift.pre_level,
      drift.post_level,
      drift.delta_native,
      drift.pct_change,
      drift.direction,
      drift.ci_low,
      drift.ci_high,
      drift.n_pre,
      drift.n_post,
      job.requested_generation,
      job.processed_generation,
      job.requested_at,
      drift.computed_at,
      job.last_processed_at,
      case
        when job.processed_generation < job.requested_generation
          then job.next_attempt_at
        else null
      end as next_attempt_at
    from public.predictions as prediction
    left join private.drift_refresh_jobs as job
      on job.scope_id = prediction.scope_id
    left join public.current_prediction_drift as drift
      on drift.prediction_id = prediction.prediction_id
     and drift.scope_id = prediction.scope_id
    where prediction.scope_id = p_scope_id
      and prediction.resolved_at is null
    order by prediction.prediction_id
    limit 500
  )
  select
    current_rows.prediction_id,
    current_rows.refresh_status,
    case when current_rows.refresh_status = 'current'
      then current_rows.detector_status else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.reason else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.shift_date else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.pre_level else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.post_level else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.delta_native else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.pct_change else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.direction else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.ci_low else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.ci_high else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.n_pre else null end,
    case when current_rows.refresh_status = 'current'
      then current_rows.n_post else null end,
    current_rows.requested_generation,
    current_rows.processed_generation,
    current_rows.requested_at,
    current_rows.computed_at,
    current_rows.last_processed_at,
    current_rows.next_attempt_at
  from current_rows;
end;
$$;

revoke all on function public.get_current_prediction_drift_v1(uuid)
  from public, anon;
grant execute on function public.get_current_prediction_drift_v1(uuid)
  to authenticated, service_role;

-- Seed one coalesced job per workspace with an unresolved prediction. Until a
-- worker completes it, the public RPC returns queued metadata and no drift fact.
insert into private.drift_refresh_jobs (scope_id, reasons)
select distinct prediction.scope_id, array['migration_backfill']::text[]
from public.predictions as prediction
where prediction.resolved_at is null
on conflict (scope_id) do nothing;
