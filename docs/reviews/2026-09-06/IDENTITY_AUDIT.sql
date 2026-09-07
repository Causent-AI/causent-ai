-- READ ONLY. Run with psql and a reviewed JSON mapping, for example:
-- psql "$DATABASE_URL" -v verified_mappings='[]' -f IDENTITY_AUDIT.sql
-- Each optional mapping: {"action_id":"UUID","canonical_ref":"github:repo:id:123:pr:42","source_url":"https://github.com/acme/app/pull/42"}
-- An empty array inventories every unresolved alias without guessing identities.
with verified_mapping as (
  select * from jsonb_to_recordset(:'verified_mappings'::jsonb)
    as m(action_id uuid, canonical_ref text, source_url text)
), candidates as (
  select a.scope_id, a.action_id, a.alias, a.source_url, a.resolution,
    m.canonical_ref, m.source_url as verified_source_url,
    current_action.external_ref as current_ref,
    collision.action_id as colliding_action_id
  from public.action_identity_aliases a
  join public.actions current_action on current_action.action_id = a.action_id
  left join verified_mapping m on m.action_id = a.action_id
  left join public.actions collision on collision.scope_id = a.scope_id
    and collision.external_ref = m.canonical_ref and collision.action_id <> a.action_id
)
select *, case
  when canonical_ref is null then 'provider verification required'
  when canonical_ref !~ '^github:repo:id:[1-9][0-9]*:(pr|issue):[1-9][0-9]*$' then 'invalid canonical identity'
  when source_url is null or source_url is distinct from verified_source_url then 'source provenance mismatch'
  when alias <> regexp_replace(canonical_ref, '^github:repo:id:[0-9]+:', 'github:') then 'kind or number mismatch'
  when colliding_action_id is not null then 'collision requires history review'
  when count(*) over (partition by scope_id, canonical_ref) > 1 then 'multiple mappings require review'
  when resolution = 'verified' and current_ref = canonical_ref then 'already reconciled'
  else 'ready for explicit reconciliation'
end as disposition
from candidates
order by scope_id, alias;
