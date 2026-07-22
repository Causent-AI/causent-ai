-- Slice 7: one checked, idempotent CSV observation import for the metric bound
-- to an activated Decision Report. The client cannot select an arbitrary target:
-- report, scope, and metric must still match under a row lock inside this RPC.

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
  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'Observations must be a JSON array.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_observations);
  if v_count not between 1 and 10000 then
    raise exception 'Import one to 10,000 daily observations.' using errcode = '22023';
  end if;

  select * into v_report
  from public.decision_reports
  where decision_reports.report_id = p_report_id
    and decision_reports.scope_id = p_scope_id
  for update;
  if not found then
    raise exception 'The active report metric is unavailable in this workspace.' using errcode = '42501';
  end if;
  perform private.assert_decision_report_write(v_report.scope_id, p_authored_by);
  if v_report.status <> 'active' or v_report.active_metric_id is null then
    raise exception 'Activate a Decision Report before importing its metric CSV.' using errcode = 'P0002';
  end if;
  if v_report.active_metric_id is distinct from p_metric_id then
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

  for v_item in select value from jsonb_array_elements(p_observations)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item - array['date', 'value']::text[]) <> '{}'::jsonb
       or jsonb_typeof(v_item->'date') <> 'string'
       or jsonb_typeof(v_item->'value') <> 'number'
       or (v_item->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Every observation must contain only a YYYY-MM-DD date and finite numeric value.' using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct observation.date_value)
    from (
      select (item->>'date')::date as date_value
      from jsonb_array_elements(p_observations) as items(item)
    ) observation
  ) <> v_count then
    raise exception 'Each daily date must appear exactly once.' using errcode = '22023';
  end if;

  select min(observation.date_value), max(observation.date_value)
  into v_start, v_end
  from (
    select (item->>'date')::date as date_value
    from jsonb_array_elements(p_observations) as items(item)
  ) observation;

  select count(*) into v_existing
  from public.metric_observations
  where metric_observations.metric_id = p_metric_id
    and metric_observations.obs_date in (
      select (item->>'date')::date
      from jsonb_array_elements(p_observations) as items(item)
    );

  insert into public.metric_observations (metric_id, obs_date, value)
  select p_metric_id, (item->>'date')::date, (item->>'value')::numeric
  from jsonb_array_elements(p_observations) as items(item)
  on conflict (metric_id, obs_date) do update
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
