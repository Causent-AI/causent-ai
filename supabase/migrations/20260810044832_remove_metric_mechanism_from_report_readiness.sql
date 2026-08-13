-- Review round 2 keeps the report aggregate structured while removing the
-- proposed metric-mechanism narrative from the database-owned readiness gate.
-- Supporting evidence and metric rationale may be added later; the decision
-- context and an executable plan still have to be complete before activation.
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
    and private.claim_list_has_complete(value #> '{decision,background}')
    and private.claim_list_has_complete(value #> '{decision,problem}')
    and private.claim_list_has_complete(value #> '{decision,decision}')
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
