-- Decision Report Slice 5 — explicit, idempotent activation into the
-- canonical prospective graph.
--
-- A reviewed report remains editable until the user explicitly activates it.
-- Activation is one checked transaction: it creates a decision, the human's
-- prediction, and 1-3 selected planned actions, then locks the report at that
-- exact revision. It does NOT create a lever, causal edge, evidence object, or
-- impact claim. Identical retries return the original canonical identities;
-- changed retries fail with an immediate HTTP 409.

alter table public.decision_reports
  drop constraint decision_reports_status_check;
alter table public.decision_reports
  add constraint decision_reports_status_check
  check (status in ('draft', 'report_ready', 'active'));

create table public.decision_report_activations (
  activation_id                  uuid primary key default gen_random_uuid(),
  report_id                      uuid not null,
  revision_id                    uuid not null,
  scope_id                       uuid not null references public.workspaces(workspace_id) on delete cascade,
  input_hash                     text not null check (input_hash ~ '^[0-9a-f]{32}$'),
  metric_id                      uuid not null references public.metrics(metric_id) on delete restrict,
  prediction_direction           text not null check (prediction_direction in ('POSITIVE', 'NEGATIVE')),
  prediction_magnitude_pct_mean  real not null check (prediction_magnitude_pct_mean > 0),
  prediction_resolution_date     date not null,
  selected_action_source_ids     text[] not null check (
    cardinality(selected_action_source_ids) between 1 and 3
  ),
  decision_id                    uuid not null references public.decisions(decision_id) on delete restrict,
  prediction_id                  uuid not null references public.predictions(prediction_id) on delete restrict,
  action_ids                     uuid[] not null check (cardinality(action_ids) between 1 and 3),
  activated_by                   uuid references auth.users(id) on delete set null,
  activated_at                   timestamptz not null default now(),
  unique (report_id),
  unique (report_id, revision_id),
  foreign key (report_id, scope_id)
    references public.decision_reports(report_id, scope_id) on delete restrict,
  foreign key (report_id, revision_id)
    references public.decision_report_revisions(report_id, revision_id) on delete restrict
);

create index decision_report_activations_scope_created_idx
  on public.decision_report_activations(scope_id, activated_at desc);

alter table public.decision_reports
  add column active_activation_id uuid
    references public.decision_report_activations(activation_id) on delete restrict,
  add column active_decision_id uuid
    references public.decisions(decision_id) on delete restrict,
  add column active_prediction_id uuid
    references public.predictions(prediction_id) on delete restrict,
  add column active_metric_id uuid
    references public.metrics(metric_id) on delete restrict,
  add column activated_by uuid references auth.users(id) on delete set null,
  add column activated_at timestamptz;

alter table public.decision_reports
  add constraint decision_reports_activation_state_check check (
    (status <> 'active' and active_activation_id is null and active_decision_id is null
      and active_prediction_id is null and active_metric_id is null
      and activated_by is null and activated_at is null)
    or
    (status = 'active' and active_activation_id is not null and active_decision_id is not null
      and active_prediction_id is not null and active_metric_id is not null
      and activated_at is not null)
  );

alter table public.decision_report_activations enable row level security;

create policy decision_report_activations_select
  on public.decision_report_activations
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

-- Activation history is application-read-only. The checked function below is
-- the only app write path, which keeps the audit row append-only.
revoke all on public.decision_report_activations from anon, authenticated;
grant select on public.decision_report_activations to authenticated, service_role;

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
  v_report public.decision_reports%rowtype;
  v_revision public.decision_report_revisions%rowtype;
  v_existing public.decision_report_activations%rowtype;
  v_metric_name text;
  v_input_hash text;
  v_selected_count integer;
  v_matched_count integer;
  v_activation_id uuid := gen_random_uuid();
  v_decision_id uuid := gen_random_uuid();
  v_prediction_id uuid := gen_random_uuid();
  v_action_id uuid;
  v_action_ids uuid[] := array[]::uuid[];
  v_action jsonb;
  v_decision_content jsonb;
  v_action_content jsonb;
  v_activated_at timestamptz := now();
begin
  if p_report_id is null or p_revision_id is null or p_metric_id is null then
    raise exception 'Activation identities are required.' using errcode = '22023';
  end if;
  if p_prediction_direction not in ('POSITIVE', 'NEGATIVE') then
    raise exception 'Prediction direction is invalid.' using errcode = '22023';
  end if;
  if p_prediction_magnitude_pct_mean is null
     or p_prediction_magnitude_pct_mean <= 0
     or p_prediction_magnitude_pct_mean::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Prediction magnitude must be a positive finite number.' using errcode = '22023';
  end if;
  if p_prediction_resolution_date is null then
    raise exception 'Prediction resolution date is required.' using errcode = '22023';
  end if;

  v_selected_count := coalesce(cardinality(p_selected_action_source_ids), 0);
  if v_selected_count not between 1 and 3
     or exists (
       select 1
       from unnest(coalesce(p_selected_action_source_ids, array[]::text[])) as selected(source_id)
       where btrim(coalesce(selected.source_id, '')) = ''
     )
     or exists (
       select 1
       from unnest(coalesce(p_selected_action_source_ids, array[]::text[])) as selected(source_id)
       group by selected.source_id
       having count(*) > 1
     ) then
    raise exception 'Select one to three unique report actions.' using errcode = '22023';
  end if;

  select * into v_report
  from public.decision_reports
  where decision_reports.report_id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;

  perform private.assert_decision_report_write(v_report.scope_id, p_activated_by);

  select metrics.name into v_metric_name
  from public.metrics
  where metrics.metric_id = p_metric_id
    and metrics.scope_id = v_report.scope_id;
  if not found then
    raise exception 'Metric not found in this workspace.' using errcode = '42501';
  end if;

  select array_agg(selected.source_id order by selected.source_id)
  into p_selected_action_source_ids
  from unnest(p_selected_action_source_ids) as selected(source_id);

  v_input_hash := md5(jsonb_build_object(
    'reportId', p_report_id,
    'revisionId', p_revision_id,
    'metricId', p_metric_id,
    'predictionDirection', p_prediction_direction,
    'predictionMagnitudePctMean', p_prediction_magnitude_pct_mean,
    'predictionResolutionDate', p_prediction_resolution_date,
    'selectedActionSourceIds', to_jsonb(p_selected_action_source_ids)
  )::text);

  select * into v_existing
  from public.decision_report_activations
  where decision_report_activations.report_id = v_report.report_id;

  if found then
    if v_existing.input_hash <> v_input_hash then
      raise exception 'REPORT_ALREADY_ACTIVE'
        using errcode = 'PT409', detail = v_existing.activation_id::text;
    end if;
    if v_report.status <> 'active'
       or v_report.active_activation_id is distinct from v_existing.activation_id then
      raise exception 'Report activation state is inconsistent.' using errcode = '55000';
    end if;
    return query
    select
      v_existing.activation_id,
      v_existing.decision_id,
      v_existing.prediction_id,
      v_existing.action_ids,
      true,
      v_existing.activated_at;
    return;
  end if;

  if v_report.status <> 'report_ready'
     or v_report.current_revision_id is distinct from p_revision_id
     or v_report.reviewed_revision_id is distinct from p_revision_id then
    raise exception 'The exact reviewed report revision must be saved before activation.'
      using errcode = '22023';
  end if;

  select * into v_revision
  from public.decision_report_revisions
  where decision_report_revisions.report_id = v_report.report_id
    and decision_report_revisions.revision_id = p_revision_id;
  if not found then
    raise exception 'Reviewed report revision not found.' using errcode = '22023';
  end if;

  select count(*) into v_matched_count
  from jsonb_array_elements(v_revision.snapshot #> '{implementation,actions}') as report_action(value)
  where report_action.value->>'sourceItemId' = any(p_selected_action_source_ids);

  if v_matched_count <> v_selected_count
     or exists (
       select 1
       from jsonb_array_elements(v_revision.snapshot #> '{implementation,actions}') as report_action(value)
       where report_action.value->>'sourceItemId' = any(p_selected_action_source_ids)
       group by report_action.value->>'sourceItemId'
       having count(*) <> 1
     ) then
    raise exception 'Every selected action must exist exactly once in the reviewed report.'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(paragraph order by section_order, item_order), '[]'::jsonb)
  into v_decision_content
  from (
    select
      section_order,
      item_order,
      jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', claim->>'text'))
      ) as paragraph
    from (
      select 1 as section_order, ordinality as item_order, claim
      from jsonb_array_elements(v_revision.snapshot #> '{decision,decision}') with ordinality as item(claim, ordinality)
      union all
      select 2, ordinality, claim
      from jsonb_array_elements(v_revision.snapshot #> '{decision,background}') with ordinality as item(claim, ordinality)
      union all
      select 3, ordinality, claim
      from jsonb_array_elements(v_revision.snapshot #> '{decision,problem}') with ordinality as item(claim, ordinality)
      union all
      select 4, ordinality, claim
      from jsonb_array_elements(v_revision.snapshot #> '{supportingEvidence,factors}') with ordinality as item(claim, ordinality)
      union all
      select 5, ordinality, claim
      from jsonb_array_elements(v_revision.snapshot #> '{supportingEvidence,metricMechanism}') with ordinality as item(claim, ordinality)
    ) as claims
    where coalesce(claim->>'status', '') <> 'missing'
      and btrim(coalesce(claim->>'text', '')) <> ''
  ) as paragraphs;

  insert into public.decisions (
    decision_id,
    scope_id,
    title,
    rationale,
    created_by,
    created_at
  ) values (
    v_decision_id,
    v_report.scope_id,
    v_revision.snapshot->>'title',
    jsonb_build_object(
      'type', 'doc',
      'content', v_decision_content,
      'meta', jsonb_build_object(
        'source', 'decision_report',
        'source_report_id', v_report.report_id,
        'source_revision_id', v_revision.revision_id,
        'mechanism_category', 'decision_report'
      )
    ),
    p_activated_by,
    v_activated_at
  );

  insert into public.predictions (
    prediction_id,
    scope_id,
    decision_id,
    metric_id,
    direction,
    magnitude_pct_mean,
    resolution_date,
    committed_by,
    committed_at
  ) values (
    v_prediction_id,
    v_report.scope_id,
    v_decision_id,
    p_metric_id,
    p_prediction_direction,
    p_prediction_magnitude_pct_mean,
    p_prediction_resolution_date,
    p_activated_by,
    v_activated_at
  );

  for v_action in
    select report_action.value
    from jsonb_array_elements(v_revision.snapshot #> '{implementation,actions}')
      with ordinality as report_action(value, ordinality)
    where report_action.value->>'sourceItemId' = any(p_selected_action_source_ids)
    order by report_action.ordinality
  loop
    v_action_id := gen_random_uuid();
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', summary->>'text'))
      ) order by ordinality
    ), '[]'::jsonb)
    into v_action_content
    from jsonb_array_elements(v_action->'summary') with ordinality as item(summary, ordinality)
    where coalesce(summary->>'status', '') <> 'missing'
      and btrim(coalesce(summary->>'text', '')) <> '';

    insert into public.actions (
      action_id,
      scope_id,
      source,
      external_ref,
      owner_id,
      status,
      rationale_richtext
    ) values (
      v_action_id,
      v_report.scope_id,
      'manual',
      'decision-report:' || v_report.report_id::text || ':' || md5(v_action->>'sourceItemId'),
      null,
      'planned',
      jsonb_build_object(
        'type', 'doc',
        'title', v_action->>'title',
        'content', v_action_content,
        'meta', jsonb_build_object(
          'source', 'decision_report',
          'source_report_id', v_report.report_id,
          'source_revision_id', v_revision.revision_id,
          'source_item_id', v_action->>'sourceItemId',
          'owner_label', nullif(btrim(coalesce(v_action #>> '{owner,text}', '')), ''),
          'expected_metric', v_metric_name
        )
      )
    );

    insert into public.decision_actions (decision_id, action_id)
    values (v_decision_id, v_action_id);

    v_action_ids := array_append(v_action_ids, v_action_id);
  end loop;

  insert into public.decision_report_activations (
    activation_id,
    report_id,
    revision_id,
    scope_id,
    input_hash,
    metric_id,
    prediction_direction,
    prediction_magnitude_pct_mean,
    prediction_resolution_date,
    selected_action_source_ids,
    decision_id,
    prediction_id,
    action_ids,
    activated_by,
    activated_at
  ) values (
    v_activation_id,
    v_report.report_id,
    v_revision.revision_id,
    v_report.scope_id,
    v_input_hash,
    p_metric_id,
    p_prediction_direction,
    p_prediction_magnitude_pct_mean,
    p_prediction_resolution_date,
    p_selected_action_source_ids,
    v_decision_id,
    v_prediction_id,
    v_action_ids,
    p_activated_by,
    v_activated_at
  );

  update public.decision_reports
  set status = 'active',
      active_activation_id = v_activation_id,
      active_decision_id = v_decision_id,
      active_prediction_id = v_prediction_id,
      active_metric_id = p_metric_id,
      activated_by = p_activated_by,
      activated_at = v_activated_at,
      updated_at = v_activated_at
  where decision_reports.report_id = v_report.report_id;

  return query
  select
    v_activation_id,
    v_decision_id,
    v_prediction_id,
    v_action_ids,
    false,
    v_activated_at;
end;
$$;

-- Once active, a report is an immutable historical input to the canonical
-- graph. Editing starts with a new report rather than mutating audited intent.
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

  if v_report.status = 'active' then
    raise exception 'REPORT_ALREADY_ACTIVE'
      using errcode = 'PT409', detail = v_report.active_activation_id::text;
  end if;

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

revoke all on function public.activate_decision_report_v1(
  uuid, uuid, uuid, text, real, date, text[], uuid
) from public;
grant execute on function public.activate_decision_report_v1(
  uuid, uuid, uuid, text, real, date, text[], uuid
) to authenticated, service_role;

notify pgrst, 'reload schema';
