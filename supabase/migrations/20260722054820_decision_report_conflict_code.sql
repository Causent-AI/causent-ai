-- A stale base revision is an application conflict, not a database
-- serialization failure. PT409 tells PostgREST to respond immediately with
-- HTTP 409 instead of retrying the transaction for roughly 60 seconds.
create or replace function public.append_decision_report_revision_v1(
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
      using errcode = 'PT409', detail = v_current.revision_id::text;
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
