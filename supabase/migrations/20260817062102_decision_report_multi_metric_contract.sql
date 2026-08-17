-- Contract phase: atomically switch the validated compatibility constraints,
-- remove the rollout-only worker, and expose the checked v3 activation RPC.

set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.decision_report_activations
  drop constraint decision_report_activations_selected_action_source_ids_check,
  drop constraint decision_report_activations_action_ids_check,
  drop constraint decision_report_activations_input_hash_check;

alter table public.decision_report_activations
  rename constraint decision_report_activations_selected_action_source_ids_v3_check
    to decision_report_activations_selected_action_source_ids_check;
alter table public.decision_report_activations
  rename constraint decision_report_activations_action_ids_v3_check
    to decision_report_activations_action_ids_check;
alter table public.decision_report_activations
  rename constraint decision_report_activations_input_hash_v3_check
    to decision_report_activations_input_hash_check;

drop function private.backfill_decision_report_multi_metric_v1(integer, uuid);

create function public.activate_decision_report_v3(
  p_report_id uuid,
  p_revision_id uuid,
  p_primary_metric_id uuid,
  p_selected_metric_ids uuid[],
  p_prediction_direction text,
  p_prediction_magnitude_pct_mean real,
  p_prediction_resolution_date date,
  p_selected_action_source_ids text[],
  p_action_metric_assignments jsonb,
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
  v_report public.decision_reports%rowtype;
  v_revision public.decision_report_revisions%rowtype;
  v_existing public.decision_report_activations%rowtype;
  v_selected_metric_ids uuid[];
  v_selected_action_source_ids text[];
  v_assignments jsonb;
  v_primary_source text := pg_catalog.btrim(coalesce(p_primary_lever_source_id, ''));
  v_selected_metric_count integer;
  v_selected_action_count integer;
  v_matched_count integer;
  v_selected_metric record;
  v_has_non_daily_metric boolean := false;
  v_series_current_report_id uuid;
  v_workspace_current_series_id uuid;
  v_input_hash text;
  v_activation_id uuid := gen_random_uuid();
  v_decision_id uuid := gen_random_uuid();
  v_prediction_id uuid := gen_random_uuid();
  v_action_id uuid;
  v_action_ids uuid[] := array[]::uuid[];
  v_primary_action_id uuid;
  v_action_metric_id uuid;
  v_action_metric_name text;
  v_action jsonb;
  v_decision_content jsonb;
  v_action_content jsonb;
  v_activated_at timestamptz := now();
begin
  if p_report_id is null or p_revision_id is null or p_primary_metric_id is null then
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

  v_selected_metric_count := coalesce(cardinality(p_selected_metric_ids), 0);
  if v_selected_metric_count not between 1 and 5
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_selected_metric_ids, array[]::uuid[]))
         as selected(metric_id)
       where selected.metric_id is null
     )
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_selected_metric_ids, array[]::uuid[]))
         as selected(metric_id)
       group by selected.metric_id
       having count(*) > 1
     )
     or not (p_primary_metric_id = any(coalesce(p_selected_metric_ids, array[]::uuid[]))) then
    raise exception 'Choose one to five unique metrics including the primary metric.'
      using errcode = '22023';
  end if;

  v_selected_action_count := coalesce(cardinality(p_selected_action_source_ids), 0);
  if v_selected_action_count not between 1 and 25
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_selected_action_source_ids, array[]::text[]))
         as selected(source_id)
       where pg_catalog.btrim(coalesce(selected.source_id, '')) = ''
          or pg_catalog.char_length(selected.source_id) > 500
          or selected.source_id ~ '[[:cntrl:]]'
     )
     or exists (
       select 1
       from pg_catalog.unnest(coalesce(p_selected_action_source_ids, array[]::text[]))
         as selected(source_id)
       group by selected.source_id
       having count(*) > 1
     ) then
    raise exception 'Select one to twenty-five unique report actions.' using errcode = '22023';
  end if;
  if v_primary_source = ''
     or not (v_primary_source = any(p_selected_action_source_ids)) then
    raise exception 'Choose one selected action as the primary lever.' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_action_metric_assignments) is distinct from 'array' then
    raise exception 'Provide one valid metric assignment for every selected action.'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_action_metric_assignments) <> v_selected_action_count then
    raise exception 'Provide one valid metric assignment for every selected action.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_action_metric_assignments) as assignment(value)
    where pg_catalog.jsonb_typeof(assignment.value) is distinct from 'object'
  ) then
    raise exception 'Provide one valid metric assignment for every selected action.'
      using errcode = '22023';
  end if;

  if exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_action_metric_assignments) as assignment(value)
       where pg_catalog.jsonb_typeof(assignment.value->'actionSourceItemId') is distinct from 'string'
          or pg_catalog.jsonb_typeof(assignment.value->'metricId') is distinct from 'string'
          or (
            select count(*)
            from pg_catalog.jsonb_object_keys(assignment.value)
          ) <> 2
          or pg_catalog.btrim(coalesce(assignment.value->>'actionSourceItemId', '')) = ''
          or pg_catalog.char_length(assignment.value->>'actionSourceItemId') > 500
          or assignment.value->>'actionSourceItemId' ~ '[[:cntrl:]]'
          or coalesce(assignment.value->>'metricId', '') !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ) then
    raise exception 'Provide one valid metric assignment for every selected action.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_action_metric_assignments) as assignment(value)
    group by assignment.value->>'actionSourceItemId'
    having count(*) > 1
  )
  or exists (
    select 1
    from pg_catalog.unnest(p_selected_action_source_ids) as selected(source_id)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_action_metric_assignments) as assignment(value)
      where assignment.value->>'actionSourceItemId' = selected.source_id
    )
  )
  or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_action_metric_assignments) as assignment(value)
    where not (assignment.value->>'actionSourceItemId' = any(p_selected_action_source_ids))
       or not ((assignment.value->>'metricId')::uuid = any(p_selected_metric_ids))
  ) then
    raise exception 'Action metric assignments must match the selected actions and metrics.'
      using errcode = '22023';
  end if;

  perform 1
  from pg_catalog.jsonb_array_elements(p_action_metric_assignments) as assignment(value)
  where assignment.value->>'actionSourceItemId' = v_primary_source
    and (assignment.value->>'metricId')::uuid = p_primary_metric_id;
  if not found then
    raise exception 'The primary lever action must use the primary metric.' using errcode = '22023';
  end if;

  select pg_catalog.array_agg(selected.metric_id order by selected.metric_id::text)
  into v_selected_metric_ids
  from pg_catalog.unnest(p_selected_metric_ids) as selected(metric_id);

  select pg_catalog.array_agg(selected.source_id order by selected.source_id)
  into v_selected_action_source_ids
  from pg_catalog.unnest(p_selected_action_source_ids) as selected(source_id);

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'actionSourceItemId', assignment.value->>'actionSourceItemId',
      'metricId', (assignment.value->>'metricId')::uuid
    )
    order by assignment.value->>'actionSourceItemId'
  )
  into v_assignments
  from pg_catalog.jsonb_array_elements(p_action_metric_assignments) as assignment(value);

  select * into v_report
  from public.decision_reports as report
  where report.report_id = p_report_id
    and report.deleted_at is null
  for update;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;

  perform private.assert_decision_report_write(v_report.scope_id, p_activated_by);

  select series.current_active_report_id into v_series_current_report_id
  from public.decision_report_series as series
  where series.series_id = v_report.series_id
    and series.scope_id = v_report.scope_id
  for update;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;

  select workspace.current_decision_report_series_id into v_workspace_current_series_id
  from public.workspaces as workspace
  where workspace.workspace_id = v_report.scope_id
  for update;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;

  if (
    v_report.status = 'active'
    and (
      v_series_current_report_id is distinct from v_report.report_id
      or v_workspace_current_series_id is distinct from v_report.series_id
    )
  ) or (
    v_report.status <> 'active'
    and v_report.iteration_number > 1
    and (
      v_series_current_report_id is distinct from v_report.predecessor_report_id
      or v_workspace_current_series_id is distinct from v_report.series_id
    )
  ) then
    raise exception 'STALE_ITERATION_PARENT'
      using errcode = 'PT409', detail = coalesce(v_series_current_report_id::text, '');
  end if;

  v_input_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'reportId', p_report_id,
    'revisionId', p_revision_id,
    'primaryMetricId', p_primary_metric_id,
    'selectedMetricIds', pg_catalog.to_jsonb(v_selected_metric_ids),
    'predictionDirection', p_prediction_direction,
    'predictionMagnitudePctMean', p_prediction_magnitude_pct_mean,
    'predictionResolutionDate', p_prediction_resolution_date,
    'selectedActionSourceIds', pg_catalog.to_jsonb(v_selected_action_source_ids),
    'actionMetricAssignments', v_assignments,
    'primaryLeverSourceId', v_primary_source
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  select * into v_existing
  from public.decision_report_activations as activation
  where activation.report_id = v_report.report_id;

  if found then
    if v_existing.contract_version <> 2 or v_existing.input_hash <> v_input_hash then
      raise exception 'REPORT_ALREADY_ACTIVE'
        using errcode = 'PT409', detail = v_existing.activation_id::text;
    end if;
    if v_report.status <> 'active'
       or v_report.active_activation_id is distinct from v_existing.activation_id
       or v_existing.primary_lever_source_id is distinct from v_primary_source
       or v_existing.primary_lever_action_id is null then
      raise exception 'Report activation state is inconsistent.' using errcode = '55000';
    end if;

    select count(*)::integer into v_matched_count
    from public.decision_report_activation_metrics as activation_metric
    where activation_metric.activation_id = v_existing.activation_id
      and activation_metric.scope_id = v_existing.scope_id
      and activation_metric.metric_id = any(v_selected_metric_ids);
    if v_matched_count <> v_selected_metric_count
       or exists (
         select 1
         from public.decision_report_activation_metrics as activation_metric
         where activation_metric.activation_id = v_existing.activation_id
           and not (activation_metric.metric_id = any(v_selected_metric_ids))
       ) then
      raise exception 'Report activation state is inconsistent.' using errcode = '55000';
    end if;

    select count(*)::integer into v_matched_count
    from public.decision_report_activation_action_metrics as binding
    join pg_catalog.jsonb_array_elements(v_assignments) as assignment(value)
      on assignment.value->>'actionSourceItemId' = binding.action_source_item_id
     and (assignment.value->>'metricId')::uuid = binding.metric_id
    where binding.activation_id = v_existing.activation_id
      and binding.scope_id = v_existing.scope_id;
    if v_matched_count <> v_selected_action_count
       or exists (
         select 1
         from public.decision_report_activation_action_metrics as binding
         where binding.activation_id = v_existing.activation_id
           and not (binding.action_source_item_id = any(v_selected_action_source_ids))
       ) then
      raise exception 'Report activation state is inconsistent.' using errcode = '55000';
    end if;

    return query select
      v_existing.activation_id,
      v_existing.decision_id,
      v_existing.prediction_id,
      v_existing.action_ids,
      v_existing.primary_lever_action_id,
      true,
      v_existing.activated_at;
    return;
  end if;

  -- Live metric attributes matter only for a new materialization. Exact and
  -- changed retries are decided from the immutable activation contract above,
  -- so a later catalog rename/reclassification cannot rewrite retry semantics.
  v_matched_count := 0;
  for v_selected_metric in
    select metric.metric_id, metric.granularity
    from public.metrics as metric
    where metric.scope_id = v_report.scope_id
      and metric.metric_id = any(v_selected_metric_ids)
    order by metric.metric_id
    for share
  loop
    v_matched_count := v_matched_count + 1;
    if v_selected_metric.granularity <> 'daily' then
      v_has_non_daily_metric := true;
    end if;
  end loop;
  if v_matched_count <> v_selected_metric_count then
    raise exception 'Report or metric not found or unavailable.' using errcode = '42501';
  end if;
  if v_has_non_daily_metric then
    raise exception 'Only daily metrics can be activated.' using errcode = '22023';
  end if;
  if p_prediction_resolution_date <=
     (pg_catalog.statement_timestamp() at time zone 'UTC')::date then
    raise exception 'Prediction resolution date must be in the future.' using errcode = '22023';
  end if;

  if v_report.status <> 'report_ready'
     or v_report.current_revision_id is distinct from p_revision_id
     or v_report.reviewed_revision_id is distinct from p_revision_id then
    raise exception 'The exact reviewed report revision must be saved before activation.'
      using errcode = '22023';
  end if;

  select * into v_revision
  from public.decision_report_revisions as revision
  where revision.report_id = v_report.report_id
    and revision.revision_id = p_revision_id;
  if not found then
    raise exception 'Reviewed report revision not found.' using errcode = '22023';
  end if;

  select count(*)::integer into v_matched_count
  from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{implementation,actions}')
    as report_action(value)
  where report_action.value->>'sourceItemId' = any(v_selected_action_source_ids);
  if v_matched_count <> v_selected_action_count
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{implementation,actions}')
         as report_action(value)
       where report_action.value->>'sourceItemId' = any(v_selected_action_source_ids)
       group by report_action.value->>'sourceItemId'
       having count(*) <> 1
     ) then
    raise exception 'Every selected action must exist exactly once in the reviewed report.'
      using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(paragraph order by section_order, item_order),
    '[]'::jsonb
  )
  into v_decision_content
  from (
    select
      section_order,
      item_order,
      pg_catalog.jsonb_build_object(
        'type', 'paragraph',
        'content', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type', 'text', 'text', claim->>'text')
        )
      ) as paragraph
    from (
      select 1 as section_order, ordinality as item_order, claim
      from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{decision,decision}')
        with ordinality as item(claim, ordinality)
      union all
      select 2, ordinality, claim
      from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{decision,background}')
        with ordinality as item(claim, ordinality)
      union all
      select 3, ordinality, claim
      from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{decision,problem}')
        with ordinality as item(claim, ordinality)
      union all
      select 4, ordinality, claim
      from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{supportingEvidence,factors}')
        with ordinality as item(claim, ordinality)
      union all
      select 5, ordinality, claim
      from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{supportingEvidence,metricMechanism}')
        with ordinality as item(claim, ordinality)
    ) as claims
    where coalesce(claim->>'status', '') <> 'missing'
      and pg_catalog.btrim(coalesce(claim->>'text', '')) <> ''
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
    pg_catalog.jsonb_build_object(
      'type', 'doc',
      'content', v_decision_content,
      'meta', pg_catalog.jsonb_build_object(
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
    p_primary_metric_id,
    p_prediction_direction,
    p_prediction_magnitude_pct_mean,
    p_prediction_resolution_date,
    p_activated_by,
    v_activated_at
  );

  for v_action in
    select report_action.value
    from pg_catalog.jsonb_array_elements(v_revision.snapshot #> '{implementation,actions}')
      with ordinality as report_action(value, ordinality)
    where report_action.value->>'sourceItemId' = any(v_selected_action_source_ids)
    order by report_action.ordinality
  loop
    v_action_id := gen_random_uuid();

    select (assignment.value->>'metricId')::uuid
    into strict v_action_metric_id
    from pg_catalog.jsonb_array_elements(v_assignments) as assignment(value)
    where assignment.value->>'actionSourceItemId' = v_action->>'sourceItemId';

    select metric.name into strict v_action_metric_name
    from public.metrics as metric
    where metric.metric_id = v_action_metric_id
      and metric.scope_id = v_report.scope_id;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'type', 'paragraph',
          'content', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type', 'text', 'text', summary->>'text')
          )
        ) order by ordinality
      ),
      '[]'::jsonb
    )
    into v_action_content
    from pg_catalog.jsonb_array_elements(v_action->'summary')
      with ordinality as item(summary, ordinality)
    where coalesce(summary->>'status', '') <> 'missing'
      and pg_catalog.btrim(coalesce(summary->>'text', '')) <> '';

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
      'decision-report:' || v_report.report_id::text || ':' ||
        pg_catalog.md5(v_action->>'sourceItemId'),
      null,
      'planned',
      pg_catalog.jsonb_build_object(
        'type', 'doc',
        'title', v_action->>'title',
        'content', v_action_content,
        'meta', pg_catalog.jsonb_build_object(
          'source', 'decision_report',
          'source_report_id', v_report.report_id,
          'source_revision_id', v_revision.revision_id,
          'source_item_id', v_action->>'sourceItemId',
          'owner_label', nullif(
            pg_catalog.btrim(coalesce(v_action #>> '{owner,text}', '')),
            ''
          ),
          'expected_metric', v_action_metric_name
        )
      )
    );

    insert into public.decision_actions (decision_id, action_id)
    values (v_decision_id, v_action_id);

    v_action_ids := pg_catalog.array_append(v_action_ids, v_action_id);
    if v_action->>'sourceItemId' = v_primary_source then
      v_primary_action_id := v_action_id;
    end if;
  end loop;

  if v_primary_action_id is null then
    raise exception 'Choose one selected action as the primary lever.' using errcode = '22023';
  end if;

  insert into public.decision_report_activations (
    activation_id,
    report_id,
    revision_id,
    scope_id,
    contract_version,
    input_hash,
    metric_id,
    prediction_direction,
    prediction_magnitude_pct_mean,
    prediction_resolution_date,
    selected_action_source_ids,
    decision_id,
    prediction_id,
    action_ids,
    primary_lever_source_id,
    primary_lever_action_id,
    activated_by,
    activated_at
  ) values (
    v_activation_id,
    v_report.report_id,
    v_revision.revision_id,
    v_report.scope_id,
    2,
    v_input_hash,
    p_primary_metric_id,
    p_prediction_direction,
    p_prediction_magnitude_pct_mean,
    p_prediction_resolution_date,
    v_selected_action_source_ids,
    v_decision_id,
    v_prediction_id,
    v_action_ids,
    v_primary_source,
    v_primary_action_id,
    p_activated_by,
    v_activated_at
  );

  insert into public.decision_report_activation_metrics (
    activation_id,
    scope_id,
    metric_id,
    created_at
  )
  select
    v_activation_id,
    v_report.scope_id,
    selected.metric_id,
    v_activated_at
  from pg_catalog.unnest(v_selected_metric_ids) as selected(metric_id);

  insert into public.decision_report_activation_action_metrics (
    activation_id,
    scope_id,
    action_id,
    action_source_item_id,
    action_source_item_hash,
    metric_id,
    created_at
  )
  select
    v_activation_id,
    v_report.scope_id,
    action.action_id,
    assignment.value->>'actionSourceItemId',
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          assignment.value->>'actionSourceItemId',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    (assignment.value->>'metricId')::uuid,
    v_activated_at
  from pg_catalog.jsonb_array_elements(v_assignments) as assignment(value)
  join public.actions as action
    on action.scope_id = v_report.scope_id
   and action.action_id = any(v_action_ids)
   and action.rationale_richtext #>> '{meta,source_item_id}' =
     assignment.value->>'actionSourceItemId';

  get diagnostics v_matched_count = row_count;
  if v_matched_count <> v_selected_action_count then
    raise exception 'Canonical action metric bindings are inconsistent.' using errcode = '55000';
  end if;

  update public.decision_reports as report
  set status = 'active',
      active_activation_id = v_activation_id,
      active_decision_id = v_decision_id,
      active_prediction_id = v_prediction_id,
      active_metric_id = p_primary_metric_id,
      activated_by = p_activated_by,
      activated_at = v_activated_at,
      updated_at = v_activated_at
  where report.report_id = v_report.report_id;

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
    v_report.scope_id,
    v_decision_id,
    v_primary_action_id,
    p_primary_metric_id,
    'decision-report:' || v_activation_id::text || ':primary',
    'manual',
    null,
    'DRAFTED',
    pg_catalog.jsonb_build_object(
      'source', 'decision_report_activation',
      'activation_id', v_activation_id,
      'report_id', v_report.report_id,
      'source_item_id', v_primary_source
    )
  );

  perform private.enqueue_current_causal_recompute(
    v_report.scope_id,
    p_primary_metric_id,
    'report_activated',
    p_activated_by
  );

  return query select
    v_activation_id,
    v_decision_id,
    v_prediction_id,
    v_action_ids,
    v_primary_action_id,
    false,
    v_activated_at;
end;
$$;

revoke all on function public.activate_decision_report_v3(
  uuid, uuid, uuid, uuid[], text, real, date, text[], jsonb, text, uuid
) from public, anon;
grant execute on function public.activate_decision_report_v3(
  uuid, uuid, uuid, uuid[], text, real, date, text[], jsonb, text, uuid
) to authenticated, service_role;

reset lock_timeout;
reset statement_timeout;
notify pgrst, 'reload schema';
