-- Expand phase for the Decision Report activation contract without making v3 callable.
--
-- Production operators must build the three parent identity indexes
-- concurrently before this migration (see the rollout runbook). The
-- reset-compatible CREATE INDEX statements below are a no-op when those
-- indexes already exist and are cheap on a new/empty database.

set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.decision_report_activations
  add column contract_version smallint not null default 1,
  add column primary_lever_source_hash text;

alter table public.decision_report_activations
  add constraint decision_report_activations_contract_version_check
    check (contract_version in (1, 2)) not valid,
  add constraint decision_report_activations_action_identity_count_check
    check (cardinality(selected_action_source_ids) = cardinality(action_ids)) not valid,
  add constraint decision_report_activations_primary_source_hash_check check (
    (primary_lever_source_id is null and primary_lever_source_hash is null)
    or (
      primary_lever_source_id is not null
      and primary_lever_source_hash = pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(primary_lever_source_id, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    )
  ) not valid;

create function private.set_decision_report_activation_primary_source_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.primary_lever_source_hash := case
    when new.primary_lever_source_id is null then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(new.primary_lever_source_id, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  end;
  return new;
end;
$$;

create trigger decision_report_activations_set_primary_source_hash
before insert or update of primary_lever_source_id
on public.decision_report_activations
for each row execute function private.set_decision_report_activation_primary_source_hash();

revoke all on function private.set_decision_report_activation_primary_source_hash()
  from public, anon, authenticated, service_role;

create unique index if not exists decision_report_activations_activation_id_scope_id_key
  on public.decision_report_activations(activation_id, scope_id);
create unique index if not exists metrics_metric_id_scope_id_key
  on public.metrics(metric_id, scope_id);
create unique index if not exists actions_action_id_scope_id_key
  on public.actions(action_id, scope_id);

create table public.decision_report_activation_metrics (
  activation_id uuid not null,
  scope_id uuid not null,
  metric_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (activation_id, metric_id)
);

create index decision_report_activation_metrics_scope_metric_idx
  on public.decision_report_activation_metrics(scope_id, metric_id, activation_id);

create table public.decision_report_activation_action_metrics (
  activation_id uuid not null,
  scope_id uuid not null,
  action_id uuid not null,
  action_source_item_id text not null check (
    btrim(action_source_item_id) <> ''
  ),
  action_source_item_hash text not null check (
    action_source_item_hash ~ '^[0-9a-f]{64}$'
    and action_source_item_hash = pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(action_source_item_id, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  ),
  metric_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (activation_id, action_id),
  unique (activation_id, action_source_item_hash),
  unique (activation_id, action_id, action_source_item_hash)
);

create index decision_report_activation_action_metrics_scope_metric_idx
  on public.decision_report_activation_action_metrics(scope_id, metric_id, activation_id);
create index decision_report_activation_action_metrics_scope_action_idx
  on public.decision_report_activation_action_metrics(scope_id, action_id);

-- Normalize legacy v1/v2 writes during the rolling deploy. Existing rows are
-- handled by the bounded backfill migration that follows.
create function private.normalize_legacy_decision_report_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding_count integer;
begin
  if new.contract_version <> 1 then
    return new;
  end if;

  insert into public.decision_report_activation_metrics (
    activation_id,
    scope_id,
    metric_id,
    created_at
  ) values (
    new.activation_id,
    new.scope_id,
    new.metric_id,
    new.activated_at
  );

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
    new.activation_id,
    new.scope_id,
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
    new.metric_id,
    new.activated_at
  from public.actions as action
  where action.action_id = any(new.action_ids)
    and action.scope_id = new.scope_id
    and action.rationale_richtext #>> '{meta,source_item_id}' =
      any(new.selected_action_source_ids);

  get diagnostics v_binding_count = row_count;
  if v_binding_count <> cardinality(new.action_ids) then
    raise exception 'Canonical Decision Report action bindings are inconsistent.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger decision_report_activations_normalize_legacy_contract
after insert on public.decision_report_activations
for each row execute function private.normalize_legacy_decision_report_activation();

revoke all on function private.normalize_legacy_decision_report_activation()
  from public, anon, authenticated, service_role;

alter table public.decision_report_activation_metrics enable row level security;
alter table public.decision_report_activation_action_metrics enable row level security;

create policy decision_report_activation_metrics_select
  on public.decision_report_activation_metrics
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

create policy decision_report_activation_action_metrics_select
  on public.decision_report_activation_action_metrics
  for select
  to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));

revoke all on public.decision_report_activation_metrics
  from public, anon, authenticated, service_role;
revoke all on public.decision_report_activation_action_metrics
  from public, anon, authenticated, service_role;
grant select on public.decision_report_activation_metrics to authenticated, service_role;
grant select on public.decision_report_activation_action_metrics to authenticated, service_role;

create function public.list_decision_report_activation_metrics_v1(
  p_scope_id uuid
)
returns table (
  metric_id uuid,
  name text,
  source text,
  unit text,
  is_core boolean,
  has_observations boolean
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
    metric.metric_id,
    metric.name,
    metric.source,
    metric.unit,
    metric.is_core,
    exists (
      select 1
      from public.metric_observations as observation
      where observation.metric_id = metric.metric_id
    )
  from public.metrics as metric
  where metric.scope_id = p_scope_id
    and metric.granularity = 'daily'
  order by pg_catalog.lower(metric.name), metric.metric_id;
end;
$$;

revoke all on function public.list_decision_report_activation_metrics_v1(uuid)
  from public, anon;
grant execute on function public.list_decision_report_activation_metrics_v1(uuid)
  to authenticated, service_role;

reset lock_timeout;
reset statement_timeout;
notify pgrst, 'reload schema';
