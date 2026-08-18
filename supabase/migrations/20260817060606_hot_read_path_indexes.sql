-- Workload-shaped indexes for the current authenticated read paths. These
-- improve the bounded/sorted portions that already exist; they deliberately do
-- not claim to solve the separately deferred all-history dashboard contract.
-- Supabase CLI replays migrations in a transaction, so the canonical history
-- uses ordinary idempotent DDL. Before applying this migration to a populated
-- production clone, run scripts/query-plans/create-hot-indexes-concurrently.sql;
-- these IF NOT EXISTS statements will then be no-ops during the deploy.

create index if not exists actions_scope_effective_date_idx
  on public.actions(scope_id, effective_date desc, action_id);

create index if not exists decisions_scope_created_at_idx
  on public.decisions(scope_id, created_at desc, decision_id);

create index if not exists decision_report_series_scope_created_at_idx
  on public.decision_report_series(scope_id, created_at desc, series_id);

create index if not exists evidence_objects_scope_method_edge_latest_idx
  on public.evidence_objects(
    scope_id,
    methodology,
    edge_id,
    created_at desc,
    evidence_id desc
  );

create index if not exists levers_scope_open_created_idx
  on public.levers(scope_id, status, created_at, lever_id)
  where status in ('DRAFTED', 'CREATED');
