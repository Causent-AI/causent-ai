-- Decision Report Slice 4 — durable report identity + append-only revisions.
--
-- The report remains upstream of the canonical decision graph. These tables
-- store reviewed onboarding work only; this migration creates no decision,
-- prediction, action, decision_action, or lever rows.
--
-- Reads use the existing workspace membership model. Writes are intentionally
-- closed at the table layer and exposed only through two transaction-safe,
-- explicitly granted functions. Both functions re-check the signed-in actor,
-- workspace membership, report shape, readiness, and revision freshness.

create schema if not exists private;
revoke all on schema private from public;

create table public.decision_reports (
  report_id            uuid primary key default gen_random_uuid(),
  scope_id             uuid not null references public.workspaces(workspace_id) on delete cascade,
  title                text not null check (
    char_length(btrim(title)) between 1 and 200
  ),
  status               text not null default 'draft' check (
    status in ('draft', 'report_ready')
  ),
  current_revision_id  uuid,
  reviewed_revision_id uuid,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (report_id, scope_id)
);

create index decision_reports_scope_updated_idx
  on public.decision_reports(scope_id, updated_at desc);

create table public.decision_report_revisions (
  revision_id       uuid primary key default gen_random_uuid(),
  report_id         uuid not null,
  scope_id          uuid not null,
  base_revision_id  uuid,
  revision_number   integer not null check (revision_number > 0),
  schema_version    integer not null check (schema_version = 1),
  snapshot          jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  metric_projection jsonb not null check (jsonb_typeof(metric_projection) = 'object'),
  content_hash      text not null check (content_hash ~ '^[0-9a-f]{32}$'),
  authored_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (report_id, revision_number),
  unique (report_id, revision_id),
  foreign key (report_id, scope_id)
    references public.decision_reports(report_id, scope_id) on delete cascade,
  foreign key (report_id, base_revision_id)
    references public.decision_report_revisions(report_id, revision_id)
);

create index decision_report_revisions_scope_created_idx
  on public.decision_report_revisions(scope_id, created_at desc);
create index decision_report_revisions_report_created_idx
  on public.decision_report_revisions(report_id, revision_number desc);

alter table public.decision_reports
  add constraint decision_reports_current_revision_id_fkey
  foreign key (current_revision_id)
  references public.decision_report_revisions(revision_id)
  on delete set null
  deferrable initially deferred;

alter table public.decision_reports
  add constraint decision_reports_reviewed_revision_id_fkey
  foreign key (reviewed_revision_id)
  references public.decision_report_revisions(revision_id)
  on delete set null
  deferrable initially deferred;

-- Small internal predicates keep the database-side readiness check legible.
-- They do not attempt to replace the full TypeScript schema validator; they
-- enforce the security-relevant transition from draft -> report_ready.
create function private.claim_list_has_complete(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(value) <> 'array' then false
    else exists (
      select 1
      from jsonb_array_elements(value) as claim
      where coalesce(claim->>'status', '') <> 'missing'
        and btrim(coalesce(claim->>'text', '')) <> ''
    )
  end;
$$;

create function private.decision_report_snapshot_is_ready(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(value) = 'object'
    and value->>'schemaVersion' = '1'
    and private.claim_list_has_complete(value #> '{decision,decision}')
    and private.claim_list_has_complete(value #> '{decision,problem}')
    and private.claim_list_has_complete(value #> '{supportingEvidence,factors}')
    and private.claim_list_has_complete(value #> '{supportingEvidence,metricMechanism}')
    and private.claim_list_has_complete(value #> '{implementation,actionPlanSummary}')
    and case
      when jsonb_typeof(value #> '{implementation,actions}') <> 'array' then false
      else exists (
        select 1
        from jsonb_array_elements(value #> '{implementation,actions}') as action
        where btrim(coalesce(action->>'title', '')) <> ''
      )
    end;
$$;

create function private.assert_decision_report_write(
  target_scope uuid,
  authored_by uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  caller_role text := coalesce((select auth.jwt()->>'role'), '');
begin
  if caller_role = 'service_role' then
    return;
  end if;

  if actor_id is null
     or authored_by is distinct from actor_id
     or not public.has_scope_access(target_scope, 'member') then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
end;
$$;

create function private.assert_decision_report_payload(
  report_title text,
  report_status text,
  report_snapshot jsonb,
  projection jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(report_title, ''))) not between 1 and 200 then
    raise exception 'Report title must be 1-200 characters.' using errcode = '22023';
  end if;
  if report_status not in ('draft', 'report_ready') then
    raise exception 'Invalid report status.' using errcode = '22023';
  end if;
  if jsonb_typeof(report_snapshot) <> 'object'
     or report_snapshot->>'schemaVersion' <> '1'
     or octet_length(report_snapshot::text) > 262144 then
    raise exception 'Invalid DecisionReportV1 snapshot.' using errcode = '22023';
  end if;
  if jsonb_typeof(projection) <> 'object'
     or octet_length(projection::text) > 32768 then
    raise exception 'Invalid metric projection.' using errcode = '22023';
  end if;
  if report_status = 'report_ready'
     and not private.decision_report_snapshot_is_ready(report_snapshot) then
    raise exception 'Required report fields are incomplete.' using errcode = '22023';
  end if;
end;
$$;

create function public.create_decision_report_v1(
  p_scope_id uuid,
  p_title text,
  p_status text,
  p_snapshot jsonb,
  p_metric_projection jsonb,
  p_authored_by uuid
)
returns table (
  report_id uuid,
  revision_id uuid,
  base_revision_id uuid,
  status text,
  content_hash text,
  reused boolean,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_hash text;
  v_saved_at timestamptz := now();
begin
  perform private.assert_decision_report_write(p_scope_id, p_authored_by);
  perform private.assert_decision_report_payload(
    p_title,
    p_status,
    p_snapshot,
    p_metric_projection
  );

  v_hash := md5(p_snapshot::text || E'\n' || p_metric_projection::text);

  insert into public.decision_reports (
    report_id,
    scope_id,
    title,
    status,
    created_by,
    created_at,
    updated_at
  ) values (
    v_report_id,
    p_scope_id,
    btrim(p_title),
    p_status,
    p_authored_by,
    v_saved_at,
    v_saved_at
  );

  insert into public.decision_report_revisions (
    revision_id,
    report_id,
    scope_id,
    base_revision_id,
    revision_number,
    schema_version,
    snapshot,
    metric_projection,
    content_hash,
    authored_by,
    created_at
  ) values (
    v_revision_id,
    v_report_id,
    p_scope_id,
    null,
    1,
    1,
    p_snapshot,
    p_metric_projection,
    v_hash,
    p_authored_by,
    v_saved_at
  );

  update public.decision_reports
  set current_revision_id = v_revision_id,
      reviewed_revision_id = case
        when p_status = 'report_ready' then v_revision_id
        else null
      end
  where decision_reports.report_id = v_report_id;

  return query
  select
    v_report_id,
    v_revision_id,
    null::uuid,
    p_status,
    v_hash,
    false,
    v_saved_at;
end;
$$;

create function public.append_decision_report_revision_v1(
  p_report_id uuid,
  p_base_revision_id uuid,
  p_title text,
  p_status text,
  p_snapshot jsonb,
  p_metric_projection jsonb,
  p_authored_by uuid
)
returns table (
  report_id uuid,
  revision_id uuid,
  base_revision_id uuid,
  status text,
  content_hash text,
  reused boolean,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.decision_reports%rowtype;
  v_current public.decision_report_revisions%rowtype;
  v_revision_id uuid := gen_random_uuid();
  v_hash text;
  v_saved_at timestamptz := now();
begin
  select * into v_report
  from public.decision_reports
  where decision_reports.report_id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;

  perform private.assert_decision_report_write(v_report.scope_id, p_authored_by);
  perform private.assert_decision_report_payload(
    p_title,
    p_status,
    p_snapshot,
    p_metric_projection
  );

  select * into strict v_current
  from public.decision_report_revisions
  where decision_report_revisions.revision_id = v_report.current_revision_id
    and decision_report_revisions.report_id = v_report.report_id;

  v_hash := md5(p_snapshot::text || E'\n' || p_metric_projection::text);

  -- Retry idempotency wins over freshness: a repeated response after a lost
  -- network acknowledgement returns the already-current revision.
  if v_current.content_hash = v_hash then
    return query
    select
      v_report.report_id,
      v_current.revision_id,
      v_current.base_revision_id,
      v_report.status,
      v_current.content_hash,
      true,
      v_current.created_at;
    return;
  end if;

  if p_base_revision_id is distinct from v_current.revision_id then
    raise exception 'STALE_REVISION'
      using errcode = '40001', detail = v_current.revision_id::text;
  end if;

  insert into public.decision_report_revisions (
    revision_id,
    report_id,
    scope_id,
    base_revision_id,
    revision_number,
    schema_version,
    snapshot,
    metric_projection,
    content_hash,
    authored_by,
    created_at
  ) values (
    v_revision_id,
    v_report.report_id,
    v_report.scope_id,
    v_current.revision_id,
    v_current.revision_number + 1,
    1,
    p_snapshot,
    p_metric_projection,
    v_hash,
    p_authored_by,
    v_saved_at
  );

  update public.decision_reports
  set title = btrim(p_title),
      status = p_status,
      current_revision_id = v_revision_id,
      reviewed_revision_id = case
        when p_status = 'report_ready' then v_revision_id
        else reviewed_revision_id
      end,
      updated_at = v_saved_at
  where decision_reports.report_id = v_report.report_id;

  return query
  select
    v_report.report_id,
    v_revision_id,
    v_current.revision_id,
    p_status,
    v_hash,
    false,
    v_saved_at;
end;
$$;

alter table public.decision_reports enable row level security;
alter table public.decision_report_revisions enable row level security;

create policy decision_reports_select
  on public.decision_reports
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

create policy decision_report_revisions_select
  on public.decision_report_revisions
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

-- Tables are read-only to application roles. Append/update/delete all happen
-- inside the checked RPCs above; revision rows are therefore append-only at
-- both the RLS and privilege layers.
revoke all on public.decision_reports from anon, authenticated;
revoke all on public.decision_report_revisions from anon, authenticated;
grant select on public.decision_reports to authenticated, service_role;
grant select on public.decision_report_revisions to authenticated, service_role;

revoke all on function public.create_decision_report_v1(
  uuid, text, text, jsonb, jsonb, uuid
) from public;
revoke all on function public.append_decision_report_revision_v1(
  uuid, uuid, text, text, jsonb, jsonb, uuid
) from public;
grant execute on function public.create_decision_report_v1(
  uuid, text, text, jsonb, jsonb, uuid
) to authenticated, service_role;
grant execute on function public.append_decision_report_revision_v1(
  uuid, uuid, text, text, jsonb, jsonb, uuid
) to authenticated, service_role;

revoke all on function private.claim_list_has_complete(jsonb) from public;
revoke all on function private.decision_report_snapshot_is_ready(jsonb) from public;
revoke all on function private.assert_decision_report_write(uuid, uuid) from public;
revoke all on function private.assert_decision_report_payload(text, text, jsonb, jsonb) from public;

notify pgrst, 'reload schema';
