begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"ca5e1111-0000-0000-0000-0000000000d9","role":"authenticated"}',
  true
);

explain (analyze, buffers, format text)
select action_id, effective_date, status
from public.actions
where scope_id = 'ca5e0000-0000-0000-0000-0000000000d3'
order by effective_date desc, action_id
limit 50;

explain (analyze, buffers, format text)
select decision_id, created_at, title
from public.decisions
where scope_id = 'ca5e0000-0000-0000-0000-0000000000d3'
order by created_at desc, decision_id
limit 50;

explain (analyze, buffers, format text)
select series_id, current_active_report_id, created_at
from public.decision_report_series
where scope_id = 'ca5e0000-0000-0000-0000-0000000000d3'
order by created_at desc, series_id
limit 50;

explain (analyze, buffers, format text)
select distinct on (edge_id, methodology)
  evidence_id,
  edge_id,
  methodology,
  created_at
from public.evidence_objects
where scope_id = 'ca5e0000-0000-0000-0000-0000000000d3'
  and methodology in ('ITS', 'BEFORE_AFTER_14D')
order by edge_id, methodology, created_at desc, evidence_id desc;

explain (analyze, buffers, format text)
select lever_id, provenance_token, target_source, created_at
from public.levers
where scope_id = 'ca5e0000-0000-0000-0000-0000000000d3'
  and status in ('DRAFTED', 'CREATED')
order by created_at, lever_id
limit 100;

rollback;
