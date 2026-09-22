-- Admission is durable across app instances. Only the application service may
-- call these functions; it must supply a freshly authenticated actor.
create table private.generation_budgets (
  org_id uuid primary key references public.orgs(org_id) on delete cascade,
  daily_microusd bigint not null default 20000000 check (daily_microusd >= 0),
  concurrency integer not null default 3 check (concurrency between 1 and 20),
  requests_per_minute integer not null default 10 check (requests_per_minute between 1 and 100)
);

create table private.generation_requests (
  request_id uuid primary key,
  org_id uuid not null references public.orgs(org_id) on delete cascade,
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  model text not null,
  reserved_microusd bigint not null check (reserved_microusd >= 0),
  status text not null default 'running' check (status in ('running','cancel_requested','completed','failed','cancelled','expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '3 minutes',
  finished_at timestamptz,
  slot_released boolean not null default false,
  result jsonb,
  check (result is null or octet_length(result::text) <= 1048576)
);
create index generation_requests_budget on private.generation_requests(org_id,created_at);
create index generation_requests_actor on private.generation_requests(actor_id,expires_at) where not slot_released;
alter table private.generation_budgets enable row level security;
alter table private.generation_requests enable row level security;
revoke all on private.generation_budgets, private.generation_requests from public,anon,authenticated,service_role;

create function private.generation_actor_org(p_scope uuid, p_actor uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select p.org_id from public.workspaces w join public.projects p using(project_id)
  where w.workspace_id=p_scope and w.archived_at is null and exists (
    select 1 from public.memberships m where m.user_id=p_actor and m.org_id=p.org_id
      and m.role in ('member','admin','owner')
      and (m.project_id is null or m.project_id=w.project_id)
      and (m.workspace_id is null or m.workspace_id=w.workspace_id)
  )
$$;
revoke all on function private.generation_actor_org(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admit_report_generation(p_request uuid,p_scope uuid,p_actor uuid,p_hash text,p_model text,p_fixture boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_org uuid; v_old private.generation_requests; v_budget private.generation_budgets;
  v_now timestamptz := clock_timestamp(); v_reserved bigint; v_day timestamptz;
begin
  v_org := private.generation_actor_org(p_scope,p_actor);
  if v_org is null then return jsonb_build_object('status','forbidden'); end if;
  if p_request is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status','invalid_request');
  end if;
  -- Pricing envelope: <=300 KB request + 16K provider tokens, 2 x 2,200 output
  -- tokens at a conservative $3/$15 per million; unknown models fail closed.
  if p_model is distinct from 'anthropic/claude-sonnet-5' then return jsonb_build_object('status','unpriced_model'); end if;
  v_reserved := case when p_fixture then 0 else 2000000 end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('generation-actor:'||p_actor::text,0));
  insert into private.generation_budgets(org_id) values(v_org) on conflict do nothing;
  select * into v_budget from private.generation_budgets where org_id=v_org for update;
  select * into v_old from private.generation_requests where request_id=p_request;
  if found then
    if v_old.actor_id<>p_actor or v_old.scope_id<>p_scope or v_old.input_hash<>p_hash or v_old.model<>p_model then
      return jsonb_build_object('status','conflict');
    end if;
    if v_old.status in ('running','cancel_requested') and v_old.expires_at<=v_now then
      update private.generation_requests set status='expired',finished_at=v_now where request_id=p_request returning * into v_old;
    end if;
    return jsonb_build_object('status',v_old.status,'result',v_old.result);
  end if;
  if exists(select 1 from private.generation_requests where actor_id=p_actor and not slot_released and expires_at>v_now)
    or (select count(*) from private.generation_requests where org_id=v_org and not slot_released and expires_at>v_now) >= v_budget.concurrency then
    return jsonb_build_object('status','busy','retryAfter',10);
  end if;
  if (select count(*) from private.generation_requests where org_id=v_org and created_at>v_now-interval '1 minute') >= v_budget.requests_per_minute then
    return jsonb_build_object('status','rate_limited','retryAfter',60);
  end if;
  v_day := date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  if coalesce((select sum(reserved_microusd) from private.generation_requests where org_id=v_org and created_at>=v_day),0)+v_reserved > v_budget.daily_microusd then
    return jsonb_build_object('status','budget_exhausted','retryAfter',ceil(extract(epoch from (v_day+interval '1 day'-v_now))));
  end if;
  insert into private.generation_requests(request_id,org_id,scope_id,actor_id,input_hash,model,reserved_microusd)
    values(p_request,v_org,p_scope,p_actor,p_hash,p_model,v_reserved);
  return jsonb_build_object('status','admitted');
end $$;

create function public.report_generation_state(p_request uuid,p_scope uuid,p_actor uuid,p_operation text default 'read',p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row private.generation_requests; v_scope uuid := p_scope;
begin
  if v_scope is null and p_operation='cancel' then
    select scope_id into v_scope from private.generation_requests where request_id=p_request and actor_id=p_actor;
  end if;
  if private.generation_actor_org(v_scope,p_actor) is null then return jsonb_build_object('status','forbidden'); end if;
  select * into v_row from private.generation_requests where request_id=p_request and scope_id=v_scope and actor_id=p_actor for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_row.status in ('running','cancel_requested') and v_row.expires_at<=clock_timestamp() then
    update private.generation_requests set status='expired',finished_at=clock_timestamp() where request_id=p_request returning * into v_row;
  end if;
  if p_operation not in ('read','complete','fail','cancel') then raise exception 'INVALID_GENERATION_OPERATION'; end if;
  if v_row.status in ('running','cancel_requested') and p_operation<>'read' then
    if p_operation='complete' and p_result is null then raise exception 'MISSING_GENERATION_RESULT'; end if;
    update private.generation_requests set
      status=case when p_operation='cancel' then 'cancel_requested' when v_row.status='cancel_requested' then 'cancelled'
        when p_operation='complete' then 'completed' else 'failed' end,
      finished_at=case when p_operation='cancel' then null else clock_timestamp() end,
      slot_released=coalesce(p_operation='complete' and v_row.status='running' and (
        p_result->>'mode'='fixture' or (p_result->>'mode'='live' and p_result#>>'{telemetry,attempts}'='1')),false),
      result=case when p_operation='complete' and v_row.status='running' then p_result else null end
      where request_id=p_request returning * into v_row;
  end if;
  return jsonb_build_object('status',v_row.status);
end $$;

revoke all on function public.admit_report_generation(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.report_generation_state(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admit_report_generation(uuid,uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.report_generation_state(uuid,uuid,uuid,text,jsonb) to service_role;
