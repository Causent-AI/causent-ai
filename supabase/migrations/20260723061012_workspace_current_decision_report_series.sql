-- Make the workspace's operational Decision Report series explicit. A series
-- already owns its current active iteration; this pointer removes ambiguity
-- when several independent series exist in the same single-project workspace.

alter table public.workspaces
  add column current_decision_report_series_id uuid;

alter table public.workspaces
  add constraint workspaces_current_decision_report_series_fkey
  foreign key (current_decision_report_series_id, workspace_id)
  references public.decision_report_series(series_id, scope_id)
  deferrable initially deferred;

update public.workspaces as workspace
set current_decision_report_series_id = (
  select series.series_id
  from public.decision_report_series as series
  join public.decision_reports as report
    on report.report_id = series.current_active_report_id
  where series.scope_id = workspace.workspace_id
    and report.deleted_at is null
    and report.status = 'active'
  order by report.activated_at desc, report.report_id
  limit 1
);

-- A missing workspace should fail with the same closed, non-enumerating error
-- as every checked report write. Without this guard, service-role local-demo
-- calls surfaced the implementation-level series scope foreign-key name.
create or replace function private.initialize_decision_report_series()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces
  where workspaces.workspace_id = new.scope_id;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
  if new.series_id is null then
    new.series_id := gen_random_uuid();
    new.iteration_number := 1;
    new.predecessor_report_id := null;
    new.iteration_reason := null;
    insert into public.decision_report_series (series_id, scope_id)
    values (new.series_id, new.scope_id);
  end if;
  return new;
end;
$$;

-- Successors can only extend the one series the workspace explicitly exposes
-- as operational. The caller already holds report and series row locks; this
-- helper completes the shared lock order by locking the workspace row.
create or replace function private.assert_current_decision_report_iteration_parent(
  p_scope_id uuid,
  p_series_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_series_id uuid;
begin
  select current_decision_report_series_id into v_current_series_id
  from public.workspaces
  where workspaces.workspace_id = p_scope_id
  for update;
  if not found or v_current_series_id is distinct from p_series_id then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_current_decision_report_iteration_parent(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The pointer is database-owned. Workspace admins otherwise have a broad
-- UPDATE grant from the legacy workspace policy and could switch operational
-- series without activating a report. A private, one-use transition row is
-- created by the report activation trigger and consumed by the workspace
-- guard in the same transaction. Unlike a custom GUC, authenticated callers
-- cannot forge this capability through set_config().
create table private.decision_report_pointer_transitions (
  transaction_id xid8 not null,
  workspace_id uuid not null,
  previous_series_id uuid,
  target_series_id uuid not null,
  target_report_id uuid not null,
  primary key (transaction_id, workspace_id)
);

revoke all on private.decision_report_pointer_transitions
  from public, anon, authenticated, service_role;

create function private.guard_workspace_decision_report_series_pointer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_target_report_id uuid;
begin
  if new.current_decision_report_series_id is distinct from old.current_decision_report_series_id then
    delete from private.decision_report_pointer_transitions as transition
    where transition.transaction_id = pg_catalog.pg_current_xact_id()
      and transition.workspace_id = new.workspace_id
      and transition.previous_series_id is not distinct from old.current_decision_report_series_id
      and transition.target_series_id = new.current_decision_report_series_id
    returning transition.target_report_id into v_target_report_id;
    if not found then
      raise exception 'Workspace report pointer is application-managed.' using errcode = '42501';
    end if;

    -- Defense in depth: the one-use capability is valid only for the series'
    -- current report activated in this exact database transaction.
    perform 1
    from public.decision_report_series as series
    join public.decision_reports as report
      on report.report_id = series.current_active_report_id
     and report.series_id = series.series_id
     and report.scope_id = series.scope_id
    where series.series_id = new.current_decision_report_series_id
      and series.scope_id = new.workspace_id
      and report.report_id = v_target_report_id
      and report.status = 'active'
      and report.deleted_at is null
      and report.active_activation_id is not null
      and report.activated_at = pg_catalog.transaction_timestamp();
    if not found then
      raise exception 'Workspace report pointer is application-managed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger workspaces_guard_decision_report_series_pointer
before update of current_decision_report_series_id on public.workspaces
for each row execute function private.guard_workspace_decision_report_series_pointer();

create or replace function private.advance_decision_report_series_on_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_current uuid;
  v_workspace_current uuid;
begin
  if old.status <> 'active' and new.status = 'active' then
    select current_active_report_id into v_current
    from public.decision_report_series
    where series_id = new.series_id and scope_id = new.scope_id
    for update;
    if not found then
      raise exception 'STALE_ITERATION_PARENT' using errcode = 'PT409';
    end if;

    -- activate_decision_report_v1 already holds the report row. Continue the
    -- shared report -> series -> workspace lock order before validating either
    -- pointer, preventing a successor activation from racing a series switch.
    select current_decision_report_series_id into v_workspace_current
    from public.workspaces
    where workspace_id = new.scope_id
    for update;
    if not found then
      raise exception 'Report not found or unavailable.' using errcode = '42501';
    end if;

    if (new.iteration_number = 1 and v_current is not null)
       or (
         new.iteration_number > 1
         and (
           v_current is distinct from new.predecessor_report_id
           or v_workspace_current is distinct from new.series_id
         )
       ) then
      raise exception 'STALE_ITERATION_PARENT'
        using errcode = 'PT409', detail = coalesce(v_current::text, '');
    end if;

    update public.decision_report_series
    set current_active_report_id = new.report_id
    where series_id = new.series_id;

    -- Successors advance the report pointer inside the already-selected
    -- series, so no workspace pointer transition is needed (and no unused
    -- capability row may be left behind). Iteration 1 moves the workspace only
    -- when it intentionally selects a different independent series.
    if v_workspace_current is distinct from new.series_id then
      insert into private.decision_report_pointer_transitions (
        transaction_id,
        workspace_id,
        previous_series_id,
        target_series_id,
        target_report_id
      ) values (
        pg_catalog.pg_current_xact_id(),
        new.scope_id,
        v_workspace_current,
        new.series_id,
        new.report_id
      );

      update public.workspaces
      set current_decision_report_series_id = new.series_id
      where workspace_id = new.scope_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_workspace_decision_report_series_pointer()
  from public, anon, authenticated, service_role;
revoke all on function private.advance_decision_report_series_on_activation()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
