-- Align the database-owned report-ready boundary with the challenge-first
-- onboarding contract. Core context is required; supporting evidence remains
-- useful but may be added after the initial decision is framed.
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
