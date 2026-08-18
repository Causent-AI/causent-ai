-- Validate historical state under write-compatible constraints before v3 is
-- exposed. Foreign keys are installed NOT VALID first so new writes are
-- checked immediately while historical scans use weaker locks.

set lock_timeout = '5s';
set statement_timeout = '0';

do $$
begin
  if exists (
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
      or (
        select count(*)
        from public.decision_report_activation_metrics as activation_metric
        where activation_metric.activation_id = activation.activation_id
          and activation_metric.scope_id = activation.scope_id
          and activation_metric.metric_id = activation.metric_id
      ) <> 1
      or exists (
        select 1
        from public.decision_report_activation_metrics as activation_metric
        where activation_metric.activation_id = activation.activation_id
          and activation_metric.metric_id <> activation.metric_id
      )
      or (
        select count(*)
        from public.decision_report_activation_action_metrics as binding
        where binding.activation_id = activation.activation_id
          and binding.scope_id = activation.scope_id
          and binding.action_id = any(activation.action_ids)
          and binding.action_source_item_id = any(activation.selected_action_source_ids)
          and binding.metric_id = activation.metric_id
      ) <> cardinality(activation.action_ids)
      or exists (
        select 1
        from public.decision_report_activation_action_metrics as binding
        where binding.activation_id = activation.activation_id
          and (
            not (binding.action_id = any(activation.action_ids))
            or not (binding.action_source_item_id = any(activation.selected_action_source_ids))
            or binding.metric_id <> activation.metric_id
          )
      )
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
      or (
        activation.primary_lever_action_id is not null
        and not exists (
          select 1
          from public.decision_report_activation_action_metrics as binding
          where binding.activation_id = activation.activation_id
            and binding.action_id = activation.primary_lever_action_id
            and binding.action_source_item_id = activation.primary_lever_source_id
        )
      )
  ) then
    raise exception 'MULTI_METRIC_BACKFILL_REQUIRED'
      using errcode = '55000',
        hint = 'Run private.backfill_decision_report_multi_metric_v1 in bounded batches, then retry migrations.';
  end if;
end;
$$;

alter table public.decision_report_activations
  add constraint decision_report_activations_selected_action_source_ids_v3_check
    check (cardinality(selected_action_source_ids) between 1 and 25) not valid,
  add constraint decision_report_activations_action_ids_v3_check
    check (cardinality(action_ids) between 1 and 25) not valid,
  add constraint decision_report_activations_input_hash_v3_check
    check (
      (contract_version = 1 and input_hash ~ '^[0-9a-f]{32}$')
      or (contract_version = 2 and input_hash ~ '^[0-9a-f]{64}$')
    ) not valid;

alter table public.decision_report_activations
  validate constraint decision_report_activations_contract_version_check,
  validate constraint decision_report_activations_action_identity_count_check,
  validate constraint decision_report_activations_primary_source_hash_check,
  validate constraint decision_report_activations_selected_action_source_ids_v3_check,
  validate constraint decision_report_activations_action_ids_v3_check,
  validate constraint decision_report_activations_input_hash_v3_check;

alter table public.decision_report_activations
  add constraint decision_report_activations_activation_id_scope_id_key
    unique using index decision_report_activations_activation_id_scope_id_key;
alter table public.metrics
  add constraint metrics_metric_id_scope_id_key
    unique using index metrics_metric_id_scope_id_key;
alter table public.actions
  add constraint actions_action_id_scope_id_key
    unique using index actions_action_id_scope_id_key;

alter table public.decision_report_activation_metrics
  add constraint dram_activation_scope_fkey
    foreign key (activation_id, scope_id)
    references public.decision_report_activations(activation_id, scope_id)
    on delete cascade not valid,
  add constraint dram_metric_scope_fkey
    foreign key (metric_id, scope_id)
    references public.metrics(metric_id, scope_id)
    on delete no action deferrable initially deferred not valid;

alter table public.decision_report_activation_action_metrics
  add constraint draam_activation_scope_fkey
    foreign key (activation_id, scope_id)
    references public.decision_report_activations(activation_id, scope_id)
    on delete cascade not valid,
  add constraint draam_action_scope_fkey
    foreign key (action_id, scope_id)
    references public.actions(action_id, scope_id)
    on delete no action deferrable initially deferred not valid,
  add constraint draam_metric_scope_fkey
    foreign key (metric_id, scope_id)
    references public.metrics(metric_id, scope_id)
    on delete no action deferrable initially deferred not valid,
  add constraint draam_selected_metric_fkey
    foreign key (activation_id, metric_id)
    references public.decision_report_activation_metrics(activation_id, metric_id)
    on delete cascade not valid;

alter table public.decision_report_activations
  add constraint decision_report_activations_primary_selected_metric_fkey
    foreign key (activation_id, metric_id)
    references public.decision_report_activation_metrics(activation_id, metric_id)
    on delete no action deferrable initially deferred not valid,
  add constraint decision_report_activations_primary_action_binding_fkey
    foreign key (
      activation_id,
      primary_lever_action_id,
      primary_lever_source_hash
    )
    references public.decision_report_activation_action_metrics(
      activation_id,
      action_id,
      action_source_item_hash
    )
    on delete no action deferrable initially deferred not valid;

alter table public.decision_report_activation_metrics
  validate constraint dram_activation_scope_fkey,
  validate constraint dram_metric_scope_fkey;

alter table public.decision_report_activation_action_metrics
  validate constraint draam_activation_scope_fkey,
  validate constraint draam_action_scope_fkey,
  validate constraint draam_metric_scope_fkey,
  validate constraint draam_selected_metric_fkey;

alter table public.decision_report_activations
  validate constraint decision_report_activations_primary_selected_metric_fkey,
  validate constraint decision_report_activations_primary_action_binding_fkey;

reset lock_timeout;
reset statement_timeout;
