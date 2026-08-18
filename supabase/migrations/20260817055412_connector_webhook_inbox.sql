-- Durable, retry-safe connector webhook ingestion.
--
-- A verified provider delivery is first identified by (provider,
-- provider_event_id, payload_digest). The checked RPC then records the
-- transition, attributes an active lever, and marks the inbox row processed in
-- one database transaction. A failed canonical mutation therefore remains
-- retryable instead of being hidden behind transition_events' dedup key.

alter table public.levers
  add column target_origin text,
  add constraint levers_target_origin_check check (
    target_origin is null
    or (
      char_length(target_origin) between 9 and 2048
      and target_origin ~ '^https://[^/[:space:]]+(?::[0-9]+)?$'
    )
  );

-- GitHub has only ever been drafted against github.com, so its historical
-- origin is deterministic. Jira Cloud/Data Center sites are tenant-specific:
-- recover them only when every non-empty historical URL parses as the same
-- conservative HTTPS origin. Missing, malformed, or conflicting evidence stays
-- NULL and is handled by the fail-closed quarantine below.
create function private.connector_https_origin_for_backfill(p_value text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  v_match text[];
  v_host text;
  v_port integer;
begin
  v_match := pg_catalog.regexp_match(
    pg_catalog.btrim(p_value),
    '^(https://([a-z0-9][a-z0-9.-]*)(:([0-9]{1,5}))?)([/#?]|$)',
    'i'
  );
  if v_match is null then
    return null;
  end if;

  v_host := pg_catalog.lower(v_match[2]);
  if pg_catalog.char_length(v_host) > 253
     or v_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
     or pg_catalog.strpos(v_host, '..') > 0
     or pg_catalog.strpos(v_host, '.-') > 0
     or pg_catalog.strpos(v_host, '-.') > 0
     or exists (
       select 1
         from pg_catalog.unnest(pg_catalog.string_to_array(v_host, '.')) as label(value)
        where pg_catalog.char_length(label.value) > 63
     ) then
    return null;
  end if;

  if v_match[4] is not null then
    v_port := v_match[4]::integer;
    if v_port not between 1 and 65535 then
      return null;
    end if;
  end if;

  return 'https://' || v_host || case
    when v_port is null or v_port = 443 then ''
    else ':' || v_port::text
  end;
end;
$$;

update public.levers as lever
   set target_origin = 'https://github.com'
 where lever.target_source = 'github'
   and lever.target_origin is null;

with raw_candidates as (
  select
    lever.lever_id,
    candidate.value
  from public.levers as lever
  join public.actions as action
    on action.action_id = lever.action_id
   and action.scope_id = lever.scope_id
  cross join lateral (
    values
      (lever.drafted_payload->>'target_origin'),
      (lever.drafted_payload->>'detected_url'),
      (lever.drafted_payload->>'deep_link'),
      (action.rationale_richtext #>> '{meta,target_origin}'),
      (action.rationale_richtext #>> '{meta,source_url}')
  ) as candidate(value)
  where lever.target_source = 'jira'
    and lever.target_origin is null
    and pg_catalog.btrim(coalesce(candidate.value, '')) <> ''
), normalized_candidates as (
  select
    candidate.lever_id,
    private.connector_https_origin_for_backfill(candidate.value) as origin
  from raw_candidates as candidate
), deterministic_origins as (
  select
    candidate.lever_id,
    pg_catalog.min(candidate.origin) as origin
  from normalized_candidates as candidate
  group by candidate.lever_id
  having pg_catalog.count(*) = pg_catalog.count(candidate.origin)
     and pg_catalog.count(distinct candidate.origin) = 1
)
update public.levers as lever
   set target_origin = origin.origin
  from deterministic_origins as origin
 where lever.lever_id = origin.lever_id
   and lever.target_origin is null;

drop function private.connector_https_origin_for_backfill(text);

comment on column public.levers.target_origin is
  'Normalized connector tracker origin. NULL identifies non-webhook mappings or legacy Jira rows whose site could not be derived safely; matching Jira deliveries are quarantined until explicitly rebound.';

create table public.connector_webhook_inbox (
  inbox_id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github', 'jira')),
  provider_event_id text not null check (
    char_length(provider_event_id) between 1 and 512
  ),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  provenance_token text not null check (
    char_length(provenance_token) between 1 and 512
  ),
  target_ref text not null check (char_length(target_ref) between 1 and 512),
  target_origin text not null check (
    char_length(target_origin) between 9 and 2048
    and target_origin ~ '^https://[^/[:space:]]+(?::[0-9]+)?$'
  ),
  canonical text not null check (
    canonical in ('LEVER_DROPPED', 'LEVER_SHIPPED', 'LEVER_ACTIVE')
  ),
  external_ref text not null check (char_length(external_ref) between 1 and 512),
  external_url text check (external_url is null or char_length(external_url) <= 2048),
  provider_status text check (provider_status is null or char_length(provider_status) <= 256),
  transition_ts timestamptz not null,
  raw_payload jsonb not null,
  -- Once a delivery resolves to a workspace it belongs to that tenant's
  -- durable audit stream. A workspace hard-delete must remove the delivery as
  -- well; leaving a provider-global tombstone would make a future isolated
  -- fixture (or restored tenant) collide with an unrelated historical event.
  scope_id uuid references public.workspaces(workspace_id) on delete cascade,
  lever_id uuid references public.levers(lever_id) on delete set null,
  action_id uuid references public.actions(action_id) on delete set null,
  status text not null default 'received' check (
    status in ('received', 'processing', 'processed', 'failed', 'quarantined', 'dead_letter')
  ),
  attempts integer not null default 0 check (attempts between 0 and 5),
  last_error text,
  next_attempt_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  quarantined_at timestamptz,
  dead_lettered_at timestamptz,
  unique (provider, provider_event_id),
  check (pg_column_size(raw_payload) <= 524288),
  check (
    (status = 'processed'
      and processed_at is not null
      and quarantined_at is null
      and dead_lettered_at is null
      and next_attempt_at is null)
    or (status = 'quarantined'
      and processed_at is null
      and quarantined_at is not null
      and dead_lettered_at is null
      and next_attempt_at is null)
    or (status = 'dead_letter'
      and processed_at is null
      and quarantined_at is null
      and dead_lettered_at is not null
      and next_attempt_at is null)
    or (status in ('received', 'processing')
      and processed_at is null
      and quarantined_at is null
      and dead_lettered_at is null
      and next_attempt_at is null)
    or (status = 'failed'
      and processed_at is null
      and quarantined_at is null
      and dead_lettered_at is null
      and next_attempt_at is not null)
  )
);

create index connector_webhook_inbox_retry_idx
  on public.connector_webhook_inbox(next_attempt_at, received_at, inbox_id)
  where status = 'failed';
create index connector_webhook_inbox_scope_idx
  on public.connector_webhook_inbox(scope_id, received_at desc, inbox_id);
create index connector_webhook_inbox_lever_idx
  on public.connector_webhook_inbox(lever_id)
  where lever_id is not null;
create index connector_webhook_inbox_action_idx
  on public.connector_webhook_inbox(action_id)
  where action_id is not null;

alter table public.connector_webhook_inbox enable row level security;
revoke all on table public.connector_webhook_inbox from anon, authenticated;
grant select, insert, update on table public.connector_webhook_inbox to service_role;

create function public.process_connector_webhook_v1(
  p_provider text,
  p_provider_event_id text,
  p_payload_digest text,
  p_provenance_token text,
  p_target_ref text,
  p_target_origin text,
  p_canonical text,
  p_external_ref text,
  p_external_url text,
  p_provider_status text,
  p_transition_ts timestamptz,
  p_raw_payload jsonb
)
returns table (
  result text,
  resolved_lever_id uuid,
  attempt_count integer,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox public.connector_webhook_inbox%rowtype;
  v_lever public.levers%rowtype;
  v_legacy_lever public.levers%rowtype;
  v_attempts integer;
  v_result text;
  v_error text;
  v_exact_target_exists boolean;
  v_transition_action_id uuid;
  v_transition_canonical text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if p_provider not in ('github', 'jira')
     or coalesce(char_length(p_provider_event_id), 0) not between 1 and 512
     or p_payload_digest !~ '^[0-9a-f]{64}$'
     or coalesce(char_length(p_provenance_token), 0) not between 1 and 512
     or coalesce(char_length(p_target_ref), 0) not between 1 and 512
     or coalesce(char_length(p_target_origin), 0) not between 9 and 2048
     or p_target_origin !~ '^https://[^/[:space:]]+(?::[0-9]+)?$'
     or p_canonical not in ('LEVER_DROPPED', 'LEVER_SHIPPED', 'LEVER_ACTIVE')
     or coalesce(char_length(p_external_ref), 0) not between 1 and 512
     or p_transition_ts is null
     or p_raw_payload is null
     or pg_column_size(p_raw_payload) > 524288 then
    raise exception using errcode = '22023', message = 'INVALID_CONNECTOR_EVENT';
  end if;

  insert into public.connector_webhook_inbox (
    provider,
    provider_event_id,
    payload_digest,
    provenance_token,
    target_ref,
    target_origin,
    canonical,
    external_ref,
    external_url,
    provider_status,
    transition_ts,
    raw_payload
  ) values (
    p_provider,
    p_provider_event_id,
    p_payload_digest,
    p_provenance_token,
    p_target_ref,
    p_target_origin,
    p_canonical,
    p_external_ref,
    p_external_url,
    p_provider_status,
    p_transition_ts,
    p_raw_payload
  )
  on conflict (provider, provider_event_id) do nothing;

  select inbox.*
    into v_inbox
    from public.connector_webhook_inbox as inbox
   where inbox.provider = p_provider
     and inbox.provider_event_id = p_provider_event_id
   for update;

  if v_inbox.payload_digest <> p_payload_digest then
    return query select 'payload_conflict'::text, null::uuid, v_inbox.attempts, true;
    return;
  end if;

  if v_inbox.status = 'processed' then
    return query select 'duplicate'::text, v_inbox.lever_id, v_inbox.attempts, true;
    return;
  end if;

  if v_inbox.status = 'dead_letter' then
    return query select 'dead_letter'::text, v_inbox.lever_id, v_inbox.attempts, true;
    return;
  end if;

  select exists (
    select 1
      from public.levers as lever
     where lever.provenance_token = p_provenance_token
       and lever.target_source = p_provider
       and pg_catalog.lower(pg_catalog.btrim(lever.target_ref)) =
           pg_catalog.lower(pg_catalog.btrim(p_target_ref))
       and lever.target_origin = p_target_origin
  ) into v_exact_target_exists;

  -- A pre-origin Jira lever can identify its project but not its Jira tenant.
  -- Never guess from the incoming event: bind the delivery to the legacy audit
  -- row and quarantine it without spending the retry/dead-letter budget. A
  -- deliberate re-draft can bind the row to this exact site, after which an
  -- identical provider redelivery is allowed to continue below.
  if v_inbox.status = 'quarantined' and not v_exact_target_exists then
    return query select 'quarantined'::text, null::uuid, v_inbox.attempts, true;
    return;
  end if;

  if p_provider = 'jira' and not v_exact_target_exists then
    select lever.*
      into v_legacy_lever
      from public.levers as lever
     where lever.provenance_token = p_provenance_token
       and lever.target_source = 'jira'
       and pg_catalog.lower(pg_catalog.btrim(lever.target_ref)) =
           pg_catalog.lower(pg_catalog.btrim(p_target_ref))
       and lever.target_origin is null
     for update;

    if found then
      update public.connector_webhook_inbox as inbox
         set scope_id = v_legacy_lever.scope_id,
             lever_id = v_legacy_lever.lever_id,
             action_id = v_legacy_lever.action_id,
             status = 'quarantined',
             last_error = 'LEGACY_JIRA_TARGET_ORIGIN_UNBOUND',
             next_attempt_at = null,
             processed_at = null,
             quarantined_at = coalesce(inbox.quarantined_at, now()),
             dead_lettered_at = null
       where inbox.inbox_id = v_inbox.inbox_id;

      return query select 'quarantined'::text, null::uuid, v_inbox.attempts, false;
      return;
    end if;
  end if;

  -- Provider redelivery does not bypass the retry budget while the registered
  -- tracker target is still absent. If the matching lever appeared since the
  -- failure, process immediately instead of waiting for the cron sweep.
  if v_inbox.status = 'failed'
     and v_inbox.next_attempt_at > now()
     and not v_exact_target_exists then
    return query select 'queued_retry'::text, null::uuid, v_inbox.attempts, true;
    return;
  end if;

  update public.connector_webhook_inbox as inbox
     set status = 'processing',
         attempts = inbox.attempts + 1,
         last_error = null,
         next_attempt_at = null,
         processed_at = null,
         quarantined_at = null,
         dead_lettered_at = null
   where inbox.inbox_id = v_inbox.inbox_id
   returning inbox.attempts into v_attempts;

  begin
    -- Resolve without a row lock, then follow the shared action -> lever order
    -- used by manual completion. The second read rechecks the exact provider
    -- target under lock so a concurrent connector/completion cannot deadlock or
    -- swap attribution.
    select lever.*
      into strict v_lever
      from public.levers as lever
     where lever.provenance_token = p_provenance_token
       and lever.target_source = p_provider
       and pg_catalog.lower(pg_catalog.btrim(lever.target_ref)) =
           pg_catalog.lower(pg_catalog.btrim(p_target_ref))
       and lever.target_origin = p_target_origin;

    perform action.action_id
      from public.actions as action
     where action.action_id = v_lever.action_id
       and action.scope_id = v_lever.scope_id
     for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'ACTION_NOT_FOUND';
    end if;

    select lever.*
      into strict v_lever
      from public.levers as lever
     where lever.lever_id = v_lever.lever_id
       and lever.provenance_token = p_provenance_token
       and lever.target_source = p_provider
       and pg_catalog.lower(pg_catalog.btrim(lever.target_ref)) =
           pg_catalog.lower(pg_catalog.btrim(p_target_ref))
       and lever.target_origin = p_target_origin
     for update;

    update public.connector_webhook_inbox as inbox
       set scope_id = v_lever.scope_id,
           lever_id = v_lever.lever_id,
           action_id = v_lever.action_id
     where inbox.inbox_id = v_inbox.inbox_id;

    insert into public.transition_events (
      action_id,
      canonical,
      source,
      provider_event_id,
      transition_ts,
      to_status,
      raw_payload
    ) values (
      v_lever.action_id,
      p_canonical,
      p_provider,
      p_provider_event_id,
      p_transition_ts,
      p_provider_status,
      p_raw_payload
    )
    on conflict (source, provider_event_id) do nothing;

    select event.action_id, event.canonical
      into v_transition_action_id, v_transition_canonical
      from public.transition_events as event
     where event.source = p_provider
       and event.provider_event_id = p_provider_event_id;
    if v_transition_action_id is distinct from v_lever.action_id
       or v_transition_canonical is distinct from p_canonical then
      raise exception using errcode = '55000', message = 'TRANSITION_IDENTITY_CONFLICT';
    end if;

    if p_canonical = 'LEVER_ACTIVE' then
      update public.actions as action
         set external_ref = p_external_ref
       where action.action_id = v_lever.action_id
         and action.scope_id = v_lever.scope_id;
      if not found then
        raise exception using errcode = 'P0002', message = 'ACTION_NOT_FOUND';
      end if;

      if v_lever.status not in ('DETECTED', 'SHIPPED') then
        update public.levers as lever
           set status = 'DETECTED',
               detected_at = p_transition_ts,
               drafted_payload = coalesce(lever.drafted_payload, '{}'::jsonb)
                 || jsonb_build_object('detected_url', p_external_url)
         where lever.lever_id = v_lever.lever_id
           and lever.scope_id = v_lever.scope_id;
        if not found then
          raise exception using errcode = 'P0002', message = 'LEVER_NOT_FOUND';
        end if;
      end if;
      v_result := 'detected';
    else
      v_result := 'ignored_untracked_action';
    end if;

    update public.connector_webhook_inbox as inbox
       set status = 'processed',
           processed_at = now(),
           quarantined_at = null,
           dead_lettered_at = null,
           next_attempt_at = null,
           last_error = null
     where inbox.inbox_id = v_inbox.inbox_id;
  exception
    when others then
      v_error := left(sqlstate || ':' || sqlerrm, 1000);
      update public.connector_webhook_inbox as inbox
         set status = case when v_attempts >= 5 then 'dead_letter' else 'failed' end,
             last_error = v_error,
             processed_at = null,
             quarantined_at = null,
             next_attempt_at = case
               when v_attempts >= 5 then null
               else now() + least(interval '1 hour', interval '30 seconds' * power(2, v_attempts - 1))
             end,
             dead_lettered_at = case when v_attempts >= 5 then now() else null end
       where inbox.inbox_id = v_inbox.inbox_id;

      return query select
        case when v_attempts >= 5 then 'dead_letter' else 'queued_retry' end::text,
        null::uuid,
        v_attempts,
        false;
      return;
  end;

  return query select v_result, v_lever.lever_id, v_attempts, false;
end;
$$;

create function public.retry_connector_webhook_inbox_v1(p_limit integer default 20)
returns table (
  inbox_id uuid,
  result text,
  resolved_lever_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connector_webhook_inbox%rowtype;
  v_out record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'INVALID_RETRY_LIMIT';
  end if;

  for v_row in
    select inbox.*
      from public.connector_webhook_inbox as inbox
     where inbox.status = 'failed'
       and inbox.next_attempt_at <= now()
     order by inbox.next_attempt_at, inbox.received_at, inbox.inbox_id
     for update skip locked
     limit p_limit
  loop
    select processed.*
      into v_out
      from public.process_connector_webhook_v1(
        v_row.provider,
        v_row.provider_event_id,
        v_row.payload_digest,
        v_row.provenance_token,
        v_row.target_ref,
        v_row.target_origin,
        v_row.canonical,
        v_row.external_ref,
        v_row.external_url,
        v_row.provider_status,
        v_row.transition_ts,
        v_row.raw_payload
      ) as processed;

    return query select
      v_row.inbox_id,
      v_out.result::text,
      v_out.resolved_lever_id::uuid,
      v_out.attempt_count::integer;
  end loop;
end;
$$;

revoke all on function public.process_connector_webhook_v1(
  text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.process_connector_webhook_v1(
  text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb
) to service_role;

revoke all on function public.retry_connector_webhook_inbox_v1(integer)
  from public, anon, authenticated;
grant execute on function public.retry_connector_webhook_inbox_v1(integer)
  to service_role;
