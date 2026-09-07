-- T01–T04 only. Generated from a disposable schema, then reviewed for explicit ACLs
-- and the legacy alias data backfill that a schema diff cannot capture.
begin;

create table public.evaluation_runs (
  evaluation_id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  metric_id uuid not null references public.metrics(metric_id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  input_manifest jsonb not null check (jsonb_typeof(input_manifest) = 'object'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  model_version text not null check (length(model_version) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  unique (evaluation_id, scope_id)
);
alter table public.evaluation_runs enable row level security;
revoke all on public.evaluation_runs from public, anon, authenticated, service_role;
grant select, insert on public.evaluation_runs to authenticated;
grant select on public.evaluation_runs to service_role;
create index evaluation_runs_metric_idx on public.evaluation_runs(metric_id);
create index evaluation_runs_actor_idx on public.evaluation_runs(actor_id);
create index evaluation_runs_scope_idx on public.evaluation_runs(scope_id);
create policy evaluation_runs_read on public.evaluation_runs for select to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));
create policy evaluation_runs_write on public.evaluation_runs for insert to authenticated
  with check (public.has_scope_access(scope_id, 'member') and actor_id = (select auth.uid())
    and exists (select 1 from public.metrics m where m.metric_id = evaluation_runs.metric_id
      and m.scope_id = evaluation_runs.scope_id));

-- Login identity survives SET ROLE; caller-controlled JWT/GUC claims do not confer authority.
create function private.guard_evaluation_run() returns trigger
language plpgsql set search_path = '' as $$
begin
  if session_user not in ('causent_recompute_worker', 'causent_resolve_worker', 'postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'Trusted computation login required';
  end if;
  if tg_op = 'UPDATE' then
    raise exception using errcode = '55000', message = 'Evaluation runs are immutable';
  end if;
  return new;
end $$;
create trigger guard_evaluation_run before insert or update on public.evaluation_runs
  for each row execute function private.guard_evaluation_run();

alter table public.causal_edges add column evaluation_id uuid;
alter table public.causal_edges add constraint edge_evaluation_scope_fk
  foreign key (evaluation_id, scope_id) references public.evaluation_runs(evaluation_id, scope_id);
alter table public.evidence_objects add column evaluation_id uuid;
alter table public.evidence_objects add column result_direction text;
alter table public.evidence_objects add column result_belief real;
alter table public.evidence_objects add column result_reason text;
alter table public.evidence_objects add constraint evidence_evaluation_scope_fk
  foreign key (evaluation_id, scope_id) references public.evaluation_runs(evaluation_id, scope_id);
create index evidence_evaluation_method_latest_idx on public.evidence_objects
  (edge_id, evaluation_id, methodology, created_at desc, evidence_id desc);
create index causal_edges_scope_edge_idx on public.causal_edges(scope_id, edge_id);

create function private.guard_node_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.scope_id, new.type, new.semantic_ref) is distinct from (old.scope_id, old.type, old.semantic_ref) then
    raise exception using errcode = '55000', message = 'Graph node identity is immutable';
  end if;
  return new;
end $$;
create trigger guard_node_identity before update on public.nodes
  for each row execute function private.guard_node_identity();

create function private.guard_edge_result() returns trigger
language plpgsql set search_path = '' as $$
declare metric_ref uuid; source_ref uuid; source_type text;
begin
  if tg_op = 'UPDATE' then
    if (new.scope_id, new.source_node_id, new.target_node_id) is distinct from
       (old.scope_id, old.source_node_id, old.target_node_id) then
      raise exception using errcode = '55000', message = 'Graph edge identity is immutable';
    end if;
    if old.authoritative_method is distinct from 'MANUAL' or old.evaluation_id is not null then
      if session_user not in ('causent_recompute_worker', 'causent_resolve_worker', 'postgres', 'supabase_admin') then
        raise exception using errcode = '42501', message = 'Trusted computation login required';
      end if;
    end if;
  end if;
  -- Point lookups avoid re-scanning every scoped action for every inserted edge.
  select semantic_ref, type into source_ref, source_type from public.nodes
    where node_id = new.source_node_id and scope_id = new.scope_id;
  select semantic_ref into metric_ref from public.nodes
    where node_id = new.target_node_id and scope_id = new.scope_id and type = 'METRIC';
  if metric_ref is null or source_type is null or source_type not in ('ACTION', 'CLUSTER') or
     not exists (select 1 from public.metrics where metric_id = metric_ref and scope_id = new.scope_id) then
    raise exception using errcode = '23514', message = 'Edge endpoints must belong to the same scope and metric';
  end if;
  if source_type = 'ACTION' then
    if not exists (select 1 from public.actions where action_id = source_ref and scope_id = new.scope_id) then
      raise exception using errcode = '23514', message = 'Edge action must belong to its scope';
    end if;
  elsif not exists (select 1 from public.clusters where cluster_id = source_ref and scope_id = new.scope_id and metric_id = metric_ref) then
    raise exception using errcode = '23514', message = 'Edge cluster must belong to its scope and metric';
  end if;
  if new.authoritative_method = 'MANUAL' and new.evaluation_id is null then
    if new.belief_score is not null and (new.belief_score < 0 or new.belief_score > 0.3::real) then
      raise exception using errcode = '23514', message = 'Manual belief cannot exceed 0.3';
    end if;
  else
    if session_user not in ('causent_recompute_worker', 'causent_resolve_worker', 'postgres', 'supabase_admin') then
      raise exception using errcode = '42501', message = 'Trusted computation login required';
    end if;
    if new.authoritative_method is distinct from 'ITS' or not exists (
      select 1 from public.evaluation_runs r where r.evaluation_id = new.evaluation_id
        and r.scope_id = new.scope_id and r.metric_id = metric_ref
    ) then
      raise exception using errcode = '23514', message = 'Computed edge requires an evaluation for its metric and scope';
    end if;
  end if;
  return new;
end $$;
create trigger guard_edge_result before insert or update on public.causal_edges
  for each row execute function private.guard_edge_result();

create function private.guard_evidence_result() returns trigger
language plpgsql set search_path = '' as $$
declare edge public.causal_edges; source public.nodes;
begin
  select * into edge from public.causal_edges e where e.edge_id = new.edge_id and e.scope_id = new.scope_id;
  select * into source from public.nodes n where n.node_id = edge.source_node_id and n.scope_id = new.scope_id;
  if edge.edge_id is null or
     (source.type = 'ACTION' and (new.action_id is distinct from source.semantic_ref or new.cluster_id is not null)) or
     (source.type = 'CLUSTER' and (new.cluster_id is distinct from source.semantic_ref or new.action_id is not null)) then
    raise exception using errcode = '23514', message = 'Evidence must match its edge scope and source';
  end if;
  if new.methodology = 'MANUAL' then
    if new.evaluation_id is not null or new.result_direction is not null or new.result_belief is not null or new.result_reason is not null then
      raise exception using errcode = '23514', message = 'Manual evidence cannot declare computed provenance';
    end if;
  else
    if session_user not in ('causent_recompute_worker', 'causent_resolve_worker', 'postgres', 'supabase_admin') then
      raise exception using errcode = '42501', message = 'Trusted computation login required';
    end if;
    if edge.evaluation_id is null or (new.evaluation_id is not null and new.evaluation_id <> edge.evaluation_id) then
      raise exception using errcode = '23514', message = 'Evidence requires the current edge evaluation';
    end if;
    new.evaluation_id := edge.evaluation_id;
    new.result_direction := edge.direction;
    new.result_belief := edge.belief_score;
    new.result_reason := edge.belief_reason;
  end if;
  return new;
end $$;
create trigger guard_evidence_result before insert on public.evidence_objects
  for each row execute function private.guard_evidence_result();

create view public.current_edge_readouts with (security_invoker = true) as
select e.edge_id, e.scope_id, s.semantic_ref as action_id, t.semantic_ref as metric_id,
  r.evaluation_id, r.input_hash, r.model_version,
  case when i.evidence_id is not null then 'computed'
       when e.evaluation_id is not null then 'incomplete'
       when e.authoritative_method = 'MANUAL' then 'manual' else 'legacy_unverified' end as provenance,
  coalesce(i.result_direction, 'INCONCLUSIVE') as direction,
  i.result_belief as belief_score, i.result_reason as belief_reason,
  i.lift, i.ci_low, i.ci_high, i.n_pre, i.n_post,
  d.lift as descriptive_lift, d.ci_low as descriptive_ci_low, d.ci_high as descriptive_ci_high,
  d.n_pre as descriptive_n_pre, d.n_post as descriptive_n_post, coalesce(d.clustered, false) as descriptive_clustered
from public.causal_edges e
-- Keep identity lookups parameterized even before a fresh import is analyzed.
-- LIMIT 1 is exact because node_id is unique; it prevents a quadratic RLS join.
join lateral (
  select semantic_ref from public.nodes where node_id = e.source_node_id
    and scope_id = e.scope_id and type = 'ACTION' limit 1
) s on true
join lateral (
  select semantic_ref from public.nodes where node_id = e.target_node_id
    and scope_id = e.scope_id and type = 'METRIC' limit 1
) t on true
left join public.evaluation_runs r on r.evaluation_id = e.evaluation_id and r.scope_id = e.scope_id and r.metric_id = t.semantic_ref
left join lateral (
  select i.* from public.evidence_objects i where i.edge_id = e.edge_id and i.scope_id = e.scope_id
    and i.evaluation_id = r.evaluation_id and i.methodology = 'ITS'
  order by i.created_at desc, i.evidence_id desc limit 1
) i on true
left join lateral (
  select d.* from public.evidence_objects d where d.edge_id = e.edge_id and d.scope_id = e.scope_id
    and d.evaluation_id = r.evaluation_id and d.methodology = 'BEFORE_AFTER_14D'
  order by d.created_at desc, d.evidence_id desc limit 1
) d on i.evidence_id is not null;
grant select on public.current_edge_readouts to authenticated, service_role;


create table public.action_identity_aliases (
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  alias text not null,
  action_id uuid not null references public.actions(action_id) on delete cascade,
  source_url text,
  canonical_ref text,
  resolution text not null default 'needs_provider_verification'
    check (resolution in ('needs_provider_verification', 'verified')),
  primary key (scope_id, alias)
);
alter table public.action_identity_aliases enable row level security;
revoke all on public.action_identity_aliases from anon, authenticated, service_role;
grant select on public.action_identity_aliases to authenticated;
grant select, insert, update on public.action_identity_aliases to service_role;
create policy identity_alias_read on public.action_identity_aliases for select to authenticated
  using (public.has_scope_access(scope_id, 'viewer'));
create index action_identity_aliases_action_idx on public.action_identity_aliases(action_id);
insert into public.action_identity_aliases(scope_id, alias, action_id, source_url)
select scope_id, external_ref, action_id, rationale_richtext #>> '{meta,source_url}'
from public.actions where external_ref ~ '^github:(pr|issue):[0-9]+$';

create function public.ingest_github_actions_v1(p_rows jsonb)
returns table (inserted integer, duplicates integer, rejected integer)
language plpgsql security invoker set search_path = '' as $$
declare import_scope uuid; n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception using errcode = '22023', message = 'Import must contain at most 200 actions';
  end if;
  if jsonb_array_length(p_rows) = 0 then return query select 0, 0, 0; return; end if;
  import_scope := (p_rows->0->>'scope_id')::uuid;
  if exists (select 1 from jsonb_array_elements(p_rows) r where
    jsonb_typeof(r) <> 'object' or r->>'scope_id' is null or (r->>'scope_id')::uuid is distinct from import_scope or
    r->>'external_ref' is null or r->>'source' is null or
    r->>'external_ref' !~ '^github:repo:id:[1-9][0-9]*:(pr|issue):[1-9][0-9]*$' or
    r->>'source' <> case when r->>'external_ref' like '%:pr:%' then 'github_pr' else 'github_issue' end
  ) then
    raise exception using errcode = '22023', message = 'One scope and canonical repository identities required';
  end if;
  -- Serialize the short insert/reconciliation boundary, never provider I/O.
  perform 1 from public.workspaces where workspace_id = import_scope for update;
  if not found then raise exception using errcode = '23503', message = 'Import workspace unavailable'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r join public.action_identity_aliases a
    on a.scope_id = import_scope and a.alias = regexp_replace(r->>'external_ref', '^github:repo:id:[0-9]+:', 'github:')
    where a.resolution = 'needs_provider_verification') then
    raise exception using errcode = '22023', message = 'Legacy GitHub identity requires provider reconciliation';
  end if;
  insert into public.actions(scope_id, source, external_ref, ship_ts, effective_date, status, rationale_richtext)
  select scope_id, source, external_ref, ship_ts, effective_date, status, rationale_richtext
  from jsonb_to_recordset(p_rows) as x(scope_id uuid, source text, external_ref text, ship_ts timestamptz,
    effective_date date, status text, rationale_richtext jsonb)
  on conflict (scope_id, external_ref) where external_ref is not null do nothing;
  get diagnostics n = row_count;
  return query select n, jsonb_array_length(p_rows) - n, 0;
end $$;
revoke all on function public.ingest_github_actions_v1(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_github_actions_v1(jsonb) to service_role;

create function public.reconcile_github_identity_v1(p_scope_id uuid, p_action_id uuid, p_canonical_ref text, p_source_url text)
returns void language plpgsql security invoker set search_path = '' as $$
declare original public.actions; legacy_ref text;
begin
  if p_canonical_ref is null or p_canonical_ref !~ '^github:repo:id:[1-9][0-9]*:(pr|issue):[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Verified repository identity required';
  end if;
  perform 1 from public.workspaces where workspace_id = p_scope_id for update;
  select * into original from public.actions where action_id = p_action_id and scope_id = p_scope_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Action unavailable'; end if;
  if original.rationale_richtext #>> '{meta,source_url}' is distinct from p_source_url or p_source_url is null then
    raise exception using errcode = '22023', message = 'Source URL does not match stored provenance';
  end if;
  legacy_ref := regexp_replace(p_canonical_ref, '^github:repo:id:[0-9]+:', 'github:');
  if original.external_ref = p_canonical_ref then return; end if;
  if original.external_ref is distinct from legacy_ref or original.source <>
     (case when p_canonical_ref like '%:pr:%' then 'github_pr' else 'github_issue' end) then
    raise exception using errcode = '22023', message = 'Legacy entity kind and number must match';
  end if;
  if exists (select 1 from public.actions where scope_id = p_scope_id and external_ref = p_canonical_ref and action_id <> p_action_id) then
    raise exception using errcode = '23505', message = 'Identity collision: review both action histories';
  end if;
  insert into public.action_identity_aliases(scope_id, alias, action_id, source_url, canonical_ref, resolution)
  values(p_scope_id, original.external_ref, p_action_id, p_source_url, p_canonical_ref, 'verified')
  on conflict (scope_id, alias) do update set canonical_ref = excluded.canonical_ref, resolution = 'verified'
    where action_identity_aliases.action_id = excluded.action_id;
  if not found then raise exception using errcode = '23505', message = 'Legacy alias belongs to another action'; end if;
  update public.actions set external_ref = p_canonical_ref where action_id = p_action_id;
end $$;
revoke all on function public.reconcile_github_identity_v1(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.reconcile_github_identity_v1(uuid,uuid,text,text) to service_role;

commit;
