-- MVP completion contracts.
--
-- Keep Decision Report lifecycle telemetry append-only, expose only a
-- sanitized status for the explicitly current causal-recompute target, and
-- reject newly activated predictions whose resolution window has already
-- closed. The private queue itself remains ungranted and is never exposed.

alter table public.funnel_events
  drop constraint funnel_events_event_type_check,
  add constraint funnel_events_event_type_check check (event_type in (
    'LANDED',
    'STEP_VIEW',
    'FIRST_TYPE',
    'STRUCTURED',
    'COMMITTED',
    'SHIP_STATE',
    'SCORECARD_VIEW',
    'REPORT_LANDED',
    'REPORT_GENERATION_STARTED',
    'REPORT_EDITABLE',
    'REPORT_GENERATION_FAILED',
    'REPORT_SAVED',
    'REPORT_SAVE_FAILED',
    'REPORT_ACTIVATED',
    'REPORT_ACTIVATION_FAILED'
  ));

-- Earlier Supabase defaults may leave UPDATE/DELETE/TRUNCATE privileges even
-- when no matching RLS policy exists. TRUNCATE bypasses row policies entirely,
-- so make the append-only contract explicit at the privilege layer too.
revoke all on public.funnel_events from anon, authenticated;
grant select, insert on public.funnel_events to authenticated;

create function private.require_future_decision_report_resolution_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.prediction_resolution_date <=
     (pg_catalog.statement_timestamp() at time zone 'UTC')::date then
    raise exception 'Prediction resolution date must be in the future.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger decision_report_activations_future_resolution_date
before insert on public.decision_report_activations
for each row execute function private.require_future_decision_report_resolution_date();

revoke all on function private.require_future_decision_report_resolution_date()
  from public, anon, authenticated, service_role;

create function public.get_current_causal_recompute_status_v1(
  p_scope_id uuid
)
returns table (
  status text,
  requested_at timestamptz,
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
    case
      when job.activation_id is null then 'idle'
      when job.processed_generation < job.requested_generation
           and job.attempts > 0 then 'retrying'
      when job.processed_generation < job.requested_generation then 'queued'
      when job.last_error_code is not null then 'failed'
      else 'current'
    end as status,
    job.requested_at,
    job.last_processed_at,
    case
      when job.processed_generation < job.requested_generation
        then job.next_attempt_at
      else null
    end as next_attempt_at
  from public.workspaces as workspace
  join public.decision_report_series as series
    on series.series_id = workspace.current_decision_report_series_id
   and series.scope_id = workspace.workspace_id
  join public.decision_reports as report
    on report.report_id = series.current_active_report_id
   and report.series_id = series.series_id
   and report.scope_id = workspace.workspace_id
   and report.status = 'active'
   and report.deleted_at is null
  join public.decision_report_activations as activation
    on activation.activation_id = report.active_activation_id
   and activation.report_id = report.report_id
   and activation.scope_id = report.scope_id
   and activation.metric_id = report.active_metric_id
  left join private.causal_recompute_jobs as job
    on job.activation_id = activation.activation_id
   and job.scope_id = workspace.workspace_id
   and job.report_id = report.report_id
   and job.metric_id = activation.metric_id
  where workspace.workspace_id = p_scope_id;
end;
$$;

revoke all on function public.get_current_causal_recompute_status_v1(uuid)
  from public, anon;
grant execute on function public.get_current_causal_recompute_status_v1(uuid)
  to authenticated, service_role;
