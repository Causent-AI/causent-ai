-- Slice 10 ingestion provenance hardening.
--
-- Version 1 snapshots remain readable historical records. Version 2 is the
-- only format accepted for newly authored content and carries bounded,
-- RLS-protected source chunks with cryptographic digests. A legacy v1 active
-- report may be cloned into a successor, but that successor must be explicitly
-- upgraded/saved as v2 before activation.

create function private.decision_report_v2_provenance_is_valid(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_source jsonb;
  v_chunk jsonb;
  v_claim jsonb;
  v_source_id text;
  v_chunk_id text;
  v_chunk_text text;
  v_source_text text;
  v_source_ids text[] := array[]::text[];
  v_chunk_ids text[] := array[]::text[];
  v_first_chunk boolean;
begin
  if pg_catalog.jsonb_typeof(value) <> 'object'
     or value->>'schemaVersion' <> '2'
     or pg_catalog.jsonb_typeof(value->'sourceSummaries') <> 'array'
     or pg_catalog.jsonb_array_length(value->'sourceSummaries') > 3 then
    return false;
  end if;

  for v_source in
    select source.value
    from pg_catalog.jsonb_array_elements(value->'sourceSummaries') as source(value)
  loop
    v_source_id := v_source->>'sourceId';
    if pg_catalog.jsonb_typeof(v_source) <> 'object'
       or pg_catalog.length(pg_catalog.btrim(coalesce(v_source_id, ''))) not between 1 and 120
       or v_source_id = any(v_source_ids)
       or v_source->>'kind' not in ('brief', 'url', 'pdf')
       or pg_catalog.length(pg_catalog.btrim(coalesce(v_source->>'label', ''))) not between 1 and 160
       or pg_catalog.length(coalesce(v_source->>'locator', '')) > 2048
       or pg_catalog.length(coalesce(v_source->>'finalOrigin', '')) > 255
       or coalesce(v_source->>'retrievedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
       or coalesce(v_source->>'contentSha256', '') !~ '^[0-9a-f]{64}$'
       or pg_catalog.jsonb_typeof(v_source->'chunks') <> 'array'
       or pg_catalog.jsonb_array_length(v_source->'chunks') not between 1 and 64 then
      return false;
    end if;
    if (v_source->>'kind' = 'url') is distinct from
       (pg_catalog.jsonb_typeof(v_source->'finalOrigin') = 'string') then
      return false;
    end if;
    if v_source->>'kind' = 'url'
       and coalesce(v_source->>'finalOrigin', '') !~ '^https://[^/?#]+$' then
      return false;
    end if;
    if v_source->>'kind' <> 'url'
       and pg_catalog.jsonb_typeof(v_source->'finalOrigin') <> 'null' then
      return false;
    end if;
    if pg_catalog.jsonb_typeof(v_source->'pageCount') <> 'null' then
      if pg_catalog.jsonb_typeof(v_source->'pageCount') <> 'number'
         or coalesce(v_source->>'pageCount', '') !~ '^[0-9]+$'
         or (v_source->>'pageCount')::integer not between 1 and 40 then
        return false;
      end if;
    end if;

    v_source_ids := pg_catalog.array_append(v_source_ids, v_source_id);
    v_source_text := '';
    v_first_chunk := true;
    for v_chunk in
      select chunk.value
      from pg_catalog.jsonb_array_elements(v_source->'chunks') as chunk(value)
    loop
      v_chunk_id := v_chunk->>'chunkId';
      v_chunk_text := v_chunk->>'text';
      if pg_catalog.jsonb_typeof(v_chunk) <> 'object'
         or pg_catalog.length(pg_catalog.btrim(coalesce(v_chunk_id, ''))) not between 1 and 120
         or v_chunk_id = any(v_chunk_ids)
         or pg_catalog.length(coalesce(v_chunk->>'locator', '')) > 2048
         or pg_catalog.length(pg_catalog.btrim(coalesce(v_chunk_text, ''))) not between 1 and 2000
         or coalesce(v_chunk->>'contentSha256', '') !~ '^[0-9a-f]{64}$'
         or v_chunk->>'contentSha256' <> pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(v_chunk_text, 'UTF8'), 'sha256'),
           'hex'
         ) then
        return false;
      end if;
      v_chunk_ids := pg_catalog.array_append(v_chunk_ids, v_chunk_id);
      v_source_text := v_source_text || case when v_first_chunk then '' else E'\n\n' end || v_chunk_text;
      v_first_chunk := false;
    end loop;
    if v_source->>'contentSha256' <> pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_source_text, 'UTF8'), 'sha256'),
      'hex'
    ) then
      return false;
    end if;
  end loop;

  for v_claim in
    select claim.value
    from pg_catalog.jsonb_path_query(value, '$.** ? (@.status == "sourced")') as claim(value)
  loop
    if pg_catalog.jsonb_typeof(v_claim) <> 'object'
       or pg_catalog.jsonb_typeof(v_claim->'sourceChunkIds') <> 'array'
       or pg_catalog.jsonb_array_length(v_claim->'sourceChunkIds') < 1
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_claim->'sourceChunkIds') as item(value)
         where pg_catalog.jsonb_typeof(item.value) <> 'string'
            or not ((item.value #>> '{}') = any(v_chunk_ids))
       ) then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

-- A digest proves that a snapshot is internally self-consistent, but it does
-- not prove that its source text came through Causent's bounded ingestion
-- path: an untrusted caller can invent text and recompute SHA-256. Bind the
-- generated corpus and every generated sourced claim to a durable, opaque,
-- one-use receipt minted by the trusted generation server action.
create function private.decision_report_sourced_claim_manifest(value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(claim.value order by claim.value::text),
    '[]'::jsonb
  )
  from pg_catalog.jsonb_path_query(
    value,
    '$.** ? (@.status == "sourced")'
  ) as claim(value);
$$;

create function private.decision_report_claim_manifest_is_subset(
  candidate jsonb,
  allowed jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with candidate_claims as (
    select item.value
    from pg_catalog.jsonb_array_elements(candidate) as item(value)
  ), allowed_claims as (
    select item.value
    from pg_catalog.jsonb_array_elements(allowed) as item(value)
  )
  select
    pg_catalog.jsonb_typeof(candidate) = 'array'
    and pg_catalog.jsonb_typeof(allowed) = 'array'
    and not exists (
      select 1
      from candidate_claims as claimed
      group by claimed.value
      having pg_catalog.count(*) > (
        select pg_catalog.count(*)
        from allowed_claims as minted
        where minted.value = claimed.value
      )
    );
$$;

create table private.decision_report_source_receipts (
  source_receipt_id uuid primary key default extensions.gen_random_uuid(),
  scope_id uuid not null references public.workspaces(workspace_id),
  authored_by uuid references auth.users(id) on delete restrict,
  source_summaries jsonb not null check (
    pg_catalog.jsonb_typeof(source_summaries) = 'array'
  ),
  sourced_claim_manifest jsonb not null check (
    pg_catalog.jsonb_typeof(sourced_claim_manifest) = 'array'
  ),
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_request_hash text check (
    consumed_request_hash is null or consumed_request_hash ~ '^[0-9a-f]{64}$'
  ),
  consumed_report_id uuid,
  consumed_revision_id uuid,
  consumed_status text check (
    consumed_status is null or consumed_status in ('draft', 'report_ready')
  ),
  consumed_content_hash text check (
    consumed_content_hash is null or consumed_content_hash ~ '^[0-9a-f]{32}$'
  ),
  check (expires_at > created_at),
  check (
    (consumed_at is null
      and consumed_request_hash is null
      and consumed_report_id is null
      and consumed_revision_id is null
      and consumed_status is null
      and consumed_content_hash is null)
    or
    (consumed_at is not null
      and consumed_request_hash is not null
      and consumed_report_id is not null
      and consumed_revision_id is not null
      and consumed_status is not null
      and consumed_content_hash is not null)
  )
);

-- The revision trigger consumes this exact transaction-local authorization.
-- Application roles, including service_role, cannot arm it directly.
create table private.decision_report_source_revision_transitions (
  transaction_id xid8 not null,
  source_receipt_id uuid not null,
  report_id uuid not null,
  revision_id uuid not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  primary key (transaction_id, report_id, revision_id)
);

revoke all on private.decision_report_source_receipts
  from public, anon, authenticated, service_role;
revoke all on private.decision_report_source_revision_transitions
  from public, anon, authenticated, service_role;

create or replace function private.decision_report_snapshot_is_ready(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    pg_catalog.jsonb_typeof(value) = 'object'
    and value->>'schemaVersion' in ('1', '2')
    and (value->>'schemaVersion' <> '2' or private.decision_report_v2_provenance_is_valid(value))
    and private.claim_list_has_complete(value #> '{decision,decision}')
    and private.claim_list_has_complete(value #> '{decision,problem}')
    and private.claim_list_has_complete(value #> '{supportingEvidence,factors}')
    and private.claim_list_has_complete(value #> '{supportingEvidence,metricMechanism}')
    and private.claim_list_has_complete(value #> '{implementation,actionPlanSummary}')
    and case
      when pg_catalog.jsonb_typeof(value #> '{implementation,actions}') <> 'array' then false
      else exists (
        select 1
        from pg_catalog.jsonb_array_elements(value #> '{implementation,actions}') as action
        where pg_catalog.btrim(coalesce(action->>'title', '')) <> ''
      )
    end;
$$;

create or replace function private.assert_decision_report_payload(
  report_title text,
  report_status text,
  report_snapshot jsonb,
  projection jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(report_title, ''))) not between 1 and 200 then
    raise exception 'Report title must be 1-200 characters.' using errcode = '22023';
  end if;
  if report_status not in ('draft', 'report_ready') then
    raise exception 'Invalid report status.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(report_snapshot) <> 'object'
     or report_snapshot->>'schemaVersion' not in ('1', '2')
     or pg_catalog.octet_length(report_snapshot::text) > 262144 then
    raise exception 'Invalid Decision Report snapshot.' using errcode = '22023';
  end if;
  if report_snapshot->>'schemaVersion' = '2'
     and not private.decision_report_v2_provenance_is_valid(report_snapshot) then
    raise exception 'Invalid Decision Report source provenance.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(projection) <> 'object'
     or pg_catalog.octet_length(projection::text) > 32768 then
    raise exception 'Invalid metric projection.' using errcode = '22023';
  end if;
  if report_status = 'report_ready'
     and not private.decision_report_snapshot_is_ready(report_snapshot) then
    raise exception 'Required report fields are incomplete.' using errcode = '22023';
  end if;
end;
$$;

create function private.guard_new_decision_report_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.decision_reports%rowtype;
  v_prior_snapshot jsonb;
  v_snapshot_hash text;
  v_candidate_manifest jsonb;
  v_prior_manifest jsonb;
  v_role text := coalesce((select auth.jwt()->>'role'), '');
  v_request_role text := coalesce(pg_catalog.current_setting('role', true), 'none');
begin
  if new.snapshot->>'schemaVersion' = '2' then
    if not private.decision_report_v2_provenance_is_valid(new.snapshot) then
      raise exception 'Invalid Decision Report source provenance.' using errcode = '22023';
    end if;

    select * into v_report
    from public.decision_reports
    where decision_reports.report_id = new.report_id;
    if not found then
      raise exception 'Report not found or unavailable.' using errcode = '42501';
    end if;

    v_candidate_manifest := private.decision_report_sourced_claim_manifest(new.snapshot);

    if new.revision_number = 1 and new.base_revision_id is null then
      -- A checked successor is an exact clone of its predecessor's reviewed
      -- source corpus and sourced claims. The iteration RPC clears only the
      -- private image IDs; it may not manufacture new source provenance.
      if v_report.iteration_number > 1
         and v_report.predecessor_report_id is not null
         and v_report.current_revision_id is null then
        select revision.snapshot into v_prior_snapshot
        from public.decision_reports as predecessor
        join public.decision_report_revisions as revision
          on revision.report_id = predecessor.report_id
         and revision.revision_id = predecessor.reviewed_revision_id
        where predecessor.report_id = v_report.predecessor_report_id
          and predecessor.scope_id = v_report.scope_id;
        if not found
           or v_prior_snapshot->>'schemaVersion' <> '2'
           or new.snapshot->'sourceSummaries' is distinct from
              v_prior_snapshot->'sourceSummaries'
           or v_candidate_manifest is distinct from
              private.decision_report_sourced_claim_manifest(v_prior_snapshot) then
          raise exception 'Report not found or unavailable.' using errcode = '42501';
        end if;
        return new;
      end if;

      v_snapshot_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(new.snapshot::text, 'UTF8'), 'sha256'),
        'hex'
      );
      delete from private.decision_report_source_revision_transitions as transition
      where transition.transaction_id = pg_catalog.pg_current_xact_id()
        and transition.report_id = new.report_id
        and transition.revision_id = new.revision_id
        and transition.snapshot_hash = v_snapshot_hash;
      if found then
        return new;
      end if;

      -- A v2 report that makes no sourced claim and carries no source corpus
      -- has no provenance authority to forge. Keep that user-authored path
      -- available for checked tests/maintenance; generated reports always
      -- carry at least the bounded brief and therefore still require a receipt.
      if new.snapshot->'sourceSummaries' = '[]'::jsonb
         and v_candidate_manifest = '[]'::jsonb then
        return new;
      end if;

      -- Trusted service-role/bootstrap fixtures already own the database and
      -- retain their historical direct path only when no receipt transition
      -- was armed. A local-demo v2 create therefore still consumes its exact
      -- one-shot transition instead of leaving a reusable private capability.
      if auth.uid() is null
         and v_role in ('', 'service_role')
         and v_request_role in ('none', 'postgres', 'service_role') then
        return new;
      end if;

      raise exception 'Report source receipt is unavailable.' using errcode = '42501';
    end if;

    -- After revision 1 the sanitized corpus is immutable, and the sourced
    -- claim multiset may only shrink. Editing a sourced claim clears its
    -- provenance in the UI, which is therefore a valid subset transition.
    select revision.snapshot into v_prior_snapshot
    from public.decision_report_revisions as revision
    where revision.report_id = new.report_id
      and revision.revision_id = new.base_revision_id;
    if not found then
      raise exception 'Report not found or unavailable.' using errcode = '42501';
    end if;
    if v_prior_snapshot->>'schemaVersion' = '2' then
      v_prior_manifest := private.decision_report_sourced_claim_manifest(v_prior_snapshot);
      if new.snapshot->'sourceSummaries' is distinct from
           v_prior_snapshot->'sourceSummaries'
         or not private.decision_report_claim_manifest_is_subset(
           v_candidate_manifest,
           v_prior_manifest
         ) then
        raise exception 'Decision Report source provenance cannot be added or changed.'
          using errcode = '22023';
      end if;
    elsif new.snapshot->'sourceSummaries' is distinct from '[]'::jsonb
       or v_candidate_manifest is distinct from '[]'::jsonb then
      raise exception 'Legacy source provenance cannot be promoted.' using errcode = '22023';
    end if;
    return new;
  end if;

  if v_role <> 'authenticated' then
    return new;
  end if;

  select * into v_report
  from public.decision_reports
  where decision_reports.report_id = new.report_id;

  -- The checked successor RPC is the sole authenticated path allowed to copy
  -- a legacy snapshot. Any subsequent revision must upgrade that copy to v2.
  if v_report.iteration_number > 1
     and v_report.predecessor_report_id is not null
     and v_report.current_revision_id is null
     and new.revision_number = 1
     and new.base_revision_id is null then
    return new;
  end if;

  raise exception 'Legacy Decision Report snapshots cannot be newly authored.' using errcode = '22023';
end;
$$;

create trigger decision_report_revisions_guard_source_provenance
before insert on public.decision_report_revisions
for each row execute function private.guard_new_decision_report_provenance();

create function private.require_successor_provenance_before_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  if old.status is distinct from 'active'
     and new.status = 'active'
     and new.iteration_number > 1 then
    select revision.snapshot into v_snapshot
    from public.decision_report_revisions as revision
    where revision.report_id = new.report_id
      and revision.revision_id = new.reviewed_revision_id;
    if v_snapshot->>'schemaVersion' <> '2'
       or not private.decision_report_v2_provenance_is_valid(v_snapshot) then
      raise exception 'Save this legacy-derived iteration once before activation.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger decision_reports_require_successor_provenance
before update of status on public.decision_reports
for each row execute function private.require_successor_provenance_before_activation();

create function public.mint_decision_report_source_receipt_v1(
  p_scope_id uuid,
  p_authored_by uuid,
  p_generated_snapshot jsonb
)
returns table (
  source_receipt_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt_id uuid := extensions.gen_random_uuid();
  v_expires_at timestamptz := pg_catalog.now() + interval '24 hours';
  v_role text := coalesce((select auth.jwt()->>'role'), '');
  v_request_role text := coalesce(pg_catalog.current_setting('role', true), 'none');
begin
  -- Function ACL is the primary boundary; keep an in-body role assertion as
  -- defense in depth if a future grant is widened accidentally.
  if auth.uid() is not null
     or v_role <> 'service_role'
     or v_request_role not in ('none', 'postgres', 'service_role') then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
  perform 1
  from public.workspaces as workspace
  where workspace.workspace_id = p_scope_id;
  if not found then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
  if p_authored_by is not null and not exists (
    select 1 from auth.users as actor where actor.id = p_authored_by
  ) then
    raise exception 'Report not found or unavailable.' using errcode = '42501';
  end if;
  if not private.decision_report_v2_provenance_is_valid(p_generated_snapshot)
     or pg_catalog.octet_length(p_generated_snapshot::text) > 262144 then
    raise exception 'Invalid Decision Report source provenance.' using errcode = '22023';
  end if;

  insert into private.decision_report_source_receipts (
    source_receipt_id,
    scope_id,
    authored_by,
    source_summaries,
    sourced_claim_manifest,
    expires_at
  ) values (
    v_receipt_id,
    p_scope_id,
    p_authored_by,
    p_generated_snapshot->'sourceSummaries',
    private.decision_report_sourced_claim_manifest(p_generated_snapshot),
    v_expires_at
  );

  return query select v_receipt_id, v_expires_at;
end;
$$;

-- The first authenticated v2 save consumes a server-minted receipt in the
-- same transaction that creates the immutable report/revision identity. A
-- lost acknowledgement can replay the exact request indefinitely; a changed
-- replay conflicts and the receipt can never authorize a second report.
create function public.create_decision_report_v2(
  p_scope_id uuid,
  p_title text,
  p_status text,
  p_snapshot jsonb,
  p_metric_projection jsonb,
  p_authored_by uuid,
  p_source_receipt_id uuid
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
  v_receipt private.decision_report_source_receipts%rowtype;
  v_report_id uuid := extensions.gen_random_uuid();
  v_revision_id uuid := extensions.gen_random_uuid();
  v_saved_at timestamptz := pg_catalog.now();
  v_content_hash text;
  v_request_hash text;
  v_snapshot_hash text;
  v_candidate_manifest jsonb;
begin
  -- Authenticate the workspace before resolving the opaque receipt so a
  -- forged scope/receipt pair cannot be used as an existence oracle.
  perform private.assert_decision_report_write(p_scope_id, p_authored_by);
  perform private.assert_decision_report_payload(
    p_title,
    p_status,
    p_snapshot,
    p_metric_projection
  );
  if p_snapshot->>'schemaVersion' <> '2' then
    raise exception 'Legacy Decision Report snapshots cannot be newly authored.'
      using errcode = '22023';
  end if;

  select * into v_receipt
  from private.decision_report_source_receipts as receipt
  where receipt.source_receipt_id = p_source_receipt_id
    and receipt.scope_id = p_scope_id
    and receipt.authored_by is not distinct from p_authored_by
  for update;
  if not found then
    raise exception 'Report source receipt is unavailable.' using errcode = '42501';
  end if;

  v_candidate_manifest := private.decision_report_sourced_claim_manifest(p_snapshot);
  if p_snapshot->'sourceSummaries' is distinct from v_receipt.source_summaries
     or not private.decision_report_claim_manifest_is_subset(
       v_candidate_manifest,
       v_receipt.sourced_claim_manifest
     ) then
    raise exception 'Generated source receipt does not match report provenance.'
      using errcode = '22023';
  end if;

  v_content_hash := pg_catalog.md5(
    p_snapshot::text || E'\n' || p_metric_projection::text
  );
  v_request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'title', pg_catalog.btrim(p_title),
          'status', p_status,
          'snapshot', p_snapshot,
          'metricProjection', p_metric_projection
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_receipt.consumed_at is not null then
    if v_receipt.consumed_request_hash is distinct from v_request_hash then
      raise exception 'SOURCE_RECEIPT_ALREADY_USED' using errcode = 'PT409';
    end if;
    return query
    select
      v_receipt.consumed_report_id,
      v_receipt.consumed_revision_id,
      null::uuid,
      v_receipt.consumed_status,
      v_receipt.consumed_content_hash,
      true,
      v_receipt.consumed_at;
    return;
  end if;

  if v_receipt.expires_at <= v_saved_at then
    raise exception 'Report source receipt is unavailable.' using errcode = '42501';
  end if;

  insert into public.decision_reports (
    report_id,
    scope_id,
    title,
    status,
    created_by,
    created_at,
    updated_at
  ) values (
    v_report_id,
    p_scope_id,
    pg_catalog.btrim(p_title),
    p_status,
    p_authored_by,
    v_saved_at,
    v_saved_at
  );

  v_snapshot_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  insert into private.decision_report_source_revision_transitions (
    transaction_id,
    source_receipt_id,
    report_id,
    revision_id,
    snapshot_hash
  ) values (
    pg_catalog.pg_current_xact_id(),
    p_source_receipt_id,
    v_report_id,
    v_revision_id,
    v_snapshot_hash
  );

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
    v_report_id,
    p_scope_id,
    null,
    1,
    1,
    p_snapshot,
    p_metric_projection,
    v_content_hash,
    p_authored_by,
    v_saved_at
  );

  -- The before-insert guard must consume the exact capability. Make residue a
  -- transaction-failing invariant so a future trigger regression cannot leave
  -- a reusable transition behind, including on the local-demo service role.
  if exists (
    select 1
    from private.decision_report_source_revision_transitions as transition
    where transition.transaction_id = pg_catalog.pg_current_xact_id()
      and transition.report_id = v_report_id
      and transition.revision_id = v_revision_id
  ) then
    raise exception 'Decision Report source authorization was not consumed.'
      using errcode = '55000';
  end if;

  update public.decision_reports
  set current_revision_id = v_revision_id,
      reviewed_revision_id = case
        when p_status = 'report_ready' then v_revision_id
        else null
      end
  where decision_reports.report_id = v_report_id;

  update private.decision_report_source_receipts
  set consumed_at = v_saved_at,
      consumed_request_hash = v_request_hash,
      consumed_report_id = v_report_id,
      consumed_revision_id = v_revision_id,
      consumed_status = p_status,
      consumed_content_hash = v_content_hash
  where decision_report_source_receipts.source_receipt_id = p_source_receipt_id;

  return query
  select
    v_report_id,
    v_revision_id,
    null::uuid,
    p_status,
    v_content_hash,
    false,
    v_saved_at;
end;
$$;

revoke all on function public.mint_decision_report_source_receipt_v1(
  uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.mint_decision_report_source_receipt_v1(
  uuid, uuid, jsonb
) to service_role;

revoke all on function public.create_decision_report_v2(
  uuid, text, text, jsonb, jsonb, uuid, uuid
) from public, anon;
grant execute on function public.create_decision_report_v2(
  uuid, text, text, jsonb, jsonb, uuid, uuid
) to authenticated, service_role;

revoke all on function private.decision_report_v2_provenance_is_valid(jsonb) from public;
revoke all on function private.decision_report_sourced_claim_manifest(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.decision_report_claim_manifest_is_subset(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_new_decision_report_provenance() from public;
revoke all on function private.require_successor_provenance_before_activation() from public;

notify pgrst, 'reload schema';
