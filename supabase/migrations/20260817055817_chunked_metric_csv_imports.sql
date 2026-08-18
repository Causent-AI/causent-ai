-- Bounded, resumable synchronous CSV ingestion for the MVP.
--
-- Parsing remains in the Server Action, but a 2,000-row upload is committed in
-- deterministic 250-row chunks. Each short RPC is idempotent by receipt,
-- chunk index, and digest. A serialization/deadlock victim can be retried, and
-- submitting the exact file again resumes the durable receipt.

create table public.metric_csv_import_jobs (
  import_id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  target_kind text not null check (target_kind in ('workspace_metric', 'report_metric')),
  target_key text not null check (char_length(target_key) between 1 and 512),
  report_id uuid references public.decision_reports(report_id) on delete cascade,
  metric_id uuid not null references public.metrics(metric_id) on delete cascade,
  metric_name text not null check (char_length(metric_name) between 1 and 120),
  metric_unit text check (metric_unit is null or metric_unit in ('count', 'percent', 'USD')),
  metric_created boolean not null default false,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  total_rows integer not null check (total_rows between 1 and 2000),
  processed_rows integer not null default 0 check (processed_rows between 0 and total_rows),
  inserted_rows integer not null default 0 check (inserted_rows between 0 and processed_rows),
  updated_rows integer not null default 0 check (updated_rows between 0 and processed_rows),
  next_chunk_index integer not null default 0 check (next_chunk_index >= 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'received' check (status in ('received', 'in_progress', 'complete')),
  authored_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (scope_id, target_kind, target_key, content_hash),
  check (start_date <= end_date),
  check (
    (status = 'complete' and inserted_rows + updated_rows = processed_rows)
    or (status <> 'complete' and inserted_rows = 0 and updated_rows = 0)
  ),
  check (
    (target_kind = 'workspace_metric' and report_id is null)
    or (target_kind = 'report_metric' and report_id is not null)
  ),
  check (target_kind <> 'workspace_metric' or metric_unit is not null),
  check (
    (status = 'complete' and processed_rows = total_rows and completed_at is not null)
    or (status <> 'complete' and completed_at is null)
  )
);

create index metric_csv_import_jobs_scope_created_idx
  on public.metric_csv_import_jobs(scope_id, created_at desc, import_id);
create index metric_csv_import_jobs_report_idx
  on public.metric_csv_import_jobs(report_id)
  where report_id is not null;
create index metric_csv_import_jobs_metric_idx
  on public.metric_csv_import_jobs(metric_id, created_at desc, import_id);
-- One unfinished receipt owns a target at a time. Finalization removes the
-- index entry in the same transaction that publishes the staged observations.
create unique index metric_csv_import_jobs_one_inflight_target_idx
  on public.metric_csv_import_jobs(scope_id, target_kind, target_key)
  where status <> 'complete';

create table private.metric_csv_import_chunks (
  import_id uuid not null references public.metric_csv_import_jobs(import_id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_digest text not null check (chunk_digest ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count between 1 and 250),
  start_date date not null,
  end_date date not null,
  primary key (import_id, chunk_index),
  check (start_date <= end_date)
);

-- Chunks are durable resume receipts, but observations stay private until the
-- final RPC can publish the complete file in one transaction.
create table private.metric_csv_import_staging (
  import_id uuid not null references public.metric_csv_import_jobs(import_id) on delete cascade,
  obs_date date not null,
  value numeric not null check (abs(value) <= 1000000000000000),
  primary key (import_id, obs_date)
);

alter table public.metric_csv_import_jobs enable row level security;
create policy metric_csv_import_jobs_select
  on public.metric_csv_import_jobs
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

revoke all on table public.metric_csv_import_jobs from anon, authenticated;
grant select on table public.metric_csv_import_jobs to authenticated, service_role;
grant insert, update, delete on table public.metric_csv_import_jobs to service_role;
revoke all on table private.metric_csv_import_chunks from public, anon, authenticated;
grant select, insert, update, delete on table private.metric_csv_import_chunks to service_role;
revoke all on table private.metric_csv_import_staging from public, anon, authenticated;
grant select, insert, update, delete on table private.metric_csv_import_staging to service_role;

create function private.metric_csv_date_or_null(p_value text)
returns date
language plpgsql
stable
strict
set search_path = ''
as $$
declare
  v_date date;
begin
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  begin
    v_date := p_value::date;
  exception when others then
    return null;
  end;
  if pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> p_value then
    return null;
  end if;
  return v_date;
end;
$$;

revoke all on function private.metric_csv_date_or_null(text)
  from public, anon, authenticated;

create function private.lock_current_report_metric_for_csv_import(
  p_scope_id uuid,
  p_report_id uuid,
  p_metric_id uuid,
  p_authored_by uuid
)
returns public.metrics
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.decision_reports%rowtype;
  v_series_current_report_id uuid;
  v_workspace_current_series_id uuid;
  v_metric public.metrics%rowtype;
begin
  select report.*
    into v_report
    from public.decision_reports as report
   where report.report_id = p_report_id
     and report.scope_id = p_scope_id
     and report.deleted_at is null
   for update;
  if not found then
    raise exception 'The active report metric is unavailable in this workspace.' using errcode = '42501';
  end if;

  perform private.assert_decision_report_write(p_scope_id, p_authored_by);

  select series.current_active_report_id
    into v_series_current_report_id
    from public.decision_report_series as series
   where series.series_id = v_report.series_id
     and series.scope_id = p_scope_id
   for update;

  select workspace.current_decision_report_series_id
    into v_workspace_current_series_id
    from public.workspaces as workspace
   where workspace.workspace_id = p_scope_id
   for update;

  if v_report.status <> 'active'
     or v_report.active_metric_id is distinct from p_metric_id
     or v_series_current_report_id is distinct from p_report_id
     or v_workspace_current_series_id is distinct from v_report.series_id then
    raise exception 'The active report metric is unavailable in this workspace.' using errcode = '42501';
  end if;

  select metric.*
    into v_metric
    from public.metrics as metric
   where metric.metric_id = p_metric_id
     and metric.scope_id = p_scope_id
   for update;
  if not found then
    raise exception 'The active report metric is unavailable in this workspace.' using errcode = '42501';
  end if;
  if v_metric.granularity <> 'daily' then
    raise exception 'Only daily metrics can accept this CSV.' using errcode = '22023';
  end if;
  if v_metric.source not in ('declared', 'csv') then
    raise exception 'This metric is managed by a connector.' using errcode = '22023';
  end if;
  return v_metric;
end;
$$;

revoke all on function private.lock_current_report_metric_for_csv_import(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

create function public.begin_workspace_metric_csv_import_v2(
  p_scope_id uuid,
  p_name text,
  p_unit text,
  p_content_hash text,
  p_total_rows integer,
  p_start_date date,
  p_end_date date,
  p_authored_by uuid
)
returns table (
  import_id uuid,
  import_status text,
  metric_id uuid,
  metric_name text,
  metric_unit text,
  metric_created boolean,
  total_rows integer,
  processed_rows integer,
  inserted_rows integer,
  updated_rows integer,
  next_chunk_index integer,
  start_date date,
  end_date date,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metric public.metrics%rowtype;
  v_job public.metric_csv_import_jobs%rowtype;
  v_inflight public.metric_csv_import_jobs%rowtype;
  v_name text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_target_key text;
  v_created boolean := false;
  v_inserted boolean := false;
begin
  if p_scope_id is null
     or v_name = ''
     or char_length(v_name) > 120
     or v_name ~ '[[:cntrl:]]'
     or p_unit is null
     or p_unit not in ('count', 'percent', 'USD')
     or p_content_hash is null
     or p_content_hash !~ '^[0-9a-f]{64}$'
     or p_total_rows is null
     or p_total_rows not between 1 and 2000
     or p_start_date is null
     or p_end_date is null
     or p_start_date > p_end_date then
    raise exception 'Invalid metric CSV import request.' using errcode = '22023';
  end if;

  perform private.assert_decision_report_write(p_scope_id, p_authored_by);
  perform 1
    from public.workspaces as workspace
   where workspace.workspace_id = p_scope_id
   for update;
  if not found then
    raise exception 'This workspace is unavailable for metric import.' using errcode = '42501';
  end if;

  select metric.*
    into v_metric
    from public.metrics as metric
   where metric.scope_id = p_scope_id
     and lower(btrim(metric.name)) = lower(v_name)
   order by metric.metric_id
   limit 1
   for update;

  if not found then
    insert into public.metrics (scope_id, name, source, granularity, unit)
    values (p_scope_id, v_name, 'csv', 'daily', p_unit)
    returning * into v_metric;
    v_created := true;
  else
    if v_metric.source = 'connector' or v_metric.granularity <> 'daily' then
      raise exception 'This metric cannot accept a daily CSV.' using errcode = '22023';
    end if;
    if v_metric.unit is not null and v_metric.unit <> p_unit then
      raise exception 'This metric already uses another unit.' using errcode = '22023';
    end if;
    if v_metric.unit is null then
      update public.metrics as metric
         set unit = p_unit
       where metric.metric_id = v_metric.metric_id;
      v_metric.unit := p_unit;
    end if;
  end if;

  v_target_key := 'metric-name:' || lower(v_name);
  select job.*
    into v_inflight
    from public.metric_csv_import_jobs as job
   where job.scope_id = p_scope_id
     and job.target_kind = 'workspace_metric'
     and job.target_key = v_target_key
     and job.status <> 'complete'
   for update;
  if found and v_inflight.content_hash <> p_content_hash then
    raise exception 'Another file is already being imported for this metric. Retry that exact file first.'
      using errcode = 'C4090';
  end if;

  insert into public.metric_csv_import_jobs (
    scope_id,
    target_kind,
    target_key,
    report_id,
    metric_id,
    metric_name,
    metric_unit,
    metric_created,
    content_hash,
    total_rows,
    start_date,
    end_date,
    authored_by
  ) values (
    p_scope_id,
    'workspace_metric',
    v_target_key,
    null,
    v_metric.metric_id,
    v_metric.name,
    coalesce(v_metric.unit, p_unit),
    v_created,
    p_content_hash,
    p_total_rows,
    p_start_date,
    p_end_date,
    p_authored_by
  )
  on conflict (scope_id, target_kind, target_key, content_hash) do nothing
  returning true into v_inserted;

  select job.*
    into v_job
    from public.metric_csv_import_jobs as job
   where job.scope_id = p_scope_id
     and job.target_kind = 'workspace_metric'
     and job.target_key = v_target_key
     and job.content_hash = p_content_hash
   for update;

  if v_job.metric_id is distinct from v_metric.metric_id
     or v_job.metric_unit is distinct from coalesce(v_metric.unit, p_unit)
     or v_job.total_rows is distinct from p_total_rows
     or v_job.start_date is distinct from p_start_date
     or v_job.end_date is distinct from p_end_date then
    raise exception 'The import receipt conflicts with this request.' using errcode = 'C4090';
  end if;

  return query select
    v_job.import_id,
    v_job.status,
    v_job.metric_id,
    v_job.metric_name,
    v_job.metric_unit,
    v_job.metric_created,
    v_job.total_rows,
    v_job.processed_rows,
    v_job.inserted_rows,
    v_job.updated_rows,
    v_job.next_chunk_index,
    v_job.start_date,
    v_job.end_date,
    not coalesce(v_inserted, false);
end;
$$;

create function public.begin_report_metric_csv_import_v2(
  p_scope_id uuid,
  p_report_id uuid,
  p_metric_id uuid,
  p_content_hash text,
  p_total_rows integer,
  p_start_date date,
  p_end_date date,
  p_authored_by uuid
)
returns table (
  import_id uuid,
  import_status text,
  metric_id uuid,
  metric_name text,
  metric_unit text,
  metric_created boolean,
  total_rows integer,
  processed_rows integer,
  inserted_rows integer,
  updated_rows integer,
  next_chunk_index integer,
  start_date date,
  end_date date,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metric public.metrics%rowtype;
  v_job public.metric_csv_import_jobs%rowtype;
  v_inflight public.metric_csv_import_jobs%rowtype;
  v_target_key text;
  v_inserted boolean := false;
begin
  if p_scope_id is null
     or p_report_id is null
     or p_metric_id is null
     or p_content_hash is null
     or p_content_hash !~ '^[0-9a-f]{64}$'
     or p_total_rows is null
     or p_total_rows not between 1 and 2000
     or p_start_date is null
     or p_end_date is null
     or p_start_date > p_end_date then
    raise exception 'Invalid report metric CSV import request.' using errcode = '22023';
  end if;

  select * into v_metric
    from private.lock_current_report_metric_for_csv_import(
      p_scope_id,
      p_report_id,
      p_metric_id,
      p_authored_by
    );
  v_target_key := 'report:' || p_report_id::text || ':metric:' || p_metric_id::text;

  select job.*
    into v_inflight
    from public.metric_csv_import_jobs as job
   where job.scope_id = p_scope_id
     and job.target_kind = 'report_metric'
     and job.target_key = v_target_key
     and job.status <> 'complete'
   for update;
  if found and v_inflight.content_hash <> p_content_hash then
    raise exception 'Another file is already being imported for this metric. Retry that exact file first.'
      using errcode = 'C4090';
  end if;

  insert into public.metric_csv_import_jobs (
    scope_id,
    target_kind,
    target_key,
    report_id,
    metric_id,
    metric_name,
    metric_unit,
    metric_created,
    content_hash,
    total_rows,
    start_date,
    end_date,
    authored_by
  ) values (
    p_scope_id,
    'report_metric',
    v_target_key,
    p_report_id,
    p_metric_id,
    v_metric.name,
    v_metric.unit,
    false,
    p_content_hash,
    p_total_rows,
    p_start_date,
    p_end_date,
    p_authored_by
  )
  on conflict (scope_id, target_kind, target_key, content_hash) do nothing
  returning true into v_inserted;

  select job.*
    into v_job
    from public.metric_csv_import_jobs as job
   where job.scope_id = p_scope_id
     and job.target_kind = 'report_metric'
     and job.target_key = v_target_key
     and job.content_hash = p_content_hash
   for update;

  if v_job.report_id is distinct from p_report_id
     or v_job.metric_id is distinct from p_metric_id
     or v_job.total_rows is distinct from p_total_rows
     or v_job.start_date is distinct from p_start_date
     or v_job.end_date is distinct from p_end_date then
    raise exception 'The import receipt conflicts with this request.' using errcode = 'C4090';
  end if;

  return query select
    v_job.import_id,
    v_job.status,
    v_job.metric_id,
    v_job.metric_name,
    v_job.metric_unit,
    v_job.metric_created,
    v_job.total_rows,
    v_job.processed_rows,
    v_job.inserted_rows,
    v_job.updated_rows,
    v_job.next_chunk_index,
    v_job.start_date,
    v_job.end_date,
    not coalesce(v_inserted, false);
end;
$$;

create function public.append_metric_csv_import_chunk_v2(
  p_import_id uuid,
  p_chunk_index integer,
  p_chunk_digest text,
  p_observations jsonb,
  p_authored_by uuid
)
returns table (
  import_id uuid,
  import_status text,
  processed_rows integer,
  total_rows integer,
  next_chunk_index integer,
  inserted_rows integer,
  updated_rows integer,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hint public.metric_csv_import_jobs%rowtype;
  v_job public.metric_csv_import_jobs%rowtype;
  v_metric public.metrics%rowtype;
  v_chunk private.metric_csv_import_chunks%rowtype;
  v_count integer;
  v_expected_count integer;
  v_canonical_digest text;
  v_start date;
  v_end date;
  v_previous_end date;
begin
  if p_import_id is null
     or p_chunk_index is null
     or p_chunk_index not between 0 and 7
     or p_chunk_digest is null
     or p_chunk_digest !~ '^[0-9a-f]{64}$'
     or p_observations is null
     or jsonb_typeof(p_observations) <> 'array' then
    raise exception 'Invalid metric CSV chunk.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_observations);
  if v_count not between 1 and 250 then
    raise exception 'Import chunks must contain one to 250 observations.' using errcode = '22023';
  end if;
  -- The authenticated caller's digest is only an early request checksum. The
  -- database derives the durable retry identity from canonical jsonb so a
  -- forged digest cannot make changed observations look like an exact retry.
  v_canonical_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_observations::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select job.*
    into v_hint
    from public.metric_csv_import_jobs as job
   where job.import_id = p_import_id;
  if not found then
    raise exception 'The import receipt is unavailable.' using errcode = '42501';
  end if;

  if v_hint.target_kind = 'report_metric' then
    select * into v_metric
      from private.lock_current_report_metric_for_csv_import(
        v_hint.scope_id,
        v_hint.report_id,
        v_hint.metric_id,
        p_authored_by
      );
  else
    perform private.assert_decision_report_write(v_hint.scope_id, p_authored_by);
    perform 1
      from public.workspaces as workspace
     where workspace.workspace_id = v_hint.scope_id
     for update;
    if not found then
      raise exception 'The import receipt is unavailable.' using errcode = '42501';
    end if;
    select metric.*
      into v_metric
      from public.metrics as metric
     where metric.metric_id = v_hint.metric_id
       and metric.scope_id = v_hint.scope_id
     for update;
    if not found or v_metric.source = 'connector' or v_metric.granularity <> 'daily' then
      raise exception 'The import metric is unavailable.' using errcode = '42501';
    end if;
  end if;

  select job.*
    into v_job
    from public.metric_csv_import_jobs as job
   where job.import_id = p_import_id
   for update;
  if not found or v_job.scope_id is distinct from v_hint.scope_id
     or v_job.target_kind is distinct from v_hint.target_kind then
    raise exception 'The import receipt is unavailable.' using errcode = '42501';
  end if;

  if p_chunk_index * 250 >= v_job.total_rows then
    raise exception 'The import chunk is outside its receipt.' using errcode = 'C4090';
  end if;
  v_expected_count := least(250, v_job.total_rows - (p_chunk_index * 250));
  if v_count <> v_expected_count then
    raise exception 'Every non-final import chunk must contain exactly 250 observations.'
      using errcode = '22023';
  end if;

  select chunk.*
    into v_chunk
    from private.metric_csv_import_chunks as chunk
   where chunk.import_id = p_import_id
     and chunk.chunk_index = p_chunk_index;
  if found then
    if v_chunk.chunk_digest <> v_canonical_digest or v_chunk.row_count <> v_count then
      raise exception 'The import chunk conflicts with its receipt.' using errcode = 'C4090';
    end if;
    return query select
      v_job.import_id,
      v_job.status,
      v_job.processed_rows,
      v_job.total_rows,
      v_job.next_chunk_index,
      v_job.inserted_rows,
      v_job.updated_rows,
      true;
    return;
  end if;

  if v_job.status = 'complete'
     or p_chunk_index <> v_job.next_chunk_index
     or v_job.processed_rows <> p_chunk_index * 250
     or v_job.processed_rows + v_count > v_job.total_rows then
    raise exception 'The import chunk is stale or out of order.' using errcode = 'C4090';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_observations) with ordinality as item(value, position)
     where jsonb_typeof(item.value) is distinct from 'object'
        or (item.value - array['date', 'value']::text[]) <> '{}'::jsonb
        or jsonb_typeof(item.value->'date') is distinct from 'string'
        or jsonb_typeof(item.value->'value') is distinct from 'number'
        or private.metric_csv_date_or_null(item.value->>'date') is null
  ) then
    raise exception 'Every observation must contain only a date and finite numeric value.' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_observations) as item(value)
     where abs((item.value->>'value')::numeric) > 1000000000000000
  ) then
    raise exception 'Every observation must contain only a date and finite numeric value.' using errcode = '22023';
  end if;

  if (
    select count(distinct private.metric_csv_date_or_null(item.value->>'date'))
      from jsonb_array_elements(p_observations) as item(value)
  ) <> v_count
  or exists (
    select 1
      from (
        select
          item.position,
          private.metric_csv_date_or_null(item.value->>'date') as obs_date,
          lag(private.metric_csv_date_or_null(item.value->>'date')) over (order by item.position) as previous_date
        from jsonb_array_elements(p_observations) with ordinality as item(value, position)
      ) ordered
     where ordered.previous_date is not null
       and ordered.obs_date <= ordered.previous_date
  ) then
    raise exception 'Each chunk must contain unique dates in ascending order.' using errcode = '22023';
  end if;

  select min(private.metric_csv_date_or_null(item.value->>'date')),
         max(private.metric_csv_date_or_null(item.value->>'date'))
    into v_start, v_end
    from jsonb_array_elements(p_observations) as item(value);
  select max(chunk.end_date)
    into v_previous_end
    from private.metric_csv_import_chunks as chunk
   where chunk.import_id = p_import_id;

  if (p_chunk_index = 0 and v_start <> v_job.start_date)
     or (v_previous_end is not null and v_start <= v_previous_end)
     or (v_job.processed_rows + v_count = v_job.total_rows and v_end <> v_job.end_date) then
    raise exception 'The import chunk date range conflicts with its receipt.' using errcode = 'C4090';
  end if;

  insert into private.metric_csv_import_staging (import_id, obs_date, value)
  select p_import_id,
         private.metric_csv_date_or_null(item.value->>'date'),
         (item.value->>'value')::numeric
    from jsonb_array_elements(p_observations) as item(value)
  order by private.metric_csv_date_or_null(item.value->>'date');

  insert into private.metric_csv_import_chunks (
    import_id,
    chunk_index,
    chunk_digest,
    row_count,
    start_date,
    end_date
  ) values (
    p_import_id,
    p_chunk_index,
    v_canonical_digest,
    v_count,
    v_start,
    v_end
  );

  update public.metric_csv_import_jobs as job
     set status = 'in_progress',
         processed_rows = job.processed_rows + v_count,
         next_chunk_index = job.next_chunk_index + 1,
         updated_at = now()
   where job.import_id = p_import_id
   returning job.* into v_job;

  return query select
    v_job.import_id,
    v_job.status,
    v_job.processed_rows,
    v_job.total_rows,
    v_job.next_chunk_index,
    v_job.inserted_rows,
    v_job.updated_rows,
    false;
end;
$$;

create function public.finalize_metric_csv_import_v2(
  p_import_id uuid,
  p_authored_by uuid
)
returns table (
  import_id uuid,
  import_status text,
  metric_id uuid,
  metric_name text,
  metric_unit text,
  metric_created boolean,
  total_rows integer,
  processed_rows integer,
  inserted_rows integer,
  updated_rows integer,
  start_date date,
  end_date date,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hint public.metric_csv_import_jobs%rowtype;
  v_job public.metric_csv_import_jobs%rowtype;
  v_metric public.metrics%rowtype;
  v_was_complete boolean;
  v_staged integer;
  v_existing integer;
begin
  if p_import_id is null then
    raise exception 'The import receipt is unavailable.' using errcode = '42501';
  end if;
  select job.*
    into v_hint
    from public.metric_csv_import_jobs as job
   where job.import_id = p_import_id;
  if not found then
    raise exception 'The import receipt is unavailable.' using errcode = '42501';
  end if;

  if v_hint.target_kind = 'report_metric' then
    select * into v_metric
      from private.lock_current_report_metric_for_csv_import(
        v_hint.scope_id,
        v_hint.report_id,
        v_hint.metric_id,
        p_authored_by
      );
  else
    perform private.assert_decision_report_write(v_hint.scope_id, p_authored_by);
    perform 1
      from public.workspaces as workspace
     where workspace.workspace_id = v_hint.scope_id
     for update;
    if not found then
      raise exception 'The import receipt is unavailable.' using errcode = '42501';
    end if;
    select metric.*
      into v_metric
      from public.metrics as metric
     where metric.metric_id = v_hint.metric_id
       and metric.scope_id = v_hint.scope_id
     for update;
    if not found or v_metric.source = 'connector' or v_metric.granularity <> 'daily' then
      raise exception 'The import metric is unavailable.' using errcode = '42501';
    end if;
  end if;

  select job.*
    into v_job
    from public.metric_csv_import_jobs as job
   where job.import_id = p_import_id
   for update;
  if not found or v_job.scope_id is distinct from v_hint.scope_id
     or v_job.target_kind is distinct from v_hint.target_kind then
    raise exception 'The import receipt is unavailable.' using errcode = '42501';
  end if;
  v_was_complete := v_job.status = 'complete';

  if not v_was_complete then
    if v_job.processed_rows <> v_job.total_rows then
      raise exception 'The import receipt is incomplete.' using errcode = 'C4090';
    end if;

    select count(*)
      into v_staged
      from private.metric_csv_import_staging as staged
     where staged.import_id = p_import_id;
    if v_staged <> v_job.total_rows then
      raise exception 'The staged import does not match its receipt.' using errcode = 'C4090';
    end if;

    select count(*)
      into v_existing
      from public.metric_observations as observation
      join private.metric_csv_import_staging as staged
        on staged.import_id = p_import_id
       and staged.obs_date = observation.obs_date
     where observation.metric_id = v_job.metric_id;

    insert into public.metric_observations (metric_id, obs_date, value)
    select v_job.metric_id, staged.obs_date, staged.value
      from private.metric_csv_import_staging as staged
     where staged.import_id = p_import_id
     order by staged.obs_date
    on conflict on constraint metric_observations_pkey do update
      set value = excluded.value;

    update public.metrics as metric
       set source = 'csv'
     where metric.metric_id = v_job.metric_id
       and metric.scope_id = v_job.scope_id;
    if not found then
      raise exception 'The import metric is unavailable.' using errcode = '42501';
    end if;

    update public.metric_csv_import_jobs as job
       set status = 'complete',
           inserted_rows = v_job.total_rows - v_existing,
           updated_rows = v_existing,
           completed_at = now(),
           updated_at = now()
     where job.import_id = p_import_id
     returning job.* into v_job;

    delete from private.metric_csv_import_staging as staged
     where staged.import_id = p_import_id;
  end if;

  return query select
    v_job.import_id,
    v_job.status,
    v_job.metric_id,
    v_job.metric_name,
    v_job.metric_unit,
    v_job.metric_created,
    v_job.total_rows,
    v_job.processed_rows,
    v_job.inserted_rows,
    v_job.updated_rows,
    v_job.start_date,
    v_job.end_date,
    v_was_complete;
end;
$$;

revoke all on function public.begin_workspace_metric_csv_import_v2(
  uuid, text, text, text, integer, date, date, uuid
) from public, anon;
grant execute on function public.begin_workspace_metric_csv_import_v2(
  uuid, text, text, text, integer, date, date, uuid
) to authenticated, service_role;

revoke all on function public.begin_report_metric_csv_import_v2(
  uuid, uuid, uuid, text, integer, date, date, uuid
) from public, anon;
grant execute on function public.begin_report_metric_csv_import_v2(
  uuid, uuid, uuid, text, integer, date, date, uuid
) to authenticated, service_role;

revoke all on function public.append_metric_csv_import_chunk_v2(
  uuid, integer, text, jsonb, uuid
) from public, anon;
grant execute on function public.append_metric_csv_import_chunk_v2(
  uuid, integer, text, jsonb, uuid
) to authenticated, service_role;

revoke all on function public.finalize_metric_csv_import_v2(uuid, uuid)
  from public, anon;
grant execute on function public.finalize_metric_csv_import_v2(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
