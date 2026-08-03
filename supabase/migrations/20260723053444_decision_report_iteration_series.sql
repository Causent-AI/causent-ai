-- Decision Report Slice 10: explicit linear post-activation iterations.

create table public.decision_report_series (
  series_id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  current_active_report_id uuid,
  created_at timestamptz not null default now(),
  unique (series_id, scope_id)
);

alter table public.decision_reports
  add column series_id uuid,
  add column iteration_number integer,
  add column predecessor_report_id uuid,
  add column iteration_reason text;

do $$
declare
  report record;
  new_series_id uuid;
begin
  for report in
    select report_id, scope_id, status, deleted_at
    from public.decision_reports
  loop
    new_series_id := gen_random_uuid();
    insert into public.decision_report_series (series_id, scope_id, current_active_report_id)
    values (
      new_series_id,
      report.scope_id,
      case when report.status = 'active' and report.deleted_at is null then report.report_id else null end
    );
    update public.decision_reports
    set series_id = new_series_id,
        iteration_number = 1
    where report_id = report.report_id;
  end loop;
end;
$$;

alter table public.decision_reports
  alter column series_id set not null,
  alter column iteration_number set not null,
  add constraint decision_reports_iteration_number_check check (iteration_number > 0),
  add constraint decision_reports_iteration_reason_check check (
    (iteration_number = 1 and predecessor_report_id is null and iteration_reason is null)
    or
    (iteration_number > 1 and predecessor_report_id is not null
      and char_length(btrim(iteration_reason)) between 1 and 500)
  ),
  add constraint decision_reports_series_scope_fkey
    foreign key (series_id, scope_id)
    references public.decision_report_series(series_id, scope_id) on delete restrict,
  add constraint decision_reports_series_iteration_unique unique (series_id, iteration_number),
  add constraint decision_reports_series_report_unique unique (series_id, report_id),
  add constraint decision_reports_predecessor_fkey
    foreign key (series_id, predecessor_report_id)
    references public.decision_reports(series_id, report_id) on delete restrict;

alter table public.decision_report_series
  add constraint decision_report_series_current_fkey
  foreign key (series_id, current_active_report_id)
  references public.decision_reports(series_id, report_id)
  deferrable initially deferred;

create unique index decision_reports_one_live_successor_idx
  on public.decision_reports(predecessor_report_id)
  where predecessor_report_id is not null and deleted_at is null;
create index decision_reports_scope_series_iteration_idx
  on public.decision_reports(scope_id, series_id, iteration_number);

alter table public.decision_report_series enable row level security;
create policy decision_report_series_select
  on public.decision_report_series for select to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));
revoke all on public.decision_report_series from anon, authenticated;
grant select on public.decision_report_series to authenticated, service_role;

create function private.initialize_decision_report_series()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
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

create trigger decision_reports_initialize_series
before insert on public.decision_reports
for each row execute function private.initialize_decision_report_series();

-- This helper is tightened after the workspace's explicit series pointer is
-- added by the following migration. Keeping the lock here gives the successor
-- RPC one stable report -> series -> workspace lock order at every schema
-- boundary without referring to a column before it exists.
create function private.assert_current_decision_report_iteration_parent(
  p_scope_id uuid,
  p_series_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.workspaces
  where workspaces.workspace_id = p_scope_id
  for update;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_current_decision_report_iteration_parent(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.start_decision_report_iteration_v1(
  p_scope_id uuid,
  p_parent_report_id uuid,
  p_reason text,
  p_authored_by uuid
)
returns table (
  report_id uuid,
  revision_id uuid,
  series_id uuid,
  iteration_number integer,
  reused boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.decision_reports%rowtype;
  v_series public.decision_report_series%rowtype;
  v_parent_revision public.decision_report_revisions%rowtype;
  v_existing public.decision_reports%rowtype;
  v_report_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_created_at timestamptz := now();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_iteration_number integer;
  v_snapshot jsonb;
  v_hash text;
begin
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'An iteration reason between 1 and 500 characters is required.' using errcode = '22023';
  end if;

  select * into v_parent from public.decision_reports
  where decision_reports.report_id = p_parent_report_id
    and decision_reports.scope_id = p_scope_id
  for update;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
  perform private.assert_decision_report_write(v_parent.scope_id, p_authored_by);

  select * into strict v_series from public.decision_report_series
  where decision_report_series.series_id = v_parent.series_id
    and decision_report_series.scope_id = p_scope_id
  for update;

  -- Parent validity is checked before duplicate lookup. An exact request may
  -- only reuse a successor while its parent is still the workspace's explicit
  -- current active report; deleted, superseded, and historical parents fail
  -- closed instead of reviving an earlier response.
  if v_parent.deleted_at is not null or v_parent.status <> 'active'
     or v_series.current_active_report_id is distinct from v_parent.report_id then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
  perform private.assert_current_decision_report_iteration_parent(
    p_scope_id,
    v_parent.series_id
  );

  select * into v_existing from public.decision_reports
  where decision_reports.predecessor_report_id = v_parent.report_id
    and decision_reports.deleted_at is null
  for update;
  if found then
    if v_existing.iteration_reason = v_reason then
      return query select v_existing.report_id, v_existing.current_revision_id,
        v_existing.series_id, v_existing.iteration_number, true, v_existing.created_at;
      return;
    end if;
    raise exception 'ITERATION_ALREADY_STARTED'
      using errcode = 'PT409', detail = v_existing.report_id::text;
  end if;

  -- Soft-deleted successors remain immutable audit history and therefore keep
  -- their iteration numbers. Allocate after the historical maximum so a
  -- replacement draft never collides with a deleted row or rewrites lineage.
  select coalesce(max(report.iteration_number), 0) + 1
  into v_iteration_number
  from public.decision_reports as report
  where report.series_id = v_parent.series_id;

  select * into strict v_parent_revision from public.decision_report_revisions
  where decision_report_revisions.report_id = v_parent.report_id
    and decision_report_revisions.revision_id = v_parent.reviewed_revision_id;
  v_snapshot := jsonb_set(v_parent_revision.snapshot, '{implementation,assetIds}', '[]'::jsonb, true);
  perform private.assert_decision_report_payload(
    v_snapshot->>'title', 'report_ready', v_snapshot, v_parent_revision.metric_projection
  );
  v_hash := md5(v_snapshot::text || E'\n' || v_parent_revision.metric_projection::text);

  insert into public.decision_reports (
    report_id, scope_id, title, status, series_id, iteration_number,
    predecessor_report_id, iteration_reason, created_by, created_at, updated_at
  ) values (
    v_report_id, p_scope_id, v_snapshot->>'title', 'report_ready', v_parent.series_id,
    v_iteration_number, v_parent.report_id, v_reason,
    p_authored_by, v_created_at, v_created_at
  );
  insert into public.decision_report_revisions (
    revision_id, report_id, scope_id, base_revision_id, revision_number,
    schema_version, snapshot, metric_projection, content_hash, authored_by, created_at
  ) values (
    v_revision_id, v_report_id, p_scope_id, null, 1, 1, v_snapshot,
    v_parent_revision.metric_projection, v_hash, p_authored_by, v_created_at
  );
  update public.decision_reports
  set current_revision_id = v_revision_id, reviewed_revision_id = v_revision_id
  where decision_reports.report_id = v_report_id;

  return query select v_report_id, v_revision_id, v_parent.series_id,
    v_iteration_number, false, v_created_at;
end;
$$;

revoke all on function public.start_decision_report_iteration_v1(uuid, uuid, text, uuid) from public;
grant execute on function public.start_decision_report_iteration_v1(uuid, uuid, text, uuid)
  to authenticated, service_role;

create function private.advance_decision_report_series_on_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_current uuid;
begin
  if old.status <> 'active' and new.status = 'active' then
    select current_active_report_id into v_current
    from public.decision_report_series where series_id = new.series_id for update;
    if (new.iteration_number = 1 and v_current is not null)
       or (new.iteration_number > 1 and v_current is distinct from new.predecessor_report_id) then
      raise exception 'STALE_ITERATION_PARENT' using errcode = 'PT409', detail = coalesce(v_current::text, '');
    end if;
    update public.decision_report_series
    set current_active_report_id = new.report_id
    where series_id = new.series_id;
  end if;
  return new;
end;
$$;

create trigger decision_reports_advance_series_on_activation
after update of status on public.decision_reports
for each row execute function private.advance_decision_report_series_on_activation();

create or replace function public.delete_decision_report_v1(
  p_scope_id uuid, p_report_id uuid, p_authored_by uuid
)
returns table (report_id uuid, deleted_at timestamptz, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_report public.decision_reports%rowtype;
  v_series public.decision_report_series%rowtype;
  v_fallback uuid;
  v_deleted_at timestamptz := now();
begin
  select * into v_report from public.decision_reports
  where decision_reports.report_id = p_report_id and decision_reports.scope_id = p_scope_id
  for update;
  if not found then raise exception 'Report not found or unavailable.' using errcode = '42501'; end if;
  perform private.assert_decision_report_write(v_report.scope_id, p_authored_by);
  if v_report.deleted_at is not null then
    return query select v_report.report_id, v_report.deleted_at, true; return;
  end if;
  select * into strict v_series from public.decision_report_series
  where decision_report_series.series_id = v_report.series_id for update;
  if v_series.current_active_report_id = v_report.report_id then
    select ancestor.report_id into v_fallback
    from public.decision_reports ancestor
    where ancestor.series_id = v_report.series_id
      and ancestor.status = 'active' and ancestor.deleted_at is null
      and ancestor.iteration_number < v_report.iteration_number
    order by ancestor.iteration_number desc limit 1;
    update public.decision_report_series set current_active_report_id = v_fallback
    where decision_report_series.series_id = v_report.series_id;
  end if;
  update public.decision_reports set deleted_at = v_deleted_at, deleted_by = p_authored_by
  where decision_reports.report_id = v_report.report_id;
  return query select v_report.report_id, v_deleted_at, false;
end;
$$;

notify pgrst, 'reload schema';
