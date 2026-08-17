-- Production-clone preflight for 20260817060606_hot_read_path_indexes.sql.
--
-- Run this file outside a transaction, one statement at a time, before the
-- canonical migration reaches a populated environment. The migration uses the
-- same names with IF NOT EXISTS, so it becomes a metadata-only replay after
-- these online builds succeed.

create index concurrently if not exists actions_scope_effective_date_idx
  on public.actions(scope_id, effective_date desc, action_id);

create index concurrently if not exists decisions_scope_created_at_idx
  on public.decisions(scope_id, created_at desc, decision_id);

create index concurrently if not exists decision_report_series_scope_created_at_idx
  on public.decision_report_series(scope_id, created_at desc, series_id);

create index concurrently if not exists evidence_objects_scope_method_edge_latest_idx
  on public.evidence_objects(
    scope_id,
    methodology,
    edge_id,
    created_at desc,
    evidence_id desc
  );

create index concurrently if not exists levers_scope_open_created_idx
  on public.levers(scope_id, status, created_at, lever_id)
  where status in ('DRAFTED', 'CREATED');
