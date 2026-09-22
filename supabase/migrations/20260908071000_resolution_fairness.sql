create table private.resolution_dispatch (
  scope_id uuid primary key references public.workspaces(workspace_id) on delete cascade,
  claim_id uuid not null,
  lease_until timestamptz not null,
  last_attempt_at timestamptz not null,
  next_attempt_at timestamptz not null,
  failures integer not null default 0 check (failures>=0),
  last_error_code text,
  finished_at timestamptz
);
alter table private.resolution_dispatch enable row level security;
revoke all on private.resolution_dispatch from public,anon,authenticated,service_role;

create function public.claim_resolution_targets(p_today date,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row record; v_claim uuid; v_rows jsonb := '[]'; v_more boolean;
begin
  if p_today is null or p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_RESOLUTION_BATCH'; end if;
  -- Serialize only discovery and lease assignment, never actor queries or work.
  perform pg_catalog.pg_advisory_xact_lock(730091201);
  for v_row in
    select w.workspace_id,w.project_id,p.org_id from public.workspaces w
    join public.projects p using(project_id)
    left join private.resolution_dispatch d on d.scope_id=w.workspace_id
    where w.archived_at is null
      and (d.scope_id is null or (d.lease_until<=clock_timestamp() and d.next_attempt_at<=clock_timestamp()))
      and exists(select 1 from public.predictions pred where pred.scope_id=w.workspace_id
        and pred.resolved_at is null and pred.resolution_date<=p_today)
    order by d.last_attempt_at nulls first,w.workspace_id
    limit p_limit for update of w skip locked
  loop
    v_claim := pg_catalog.gen_random_uuid();
    insert into private.resolution_dispatch(scope_id,claim_id,lease_until,last_attempt_at,next_attempt_at)
      values(v_row.workspace_id,v_claim,clock_timestamp()+interval '6 minutes',clock_timestamp(),clock_timestamp())
      on conflict(scope_id) do update set claim_id=excluded.claim_id,lease_until=excluded.lease_until,last_attempt_at=excluded.last_attempt_at;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('workspace_id',v_row.workspace_id,
      'project_id',v_row.project_id,'projects',jsonb_build_object('org_id',v_row.org_id),'claim_id',v_claim));
  end loop;
  select exists(select 1 from public.workspaces w left join private.resolution_dispatch d on d.scope_id=w.workspace_id
    where w.archived_at is null and (d.scope_id is null or (d.lease_until<=clock_timestamp() and d.next_attempt_at<=clock_timestamp()))
    and exists(select 1 from public.predictions p where p.scope_id=w.workspace_id and p.resolved_at is null and p.resolution_date<=p_today)) into v_more;
  return jsonb_build_object('rows',v_rows,'truncated',v_more);
end $$;

create function public.finish_resolution_target(p_scope uuid,p_claim uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_error is not null and p_error not in ('invalid_scope_row','actor_query_failed','no_eligible_actor','worker_failed','worker_unavailable') then
    raise exception 'INVALID_RESOLUTION_ERROR';
  end if;
  update private.resolution_dispatch set
    lease_until=clock_timestamp(), finished_at=clock_timestamp(),last_error_code=p_error,
    failures=case when p_error is null then 0 else least(failures+1,30) end,
    next_attempt_at=clock_timestamp()+case
      when p_error is null then interval '5 minutes'
      when p_error in ('no_eligible_actor','invalid_scope_row') then interval '1 hour'
      else make_interval(secs=>least(3600,60*power(2,least(failures,6)))::integer) end
    where scope_id=p_scope and claim_id=p_claim and lease_until>clock_timestamp();
  return found;
end $$;
revoke all on function public.claim_resolution_targets(date,integer) from public,anon,authenticated,service_role;
revoke all on function public.finish_resolution_target(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_resolution_targets(date,integer) to service_role;
grant execute on function public.finish_resolution_target(uuid,uuid,text) to service_role;
