-- Bounded, resumable historical normalization. Each invocation owns at most
-- 100 activation rows in the migration and at most 500 in operator runs.

set lock_timeout = '5s';
set statement_timeout = '30s';

create function private.backfill_decision_report_multi_metric_v1(
  p_batch_size integer default 100,
  p_after_activation_id uuid default null
)
returns table (
  processed_count integer,
  last_activation_id uuid,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation public.decision_report_activations%rowtype;
  v_processed integer := 0;
  v_last uuid;
  v_binding_count integer;
begin
  if p_batch_size not between 1 and 500 then
    raise exception 'Backfill batch size must be between 1 and 500.'
      using errcode = '22023';
  end if;

  for v_activation in
    select activation.*
    from public.decision_report_activations as activation
    where (p_after_activation_id is null or activation.activation_id > p_after_activation_id)
      and (
        activation.primary_lever_source_hash is distinct from case
          when activation.primary_lever_source_id is null then null
          else pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(activation.primary_lever_source_id, 'UTF8'),
              'sha256'
            ),
            'hex'
          )
        end
        or not exists (
          select 1
          from public.decision_report_activation_metrics as activation_metric
          where activation_metric.activation_id = activation.activation_id
            and activation_metric.scope_id = activation.scope_id
            and activation_metric.metric_id = activation.metric_id
        )
        or (
          select count(*)
          from public.decision_report_activation_action_metrics as binding
          where binding.activation_id = activation.activation_id
        ) <> cardinality(activation.action_ids)
        or exists (
          select 1
          from pg_catalog.unnest(activation.selected_action_source_ids) as selected(source_id)
          where not exists (
            select 1
            from public.decision_report_activation_action_metrics as binding
            where binding.activation_id = activation.activation_id
              and binding.action_source_item_id = selected.source_id
          )
        )
      )
    order by activation.activation_id
    for update of activation skip locked
    limit p_batch_size
  loop
    update public.decision_report_activations as activation
    set primary_lever_source_hash = case
      when activation.primary_lever_source_id is null then null
      else pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(activation.primary_lever_source_id, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    end
    where activation.activation_id = v_activation.activation_id;

    insert into public.decision_report_activation_metrics (
      activation_id,
      scope_id,
      metric_id,
      created_at
    ) values (
      v_activation.activation_id,
      v_activation.scope_id,
      v_activation.metric_id,
      v_activation.activated_at
    )
    on conflict (activation_id, metric_id) do nothing;

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
      v_activation.activation_id,
      v_activation.scope_id,
      action.action_id,
      action.rationale_richtext #>> '{meta,source_item_id}',
      pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(
            action.rationale_richtext #>> '{meta,source_item_id}',
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      v_activation.metric_id,
      v_activation.activated_at
    from public.actions as action
    where action.action_id = any(v_activation.action_ids)
      and action.scope_id = v_activation.scope_id
      and action.rationale_richtext #>> '{meta,source_item_id}' =
        any(v_activation.selected_action_source_ids)
    on conflict (activation_id, action_id) do nothing;

    select count(*)::integer
    into v_binding_count
    from public.decision_report_activation_action_metrics as binding
    where binding.activation_id = v_activation.activation_id
      and binding.scope_id = v_activation.scope_id
      and binding.action_id = any(v_activation.action_ids)
      and binding.action_source_item_id = any(v_activation.selected_action_source_ids)
      and binding.metric_id = v_activation.metric_id;

    if v_binding_count <> cardinality(v_activation.action_ids)
       or exists (
         select 1
         from pg_catalog.unnest(v_activation.selected_action_source_ids) as selected(source_id)
         where not exists (
           select 1
           from public.decision_report_activation_action_metrics as binding
           where binding.activation_id = v_activation.activation_id
             and binding.action_source_item_id = selected.source_id
         )
       )
       or (
         v_activation.primary_lever_action_id is not null
         and not exists (
           select 1
           from public.decision_report_activation_action_metrics as binding
           where binding.activation_id = v_activation.activation_id
             and binding.action_id = v_activation.primary_lever_action_id
             and binding.action_source_item_id = v_activation.primary_lever_source_id
         )
       ) then
      raise exception 'Historical Decision Report action bindings could not be backfilled.'
        using errcode = '55000', detail = v_activation.activation_id::text;
    end if;

    v_processed := v_processed + 1;
    v_last := v_activation.activation_id;
  end loop;

  return query
  select
    v_processed,
    v_last,
    exists (
      select 1
      from public.decision_report_activations as activation
      where activation.primary_lever_source_hash is distinct from case
          when activation.primary_lever_source_id is null then null
          else pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(activation.primary_lever_source_id, 'UTF8'),
              'sha256'
            ),
            'hex'
          )
        end
        or not exists (
          select 1
          from public.decision_report_activation_metrics as activation_metric
          where activation_metric.activation_id = activation.activation_id
            and activation_metric.scope_id = activation.scope_id
            and activation_metric.metric_id = activation.metric_id
        )
        or (
          select count(*)
          from public.decision_report_activation_action_metrics as binding
          where binding.activation_id = activation.activation_id
        ) <> cardinality(activation.action_ids)
        or exists (
          select 1
          from pg_catalog.unnest(activation.selected_action_source_ids) as selected(source_id)
          where not exists (
            select 1
            from public.decision_report_activation_action_metrics as binding
            where binding.activation_id = activation.activation_id
              and binding.action_source_item_id = selected.source_id
          )
        )
    );
end;
$$;

revoke all on function private.backfill_decision_report_multi_metric_v1(integer, uuid)
  from public, anon, authenticated, service_role;

-- Small databases complete here. Material databases stop safely at the next
-- validation migration until the operator repeats bounded calls.
select *
from private.backfill_decision_report_multi_metric_v1(100, null);

reset lock_timeout;
reset statement_timeout;
