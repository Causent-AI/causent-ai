-- Bridge integrity fixes — close data-integrity defects in the persistence bridge
-- (engine/persistence/bridge.py). Paired with the bridge code changes; re-apply with
-- `supabase db reset`. RLS is untouched: new columns/indexes inherit existing policies.

-- ============================================================================
-- FINDING A — make the BH-FDR belief demotion AUDITABLE + reproducible.
-- ============================================================================
-- (1) Admit FDR_DEMOTED as a belief_reason. batch_readout demotes a would-be
--     1.0/POSITIVE edge that fails Benjamini-Hochberg correction across the metric's
--     action family to 0.5/INCONCLUSIVE. It previously wrote belief_reason = NULL, so
--     the edge silently disagreed with its authoritative ITS evidence with no trace.
--     Recording the reason makes the demotion auditable. Mirrors causal.types.BeliefReason.
alter table public.causal_edges
  drop constraint if exists causal_edges_belief_reason_check;
alter table public.causal_edges
  add constraint causal_edges_belief_reason_check
  check (
    belief_reason is null
    or belief_reason in
       ('PLACEBO','AUTOCORRELATION','INSUFFICIENT_HISTORY','DEGENERATE','FDR_DEMOTED')
  );

-- (2) durbin_watson is CONSUMED by belief_direction (the AUTOCORRELATION cap that
--     gates a confident 1.0), but was not a column on evidence_objects, so belief was
--     not reproducible from the authoritative ITS row. Persist it alongside the other
--     raw ITS stats. numeric (matches resid_var/cond_number) — nullable (only an OK
--     readout carries one).
alter table public.evidence_objects
  add column durbin_watson numeric;

-- ============================================================================
-- FINDING D — key clusters on a STABLE identity so a re-run converges.
-- ============================================================================
-- Clusters were unique on the full DATA-DEPENDENT window (…, window_start, window_end).
-- When a later action extended a collision group's window, window_end grew, so ON
-- CONFLICT missed and a NEW cluster row / node / edge was minted while the prior one
-- was orphaned (one group -> two live CLUSTER->METRIC edges). Key on the earliest
-- member (scope, metric, window_start) instead — stable across re-runs — and let the
-- bridge grow window_end in place. Two groups on one metric are >14 days apart, so
-- their earliest-member dates differ: window_start uniquely identifies the group.
drop index if exists public.clusters_scope_metric_window_key;
create unique index clusters_scope_metric_window_start_key
  on public.clusters (scope_id, metric_id, window_start);
