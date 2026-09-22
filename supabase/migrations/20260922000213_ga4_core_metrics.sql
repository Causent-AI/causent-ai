begin;

do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='causent_ga4_worker') then
    create role causent_ga4_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists(select 1 from pg_catalog.pg_roles where rolname='causent_ga4_worker'
    and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'GA4 worker role does not match its required permissions';
  end if;
end $$;
grant causent_ga4_worker to authenticator;
grant usage on schema public, private to causent_ga4_worker;

create table public.ga4_connections (
  connection_id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','connected','reauthorize','error','disconnected')),
  property_id text check (property_id ~ '^[1-9][0-9]{0,19}$'),
  property_name text,
  timezone text,
  generation bigint not null default 1,
  next_sync_at timestamptz not null default now(),
  last_sync_at timestamptz,
  error_code text check (error_code in ('reauthorize','permission','quota','unavailable','invalid_response')),
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create index ga4_connections_scope_idx on public.ga4_connections(scope_id);
create index ga4_connections_actor_idx on public.ga4_connections(actor_id);
create index ga4_connections_due_idx on public.ga4_connections(next_sync_at) where status in ('connected','error');

create table private.ga4_credentials (
  connection_id uuid primary key references public.ga4_connections(connection_id) on delete cascade,
  subject text not null,
  refresh_cipher text not null check (length(refresh_cipher) between 40 and 16000),
  lease_id uuid,
  lease_until timestamptz
);
create table private.ga4_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid not null references public.ga4_connections(connection_id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  generation bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index ga4_states_connection_idx on private.ga4_oauth_states(connection_id);
create index ga4_states_actor_idx on private.ga4_oauth_states(actor_id,created_at);

create table public.ga4_metric_mappings (
  mapping_id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.ga4_connections(connection_id) on delete cascade,
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  metric_id uuid not null unique references public.metrics(metric_id) on delete cascade,
  provider_metric text not null check (provider_metric in ('sessions','engagedSessions','eventCount')),
  event_name text not null default '' check (event_name = '' or (length(event_name) <= 80 and event_name ~ '^[A-Za-z][A-Za-z0-9_]*$')),
  last_receipt_id uuid,
  created_at timestamptz not null default now(),
  unique(connection_id, provider_metric),
  check (event_name = '' or provider_metric = 'eventCount')
);
create index ga4_mappings_scope_idx on public.ga4_metric_mappings(scope_id);
create index ga4_mappings_receipt_idx on public.ga4_metric_mappings(last_receipt_id);
create table public.ga4_sync_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  lease_id uuid not null,
  mapping_id uuid not null references public.ga4_metric_mappings(mapping_id) on delete cascade,
  scope_id uuid not null references public.workspaces(workspace_id) on delete cascade,
  generation bigint not null,
  status text not null check (status in ('accepted','withheld')),
  start_date date not null,
  end_date date not null,
  timezone text not null,
  row_count integer not null check (row_count between 0 and 180),
  missing_days integer not null check (missing_days between 0 and 180),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  quality jsonb not null,
  fetched_at timestamptz not null,
  committed_at timestamptz not null default now(),
  unique(lease_id,mapping_id)
);
create index ga4_receipts_scope_idx on public.ga4_sync_receipts(scope_id,committed_at desc);
create index ga4_receipts_mapping_idx on public.ga4_sync_receipts(mapping_id,committed_at desc);
alter table public.ga4_metric_mappings add constraint ga4_last_receipt_fk
  foreign key(last_receipt_id) references public.ga4_sync_receipts(receipt_id) deferrable initially deferred;

alter table public.ga4_connections enable row level security;
alter table public.ga4_metric_mappings enable row level security;
alter table public.ga4_sync_receipts enable row level security;
alter table private.ga4_credentials enable row level security;
alter table private.ga4_oauth_states enable row level security;
revoke all on public.ga4_connections, public.ga4_metric_mappings, public.ga4_sync_receipts,
  private.ga4_credentials, private.ga4_oauth_states from public, anon, authenticated, service_role, causent_ga4_worker;
grant select on public.ga4_connections, public.ga4_metric_mappings, public.ga4_sync_receipts to authenticated, service_role;
create policy ga4_connections_read on public.ga4_connections for select to authenticated using(public.has_scope_access(scope_id,'viewer'));
create policy ga4_mappings_read on public.ga4_metric_mappings for select to authenticated using(public.has_scope_access(scope_id,'viewer'));
create policy ga4_receipts_read on public.ga4_sync_receipts for select to authenticated using(public.has_scope_access(scope_id,'viewer'));

-- GA dates label property-local days; the mathematical models are unchanged.
alter table public.metric_definitions drop constraint metric_definitions_timezone_check;
create or replace function private.validate_metric_definition() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.timezone) or not exists (
    select 1 from public.metrics m where m.metric_id=new.metric_id and m.scope_id=new.scope_id
      and m.unit=new.unit and m.tz=new.timezone and m.granularity=new.granularity
  ) then raise exception using errcode='22023', message='Definition must match its metric and valid daily timezone'; end if;
  new.created_at := now();
  return new;
end;
$$;

create function private.ga4_has_admin(p_actor uuid, p_scope uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspaces w join public.projects p on p.project_id=w.project_id
    join public.memberships m on m.org_id=p.org_id and m.user_id=p_actor
      and (m.project_id is null or m.project_id=w.project_id)
      and (m.workspace_id is null or m.workspace_id=w.workspace_id)
    where w.workspace_id=p_scope and w.archived_at is null and m.role in ('admin','owner'));
$$;
create function private.ga4_lock_admin(p_actor uuid, p_scope uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform w.workspace_id from public.workspaces w join public.projects p on p.project_id=w.project_id
    join public.memberships m on m.org_id=p.org_id and m.user_id=p_actor
      and (m.project_id is null or m.project_id=w.project_id)
      and (m.workspace_id is null or m.workspace_id=w.workspace_id)
    where w.workspace_id=p_scope and w.archived_at is null and m.role in ('admin','owner')
    for share of w,m;
  if not found then raise exception using errcode='42501', message='Workspace admin required'; end if;
end;
$$;

create function private.ga4_manage(p_action text,p_scope uuid,p_connection uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ga4_connections; v_id uuid; m record;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authenticated admin required'; end if;
  perform private.ga4_lock_admin(auth.uid(),p_scope);
  if p_action='begin' then
    if coalesce(p_payload->>'stateHash','') !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='Invalid state'; end if;
    -- Serialize admission for this actor/workspace; expired state is never reusable.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ga4_actor:'||auth.uid()::text,0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ga4_scope:'||p_scope::text,0));
    if (select count(*) from private.ga4_oauth_states where actor_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then
      raise exception using errcode='54000',message='Please wait before reconnecting';
    end if;
    delete from private.ga4_oauth_states where expires_at<now()-interval '1 hour';
    if p_connection is null then
      if (select count(*) from public.ga4_connections where scope_id=p_scope)>=20 then raise exception using errcode='54000',message='Connection limit reached'; end if;
      insert into public.ga4_connections(scope_id,actor_id) values(p_scope,auth.uid()) returning * into c;
    else
      select * into c from public.ga4_connections where connection_id=p_connection and scope_id=p_scope for update;
      if not found then raise exception using errcode='42501',message='Connection unavailable'; end if;
      update public.ga4_connections set generation=generation+1,actor_id=auth.uid(),status='pending',error_code=null
        where connection_id=c.connection_id returning * into c;
      update private.ga4_credentials set lease_id=null,lease_until=null where connection_id=c.connection_id;
    end if;
    insert into private.ga4_oauth_states(state_hash,connection_id,actor_id,generation)
      values(p_payload->>'stateHash',c.connection_id,auth.uid(),c.generation);
    return jsonb_build_object('connectionId',c.connection_id);
  end if;
  select * into c from public.ga4_connections where connection_id=p_connection and scope_id=p_scope for update;
  if not found then raise exception using errcode='42501',message='Connection unavailable'; end if;
  if p_action='disconnect' then
    update public.ga4_connections set status='disconnected',generation=generation+1,error_code=null where connection_id=c.connection_id;
    delete from private.ga4_credentials where connection_id=c.connection_id;
    delete from private.ga4_oauth_states where connection_id=c.connection_id;
  elsif p_action='sync' then
    if c.status not in ('connected','error') or c.property_id is null then raise exception using errcode='22023',message='Connect a property first'; end if;
    if c.last_sync_at>now()-interval '5 minutes' then raise exception using errcode='54000',message='Sync recently completed'; end if;
    update public.ga4_connections set next_sync_at=least(next_sync_at,now()) where connection_id=c.connection_id;
  else raise exception using errcode='22023',message='Unknown operation';
  end if;
  for m in select metric_id from public.ga4_metric_mappings where connection_id=c.connection_id loop
    perform private.enqueue_current_causal_recompute(c.scope_id,m.metric_id,'ga4_connection_changed',auth.uid());
  end loop;
  return jsonb_build_object('connectionId',c.connection_id);
end;
$$;

-- This worker surface is unavailable to ordinary authenticated and service-role
-- clients. Every lease binds a server-owned connection generation and actor.
create function private.ga4_worker(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ga4_connections; credential private.ga4_credentials; s private.ga4_oauth_states;
  mapping public.ga4_metric_mappings; item jsonb; report jsonb; quality jsonb;
  v_lease uuid; v_metric uuid; v_receipt uuid; v_start date; v_end date; v_rows integer;
  v_status text; v_name text; v_event text; v_direction text; v_claimed boolean := false;
begin
  if coalesce(auth.jwt()->>'role','')<>'causent_ga4_worker' then raise exception using errcode='42501',message='Connector worker required'; end if;
  if p_action in ('oauth','oauth_target') then
    select * into s from private.ga4_oauth_states where state_hash=p_payload->>'stateHash'
      and actor_id=(p_payload->>'actorId')::uuid and expires_at>now() for update;
    if not found then raise exception using errcode='42501',message='Authorization expired'; end if;
    perform private.ga4_lock_admin(s.actor_id,(select scope_id from public.ga4_connections where connection_id=s.connection_id));
    select * into c from public.ga4_connections where connection_id=s.connection_id and generation=s.generation for update;
    if not found or c.status<>'pending' then raise exception using errcode='42501',message='Authorization superseded'; end if;
    if p_action='oauth_target' then return jsonb_build_object('connectionId',c.connection_id,'scopeId',c.scope_id); end if;
    select * into credential from private.ga4_credentials where connection_id=c.connection_id;
    if length(coalesce(p_payload->>'subject','')) not between 1 and 255 then raise exception using errcode='22023',message='Google identity required'; end if;
    if coalesce(p_payload->>'refreshCipher','')='' then
      if credential.connection_id is null or credential.subject is distinct from p_payload->>'subject' then
        raise exception using errcode='22023',message='Offline authorization required';
      end if;
    else
      insert into private.ga4_credentials(connection_id,subject,refresh_cipher)
        values(c.connection_id,p_payload->>'subject',p_payload->>'refreshCipher')
        on conflict(connection_id) do update set subject=excluded.subject,refresh_cipher=excluded.refresh_cipher,lease_id=null,lease_until=null;
    end if;
    delete from private.ga4_oauth_states where state_hash=s.state_hash;
    update public.ga4_connections set status='connected',attempts=0,error_code=null,next_sync_at=now() where connection_id=c.connection_id;
    return jsonb_build_object('connectionId',c.connection_id,'scopeId',c.scope_id);
  end if;
  if p_action='claim' then
    select x.* into c from public.ga4_connections x join private.ga4_credentials k using(connection_id)
      where x.status in ('connected','error') and x.property_id is not null and x.next_sync_at<=now()
        and (k.lease_until is null or k.lease_until<now()) and private.ga4_has_admin(x.actor_id,x.scope_id)
      order by x.next_sync_at,x.connection_id for update of x skip locked limit 1;
    if not found then return 'null'::jsonb; end if;
    v_claimed:=true;
  else
    select * into c from public.ga4_connections where connection_id=(p_payload->>'connectionId')::uuid for update;
    if not found then raise exception using errcode='42501',message='Connection unavailable'; end if;
  end if;
  if p_action='disconnect' then
    if (p_payload->>'scopeId')::uuid is distinct from c.scope_id then raise exception using errcode='42501',message='Connection unavailable'; end if;
    perform private.ga4_lock_admin((p_payload->>'actorId')::uuid,c.scope_id);
    select * into credential from private.ga4_credentials where connection_id=c.connection_id;
    update public.ga4_connections set status='disconnected',generation=generation+1,error_code=null where connection_id=c.connection_id;
    delete from private.ga4_credentials where connection_id=c.connection_id;
    delete from private.ga4_oauth_states where connection_id=c.connection_id;
    for mapping in select * from public.ga4_metric_mappings where connection_id=c.connection_id loop
      perform private.enqueue_current_causal_recompute(c.scope_id,mapping.metric_id,'ga4_disconnected',(p_payload->>'actorId')::uuid);
    end loop;
    return jsonb_build_object('refreshCipher',credential.refresh_cipher,'scopeId',c.scope_id);
  end if;
  perform private.ga4_lock_admin(c.actor_id,c.scope_id);
  if p_action='lease' then
    if (p_payload->>'scopeId')::uuid is distinct from c.scope_id then raise exception using errcode='42501',message='Connection unavailable'; end if;
    perform private.ga4_lock_admin((p_payload->>'actorId')::uuid,c.scope_id);
  end if;
  select * into credential from private.ga4_credentials where connection_id=c.connection_id for update;
  if credential.connection_id is null or c.status not in ('connected','error') then raise exception using errcode='42501',message='Authorization required'; end if;
  if p_action='lease' or v_claimed then
    if credential.lease_until>now() then raise exception using errcode='55P03',message='Connection is busy'; end if;
    v_lease:=gen_random_uuid();
    update private.ga4_credentials set lease_id=v_lease,lease_until=now()+interval '5 minutes' where connection_id=c.connection_id;
    return jsonb_build_object('connection',to_jsonb(c),'refreshCipher',credential.refresh_cipher,'leaseId',v_lease,
      'mappings',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('lastAcceptedEnd',
        (select max(r.end_date) from public.ga4_sync_receipts r where r.mapping_id=m.mapping_id and r.status='accepted')) order by m.mapping_id)
        from public.ga4_metric_mappings m where connection_id=c.connection_id),'[]'::jsonb));
  end if;
  if credential.lease_id is null or credential.lease_until is null or p_payload->>'leaseId' is null
    or credential.lease_id is distinct from (p_payload->>'leaseId')::uuid or credential.lease_until<=now()
    or c.generation is distinct from (p_payload->>'generation')::bigint then
    -- A retry after a successful commit is harmless, including a lost response.
    if p_action='publish' and exists(select 1 from public.ga4_sync_receipts r join public.ga4_metric_mappings m using(mapping_id)
      where r.lease_id=(p_payload->>'leaseId')::uuid and m.connection_id=c.connection_id and r.generation=c.generation) then
      return jsonb_build_object('reused',true);
    end if;
    raise exception using errcode='40001',message='Stale connector lease';
  end if;
  if p_action='rotate' then
    update private.ga4_credentials set refresh_cipher=p_payload->>'refreshCipher' where connection_id=c.connection_id;
    return '{}'::jsonb;
  elsif p_action='configure' then
    if coalesce(p_payload->>'propertyId','') !~ '^[1-9][0-9]{0,19}$'
      or length(coalesce(p_payload->>'propertyName','')) not between 1 and 500
      or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'timezone')
      or jsonb_typeof(p_payload->'metrics') is distinct from 'array' or jsonb_array_length(p_payload->'metrics') not between 1 and 3 then
      raise exception using errcode='22023',message='Invalid property or metrics';
    end if;
    if c.property_id is not null and (c.property_id,c.timezone) is distinct from (p_payload->>'propertyId',p_payload->>'timezone') then
      raise exception using errcode='22023',message='Create a new connection to change property';
    end if;
    update public.ga4_connections set property_id=p_payload->>'propertyId',property_name=p_payload->>'propertyName',timezone=p_payload->>'timezone',next_sync_at=now()
      where connection_id=c.connection_id returning * into c;
    for item in select value from jsonb_array_elements(p_payload->'metrics') loop
      v_name:=item->>'metric'; v_event:=coalesce(item->>'event',''); v_direction:=item->>'direction';
      if v_name not in ('sessions','engagedSessions','eventCount') or v_name is null
        or v_direction not in ('higher','lower','neutral') or v_direction is null
        or (v_event<>'' and (v_name<>'eventCount' or length(v_event)>80 or v_event !~ '^[A-Za-z][A-Za-z0-9_]*$')) then
        raise exception using errcode='22023',message='Invalid metric';
      end if;
      select * into mapping from public.ga4_metric_mappings where connection_id=c.connection_id and provider_metric=v_name;
      if found then
        if mapping.event_name<>v_event or not exists(select 1 from public.metric_definitions where metric_id=mapping.metric_id and beneficial_direction=v_direction) then
          raise exception using errcode='22023',message='Create a new connection to change metric semantics';
        end if;
        continue;
      end if;
      insert into public.metrics(scope_id,name,source,granularity,unit,tz)
        values(c.scope_id,left(c.property_name,70)||' · '||v_name||case when v_event='' then '' else ' · '||v_event end,'connector','daily','count',c.timezone)
        returning metric_id into v_metric;
      insert into public.metric_definitions(metric_id,scope_id,unit,numeric_scale,beneficial_direction,aggregation,denominator,timezone,confirmed_by)
        values(v_metric,c.scope_id,'count','native',v_direction,'sum','GA4 property '||c.property_id||case when v_event='' then '' else '; event '||v_event end,c.timezone,c.actor_id);
      insert into public.ga4_metric_mappings(connection_id,scope_id,metric_id,provider_metric,event_name)
        values(c.connection_id,c.scope_id,v_metric,v_name,v_event);
    end loop;
  elsif p_action='publish' then
    if jsonb_typeof(p_payload->'reports') is distinct from 'array' or jsonb_array_length(p_payload->'reports')<>(select count(*) from public.ga4_metric_mappings where connection_id=c.connection_id)
      or jsonb_array_length(p_payload->'reports') not between 1 and 3 then raise exception using errcode='22023',message='Complete report batch required'; end if;
    for item in select value from jsonb_array_elements(p_payload->'reports') loop
      select * into mapping from public.ga4_metric_mappings where mapping_id=(item->>'mappingId')::uuid and connection_id=c.connection_id;
      if not found then raise exception using errcode='42501',message='Mapping unavailable'; end if;
      report:=item->'report'; quality:=report->'quality';
      v_start:=(report->>'start')::date; v_end:=(report->>'end')::date;
      if v_start is null or v_end is null or v_end<v_start or v_end-v_start>179 or v_end>=(now() at time zone c.timezone)::date
        or report->>'timezone' is distinct from c.timezone or jsonb_typeof(report->'observations') is distinct from 'array'
        or report->>'fetchedAt' is null or (report->>'fetchedAt')::timestamptz>now()+interval '1 minute' or (report->>'fetchedAt')::timestamptz<now()-interval '10 minutes'
        or jsonb_typeof(quality) is distinct from 'object' then raise exception using errcode='22023',message='Invalid report range'; end if;
      if (select count(*) from jsonb_object_keys(quality))<>4 or exists(select 1 from unnest(array['thresholded','sampled','otherRow','restricted']) q where jsonb_typeof(quality->q) is distinct from 'boolean') then
        raise exception using errcode='22023',message='Quality flags required'; end if;
      v_rows:=jsonb_array_length(report->'observations');
      if v_rows>180 or v_rows is distinct from (report->>'rowCount')::integer
        or (v_end-v_start+1-v_rows) is distinct from (report->>'missingDays')::integer
        or exists(select 1 from jsonb_to_recordset(report->'observations') as o(date date,value numeric)
          where o.date is null or o.date<v_start or o.date>v_end or o.value is null or o.value<0 or o.value>1e15 or trunc(o.value)<>o.value)
        or v_rows<>(select count(distinct o.date) from jsonb_to_recordset(report->'observations') as o(date date,value numeric)) then
        raise exception using errcode='22023',message='Invalid daily observations'; end if;
      v_status:=case when quality @> '{"thresholded":false,"sampled":false,"otherRow":false,"restricted":false}' then 'accepted' else 'withheld' end;
      insert into public.ga4_sync_receipts(lease_id,mapping_id,scope_id,generation,status,start_date,end_date,timezone,row_count,missing_days,content_hash,quality,fetched_at)
        values(credential.lease_id,mapping.mapping_id,c.scope_id,c.generation,v_status,v_start,v_end,c.timezone,v_rows,v_end-v_start+1-v_rows,
          encode(extensions.digest(report::text,'sha256'),'hex'),quality,(report->>'fetchedAt')::timestamptz) returning receipt_id into v_receipt;
      if v_status='accepted' then
        -- A complete provider window is authoritative: vanished rows become gaps.
        delete from public.metric_observations where metric_id=mapping.metric_id and obs_date between v_start and v_end
          and obs_date not in(select o.date from jsonb_to_recordset(report->'observations') as o(date date,value numeric));
        insert into public.metric_observations(metric_id,obs_date,value)
          select mapping.metric_id,o.date,o.value from jsonb_to_recordset(report->'observations') as o(date date,value numeric)
          on conflict(metric_id,obs_date) do update set value=excluded.value;
      end if;
      update public.ga4_metric_mappings set last_receipt_id=v_receipt where mapping_id=mapping.mapping_id;
      perform private.enqueue_current_causal_recompute(c.scope_id,mapping.metric_id,'ga4_sync',c.actor_id);
    end loop;
    update public.ga4_connections set status='connected',attempts=0,error_code=null,last_sync_at=now(),next_sync_at=now()+interval '1 day' where connection_id=c.connection_id;
  elsif p_action='fail' then
    if coalesce(p_payload->>'code','') not in ('reauthorize','permission','quota','unavailable','invalid_response') then raise exception using errcode='22023',message='Invalid failure code'; end if;
    update public.ga4_connections set status=case when p_payload->>'code' in ('reauthorize','permission') then 'reauthorize' else 'error' end,
      error_code=p_payload->>'code',attempts=least(attempts+1,10),next_sync_at=now()+make_interval(mins=>least(1440,15*(2^least(attempts,7))::integer))
      where connection_id=c.connection_id;
    for mapping in select * from public.ga4_metric_mappings where connection_id=c.connection_id loop
      perform private.enqueue_current_causal_recompute(c.scope_id,mapping.metric_id,'ga4_sync_failed',c.actor_id);
    end loop;
  elsif p_action is distinct from 'release' then raise exception using errcode='22023',message='Unknown worker operation';
  end if;
  update private.ga4_credentials set lease_id=null,lease_until=null where connection_id=c.connection_id;
  return jsonb_build_object('connectionId',c.connection_id);
end;
$$;

create function public.ga4_manage_v1(p_action text,p_scope uuid,p_connection uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ga4_manage(p_action,p_scope,p_connection,p_payload); $$;
create function public.ga4_worker_v1(p_action text,p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select private.ga4_worker(p_action,p_payload); $$;
revoke all on function private.ga4_has_admin(uuid,uuid), private.ga4_lock_admin(uuid,uuid), private.ga4_manage(text,uuid,uuid,jsonb),
  private.ga4_worker(text,jsonb), public.ga4_manage_v1(text,uuid,uuid,jsonb), public.ga4_worker_v1(text,jsonb) from public,anon,authenticated,service_role,causent_ga4_worker;
grant usage on schema private to authenticated;
grant execute on function private.ga4_manage(text,uuid,uuid,jsonb), public.ga4_manage_v1(text,uuid,uuid,jsonb) to authenticated;
grant execute on function private.ga4_worker(text,jsonb), public.ga4_worker_v1(text,jsonb) to causent_ga4_worker;

-- Connector observations are provider-owned, including when reached through
-- older general metric mutation paths. Account deletion cascades still work.
create function private.guard_ga4_observation() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_metric uuid;
begin
  v_metric:=case when tg_op='DELETE' then old.metric_id else new.metric_id end;
  if exists(select 1 from public.ga4_metric_mappings where metric_id=v_metric)
    and coalesce(auth.jwt()->>'role','')<>'causent_ga4_worker'
    and not (tg_op='DELETE' and pg_trigger_depth()>1) then raise exception using errcode='42501',message='Connector observations are provider-owned'; end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and old.metric_id<>new.metric_id and exists(select 1 from public.ga4_metric_mappings where metric_id=old.metric_id) then
    raise exception using errcode='42501',message='Connector observation identity is immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_ga4_observation() from public,anon,authenticated,service_role;
create trigger guard_ga4_observation before insert or update or delete on public.metric_observations for each row execute function private.guard_ga4_observation();

create or replace function private.validate_measurement_plan() returns trigger language plpgsql set search_path='' as $$
begin
  if new.exposure_start <= (now() at time zone (select tz from public.metrics where metric_id=new.metric_id))::date or exists(
    select 1 from public.metric_observations where metric_id=new.metric_id and obs_date>=new.exposure_start
  ) then
    raise exception using errcode='22023',message='Register before first exposure and before observing post-exposure data';
  end if;
  if not exists (
    select 1 from public.decision_report_activations a
    join public.decision_reports r on r.active_activation_id=a.activation_id and r.report_id=a.report_id
    join public.decision_report_series s on s.series_id=r.series_id and s.current_active_report_id=r.report_id
    join public.workspaces w on w.current_decision_report_series_id=s.series_id and w.workspace_id=a.scope_id
    where a.activation_id=new.activation_id and a.scope_id=new.scope_id and a.metric_id=new.metric_id
      and a.primary_lever_action_id=any(a.action_ids) and w.archived_at is null
      and r.status='active' and r.deleted_at is null
  ) then
    raise exception using errcode='22023',message='A current activation with a registered primary outcome is required';
  end if;
  new.created_at:=now();
  return new;
end $$;

create view public.ga4_metric_health with (security_invoker=true) as
select m.metric_id,m.scope_id,m.connection_id,m.provider_metric,r.receipt_id,r.row_count,r.missing_days,r.start_date,r.end_date,c.timezone,
  case when c.status<>'connected' or r.receipt_id is null or r.generation<>c.generation or not exists(
    select 1 from public.workspaces w join public.projects p on p.project_id=w.project_id
    join public.memberships a on a.org_id=p.org_id and a.user_id=c.actor_id
      and (a.project_id is null or a.project_id=w.project_id)
      and (a.workspace_id is null or a.workspace_id=w.workspace_id)
    where w.workspace_id=c.scope_id and w.archived_at is null and a.role in ('owner','admin')
  ) then 'GA4_SYNC_REQUIRED'
  when r.status<>'accepted' then 'GA4_QUALITY_RESTRICTED'
  when (now() at time zone c.timezone)::date>r.end_date+3 then 'GA4_DATA_STALE'
  else null end as reason
from public.ga4_metric_mappings m join public.ga4_connections c using(connection_id)
left join public.ga4_sync_receipts r on r.receipt_id=m.last_receipt_id;
revoke all on public.ga4_metric_health from public,anon,authenticated,service_role;
grant select on public.ga4_metric_health to authenticated,service_role;

create function private.guard_ga4_metric() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.ga4_metric_mappings where metric_id=old.metric_id)
    and coalesce(auth.jwt()->>'role','')<>'causent_ga4_worker' then
    if tg_op='DELETE' then
      if pg_trigger_depth()>1 then return old; end if;
      raise exception using errcode='42501',message='Disconnect the provider to stop collection; metric history is retained';
    end if;
    if (new.metric_id,new.scope_id,new.source,new.unit,new.tz,new.granularity) is distinct from
      (old.metric_id,old.scope_id,old.source,old.unit,old.tz,old.granularity) then
      raise exception using errcode='42501',message='Connector metric identity is immutable';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_ga4_metric() from public,anon,authenticated,service_role;
create trigger guard_ga4_metric before update or delete on public.metrics for each row execute function private.guard_ga4_metric();
create or replace view public.current_edge_readouts with (security_invoker = true) as
select e.edge_id, e.scope_id, s.semantic_ref as action_id, t.semantic_ref as metric_id,
  r.evaluation_id, r.input_hash, r.model_version,
  case when i.evidence_id is not null then 'computed'
       when e.evaluation_id is not null then 'incomplete'
       when e.authoritative_method = 'MANUAL' then 'manual' else 'legacy_unverified' end as provenance,
  coalesce(i.result_direction, 'INCONCLUSIVE') as direction,
  i.result_belief as belief_score, i.result_reason as belief_reason,
  i.lift, i.ci_low, i.ci_high, i.n_pre, i.n_post,
  d.lift as descriptive_lift, d.ci_low as descriptive_ci_low, d.ci_high as descriptive_ci_high,
  d.n_pre as descriptive_n_pre, d.n_post as descriptive_n_post, coalesce(d.clustered, false) as descriptive_clustered,
  case when gate.reason is not null then 'waiting' else coalesce(r.interpretation,'legacy_unverified') end as interpretation, coalesce(gate.reason,r.refusal_reason) as refusal_reason
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
left join public.ga4_metric_health health on health.metric_id=t.semantic_ref and health.scope_id=e.scope_id
left join lateral (select case when health.metric_id is null then null
  when health.reason is not null then health.reason
  when r.input_manifest #>> '{ga4_provenance,receipt,receipt_id}' is distinct from health.receipt_id::text then 'GA4_ANALYSIS_PENDING'
  else null end as reason) gate on true
left join lateral (
  select i.* from public.evidence_objects i where i.edge_id = e.edge_id and i.scope_id = e.scope_id
    and i.evaluation_id = r.evaluation_id and i.methodology = 'ITS'
  order by i.created_at desc, i.evidence_id desc limit 1
) i on gate.reason is null
left join lateral (
  select d.* from public.evidence_objects d where d.edge_id = e.edge_id and d.scope_id = e.scope_id
    and d.evaluation_id = r.evaluation_id and d.methodology = 'BEFORE_AFTER_14D'
  order by d.created_at desc, d.evidence_id desc limit 1
) d on i.evidence_id is not null;

commit;
