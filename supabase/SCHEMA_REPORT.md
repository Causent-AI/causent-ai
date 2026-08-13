# Causent v1 Schema + RLS Report

Branch: `feat/schema-rls` · Migrations: `20260703223627_v1_schema.sql`, `20260703223628_v1_rls.sql`

Historical note: this report records the original v1 schema review. Later Decision Report
migrations add `decision_reports`, append-only `decision_report_revisions`, and append-only
`decision_report_activations` beginning at `20260722052759_decision_report_persistence.sql`.
Authenticated reads are scope-bound through `has_scope_access`; direct application
writes are revoked and checked security-definer RPCs require member access. The
current isolation gate includes `report_assets`; the complete serialized Node suite covers later
report, rollout, iteration, provenance, RLS, and Storage surfaces as well. PR #29 merged those
contracts after its hosted app/engine/RLS/bridge gate passed.

Review round 1 introduces no migration, RLS policy, RPC, or Storage change. Optional action priority,
tags, skills, estimated time, and estimated cost remain validated fields inside the existing
append-only `report_snapshot` JSON. Active snapshots and canonical action rows remain immutable. The
Gummy Alpha review CSV updates the already confirmed metric through the existing checked import RPC,
and the loopback-only local recompute command uses the existing private queue/worker contract.

Review round 2 adds ordered forward migrations
`20260810005135_make_decision_report_evidence_optional.sql` and
`20260810044832_remove_metric_mechanism_from_report_readiness.sql`. Together they replace only the
private immutable readiness predicate: Background, Problem, Decision, Action Plan summary, and at
least one titled action are required, while supporting evidence and metric rationale may remain
missing. The later replacement intentionally preserves the function's owner and existing execute
privileges. No table, RLS, grant, Storage, canonical-row, or active-report mutation contract changes.

The 2026-08-10 Northstar completed-loop review adds no migration, table, policy, grant, RPC, trigger,
or Storage path. Its loopback-only setup helper calls the existing checked
`import_workspace_metric_csv_v1` and `set_workspace_core_metric_v1` functions as the local workspace
owner, imports a dedicated synthetic daily metric, and selects four populated context metrics. It
records the workspace current-series pointer before and after and aborts if that identity changes.
The report itself still activates one confirmed metric, one prediction, one primary lever, and one to
three actions through `activate_decision_report_v2`; recompute and resolution use the existing queue,
worker, graph, and verdict contracts.

The 2026-08-12 production-release preflight was read-only. The local Supabase CLI is neither
authenticated nor linked to the production project, so it did not verify remote migration history,
perform a dry-run, or apply any schema change. Treat migrations `20260723053444`, `20260723061012`,
`20260723061925`, `20260723064500`, `20260723151939`, `20260810005135`, and `20260810044832` as
pending until an authenticated history comparison proves the exact subset. Then dry-run and apply
only that subset before authenticated RLS, Storage, provenance-receipt, recompute-status, and
successor-isolation canaries. The 122-row Northstar fixture is local-only synthetic data and must
never be production-seeded.

Slice 8 adds a private `decision-report-assets` bucket and the `report_assets` lifecycle table.
Application roles have scoped SELECT only; checked security-definer RPCs reserve, attach, detach,
and abandon metadata at member rank. Storage policies allow only matching pending uploads,
member-scoped attached reads, and pending/detached deletes. A revision trigger rejects any
`assetIds` value that is not the report's one attached asset, closing the ordinary-save promotion
path. Object bytes are always created/deleted through the Storage API, never direct SQL.

The workspace metric follow-up adds `metrics.is_core` plus
`set_workspace_core_metric_v1`. The checked function locks the workspace, requires member access,
rejects cross-workspace/non-daily targets, and serializes the five-metric cap. Report activation
still stores one confirmed prediction metric; shared core selection is a separate dashboard concern.

The partner action follow-up adds `complete_manual_action_v1`. It accepts only a planned manual
action materialized from a Decision Report in the caller's workspace, requires member access,
rejects future dates and blank/oversized explanations, writes completion status/date plus an audit
payload into `rationale_richtext.meta.manual_completion`, and reuses an exact retry. Connector-backed,
legacy-manual, viewer, and cross-tenant calls fail closed.

The report-history follow-up adds `decision_reports.deleted_at/deleted_by` and the checked
`delete_decision_report_v1` RPC. Members can soft-delete a report in their workspace, including an
activated one, and identical retries reuse the deletion receipt. Application roles retain no
direct writes. Live-report partial indexes plus report/revision/asset SELECT policies hide removed
history, while triggers prevent later revision, activation, or asset mutation. Canonical graph rows
from an activated report are retained as audit history and filtered from application fallback
views rather than deleted.

Slice 9 adds `decision_report_rollouts`, keyed by workspace and authenticated user. A user may read
only their own assignment when they also have viewer access to the workspace. Authenticated roles
have no insert, update, or delete grant, so assignment and rollback remain operator-managed through
the service role or direct SQL. Unassigned and lookup-failure users fail closed to legacy onboarding;
the table does not own or mutate durable report state.

Slice 10 adds `decision_report_series` plus report lineage columns. Each report belongs to one
workspace-bound linear series; a partial unique index permits only one non-deleted direct successor.
The series stores the current active report, and `workspaces.current_decision_report_series_id`
stores the sole operational series. `start_decision_report_iteration_v1` requires member access,
locks report → series → workspace, copies the exact reviewed snapshot, strips private asset IDs,
and provides exact-retry reuse with changed/stale conflict. Activation advances the report and
workspace pointers in the canonical transaction. Deletion rolls the report pointer back only to
the nearest live active predecessor in that series. The new public table has RLS, viewer-scoped
reads, no direct authenticated writes, and explicit grants.

The workspace pointer is database-owned even though legacy workspace administrators retain a broad
workspace update grant. Activation creates a private `xid8`-bound one-use transition row; the
workspace trigger consumes it and independently verifies that the target report became active in
the same transaction. Authenticated and service roles have no privilege on the capability table,
and a caller-set GUC cannot forge it. Report creation also checks that the workspace exists before
creating a series, returning the non-enumerating checked-write denial instead of leaking the series
scope foreign-key name.

The expanded Slice 10 activation path adds `activate_decision_report_v2`, one required primary
selected action, and a deterministic manual lever tied to the immutable activation. Direct updates
to report-native actions or that primary lever are blocked by triggers unless
`complete_manual_action_v1` creates and consumes a private transaction capability. The legacy v1
entry point is retained only behind a checked compatibility wrapper; authenticated callers cannot
invoke the private materializer directly.

Automatic recomputation uses `private.causal_recompute_jobs`, keyed by immutable activation with
requested/processed generations, a stable input hash, reason coalescing, retry state, and no grants
to application roles. Activation, current-report observation inserts/updates, and primary-action
completion enqueue work. The stateful worker re-locks report → series → workspace → activation and
records a superseded receipt if either explicit pointer moved; graph writes and the processed receipt
commit together. Only the current activation's selected actions are persisted, while BH-FDR uses the
full eligible workspace action family.

The stateful recompute deployment path is intentionally separate from the app. The network-free
`scripts/deploy-recompute.sh --stage-only` verification produces an 18-file Python 3.12 bundle with
exact NumPy/psycopg versions and a 300-second function limit; nine recompute-function tests pass.
No Vercel project was linked and no worker was deployed in this run.

Source provenance v2 remains inside the append-only, RLS-protected revision snapshot rather than a
new public source table. Each brief/URL/PDF summary carries bounded chunks, locators, extracted text,
and per-chunk/per-source SHA-256 digests. Database validation recomputes digests and rejects duplicate
IDs, oversized/malformed metadata, and `sourced` claims referencing absent chunks. A private 24-hour,
one-use receipt is minted only by the trusted generation path and binds scope, actor, exact source
summaries, and the sourced-claim multiset. `create_decision_report_v2` consumes it atomically; an exact
lost-ack replay reuses the committed report while changed replay conflicts. Later revisions freeze the
corpus and can only retain or remove previously authorized sourced claims. An authenticated forged
corpus still fails after internally consistent rehashing; the explicit source-free/no-sourced path
needs no receipt because it grants no provenance authority. Historical v1 snapshots remain readable;
newly authored content is v2, and a legacy-derived successor must be saved as v2 before activation.

The MVP-completion migration `20260723151939_mvp_completion_contracts.sql` adds eight report-lifecycle
event types to `funnel_events`. It revokes every application-role table privilege, then grants
authenticated callers only `SELECT` and `INSERT`. This makes the content-free telemetry stream
append-only at the privilege layer and explicitly removes `TRUNCATE`, which bypasses RLS. The write
repository accepts only a `dr-` UUID session key, elapsed time, three bounded numeric counters, and
four booleans; prompts, report/source content, identities, assets, clipboard data, raw observations,
and error strings cannot enter its metadata contract.

The same migration adds a private `BEFORE INSERT` trigger on `decision_report_activations` that
requires `prediction_resolution_date` to be strictly after the UTC statement date. The UI and shared
runtime validator enforce the same future-date rule, but the trigger independently rejects a stale
or forged request at the final write boundary. Its trigger function is not executable by public,
anonymous, authenticated, or service roles.

`get_current_causal_recompute_status_v1` is a stable, viewer-scoped security-definer RPC over the
explicit current workspace series/report/activation. It returns only `idle`, `queued`, `retrying`,
`failed`, or `current` with request/processed/next-attempt timestamps. Missing and unauthorized
scopes share the same denial; the private queue, job identities, actor, attempts, input hash, raw
reason, and error code remain ungranted. Only authenticated and service roles may execute the RPC.

Provenance receipt minting remains intentionally unavailable to ordinary authenticated callers.
Because the trusted generation action now mints that receipt before first save, the production app
requires a server-only `SUPABASE_SERVICE_ROLE_KEY`. This runtime requirement does not alter browser
grants or RLS and the key must never enter the client bundle.

Slice 5 adds the `active` report state and an atomic
`activate_decision_report_v1` RPC. It locks the report, validates the exact current
and reviewed revision, confirms the metric belongs to the report workspace, validates
one human prediction plus one to three source-item IDs against the stored snapshot,
then creates one decision, one prediction, planned manual actions, their decision links,
and one activation audit row in the same transaction. A deterministic input hash returns
the original canonical IDs for identical retries and rejects changed retries with HTTP 409.
The RPC creates no lever, causal edge, evidence object, observation, or impact claim.
Application roles can read activation audit rows through RLS but cannot insert, update,
or delete them directly.

## Current local verdict

**The 2026-08-12 release candidate passes the complete local schema and application gate; production
release is not claimed.** A clean reset applies all 31 migrations. The serialized
Node/Supabase/RLS/Storage suite reports 556 total: 537 passed, 19 intentional live-model skips, and
zero failures. The complete engine/bridge/isolation/recompute suite reports 1,217/1,217 passed, and
error-level schema lint passes. TypeScript, full application lint, the audited 18-file recompute
stage, the Node 22 Next.js 16.2.11 webpack build, and the post-build request-bound dashboard manifest
guard pass. The Northstar follow-up adds no schema object and intentionally preserves the finished
founder-review database. Earlier browser acceptance generated,
autosaved, refreshed, and activated a Gummy Alpha report, then activated a successor against the
isolated Adoption Rate fixture and rendered its confident +14.7pp current-report loop. Direct links
and Actions/Core Metrics/Impact pass at desktop and 390px with zero console errors and zero failed
requests.
The dedicated Northstar review metric contains 122 synthetic observations. The checked loop resolves
the current report `CONFIRMED` at +14.7pp (95% CI +14.5pp to +14.9pp; 75 pre / 47 post), while the
workspace current-series pointer remains unchanged during data preparation. This is local synthetic
engineering evidence and does not satisfy the partner-session or partner-environment gates.
The remote production migration state was not freshly inspectable because the Supabase CLI is not
authenticated or linked. All seven documented migrations therefore remain operator-pending until
history verification, dry-run, deliberate apply, and authenticated database canaries complete. The
missing partner-session gate remains open.

The original v1 verdict remains historical evidence: all 11 base tables shipped with RLS enabled;
the live tenant-isolation gate passed (`gate_pass=true`, `tables_with_rls=11`, `leaks=[]`), and the
security review's three findings were fixed and covered by adversarial tests.

## Original v1 tables shipped (11)

The decision graph plus its scope/RBAC spine. Every domain row carries
`scope_id -> workspaces` (the operating level).

| # | Table | Role |
|---|-------|------|
| 1 | `orgs` | Tenant root of the scope hierarchy |
| 2 | `projects` | `org -> project` |
| 3 | `workspaces` | `project -> workspace` (the operating scope) |
| 4 | `memberships` | `user × scope × role` — the RBAC grant table |
| 5 | `metrics` | Time-series definitions |
| 6 | `metric_observations` | Per-metric daily values (no `scope_id`; resolved via metric) |
| 7 | `clusters` | Collision-grouping overlay |
| 8 | `actions` | The shipped work (`github_pr`/`github_issue`/`manual`) |
| 9 | `nodes` | Materialized graph nodes (`METRIC`/`ACTION`/`CLUSTER`) |
| 10 | `causal_edges` | Directed belief edges between nodes |
| 11 | `evidence_objects` | Append-only audit trail + ML feedstock |

## RLS model

Isolation resolves through the `memberships` table over the scope hierarchy via
`SECURITY DEFINER` helpers (they read `memberships` bypassing RLS, so membership
policies do not recurse).

- **`has_scope_access(target_scope, min_role)`** — the helper the domain tables
  use. `scope_id` is always a `workspace_id`; it resolves the workspace's
  project + org, then defers to `has_scope_grant`.
- **`has_scope_grant(org, project, workspace, min_role)`** — the core
  downward-inheriting match. A membership grants its `role` at its most-specific
  non-NULL scope and **inherits downward**: a NULL `project_id`/`workspace_id`
  widens the grant (org-wide / project-wide). `org_id` is always set.
- **Roles** (total order via `role_rank`): `viewer(1) < member(2) < admin(3) < owner(4)`.
  - SELECT requires `viewer+`.
  - Data writes (metrics, observations, clusters, actions, nodes, edges,
    evidence) require `member+`.
  - Membership / scope-management writes require `admin+`.
  - `owner` is reserved for server-side org delete + billing.
  - `service_role` bypasses RLS for engine/server bootstrap; `anon` sees nothing
    (all policies are `to authenticated`).
- **Append-only evidence**: no UPDATE/DELETE policy, plus a table-level
  `REVOKE UPDATE, DELETE, TRUNCATE ... FROM authenticated, anon` as a second
  guard (TRUNCATE is not row-level, so RLS alone cannot stop it).

## Live isolation gate

Adversarial probes run against a seeded multi-tenant fixture
(`engine/tests/test_rls_isolation.py`, `test_rls_isolation_adversarial.py`):
sibling-workspace/project isolation, project-admin read isolation,
member/admin escalation attempts, cross-tenant UPDATE moves, anon visibility,
and `SECURITY DEFINER` reachability.

```
gate_pass          = true
tables_with_rls    = 11
leaks              = []
```

## Security review — verdict `HOLES` (3 found, 3 fixed)

1. **`metric_scope()` cross-tenant info leak.** The `SECURITY DEFINER` resolver
   returned the `workspace_id` of *any* `metric_id`, bypassing RLS — a
   foreign-tenant caller could resolve `metric_id -> workspace_id`.
   **Fixed:** the function now gates its own return on
   `has_scope_access(scope, 'viewer')`, returning NULL to callers without
   access (which makes the `metric_observations` policies default-deny for
   foreign metrics).
2. **admin→owner self-grant via `memberships` INSERT.** The INSERT policy
   checked only the `admin+` floor, letting an admin mint an `owner` grant
   above its own rank. **Fixed:** WITH CHECK now also requires
   `has_scope_grant(scope, role)` — the granter must already hold ≥ the granted
   role's rank.
3. **admin→owner self-upgrade via `memberships` UPDATE.** Same gap on the
   UPDATE path (an admin could bump its own row admin→owner). **Fixed:** the
   same granter-rank cap was added to the UPDATE WITH CHECK.

Each fix has a corresponding adversarial test asserting the escalation is now
blocked while legitimate within-rank grants still succeed.

## Residual risk (stated plainly)

- **`owner` is enforced outside RLS.** Owner-gated operations (org delete,
  billing) live server-side; no DB policy depends on the `owner` rank. If a
  future policy is written against `owner`, the membership rank-cap logic must
  be re-audited — an admin cannot *reach* owner via RLS, but the boundary is a
  convention the server layer must uphold.
- **Hierarchy creation is server-only.** `orgs`/`projects`/`workspaces` have no
  authenticated INSERT/DELETE policies (RLS default-deny); signup and org
  deletion flow through `service_role`. Any bug in that server path is outside
  the RLS guarantee.
- **`nodes.semantic_ref` is polymorphic with no FK.** It points at
  `metric_id | action_id | cluster_id` by convention only; referential
  integrity there is the application's responsibility.
- **The recompute worker is stateful.** It requires a server-only Postgres `DATABASE_URL` and
  `CAUSENT_RECOMPUTE_SECRET`. The worker switches to the queued actor's authenticated RLS identity
  before graph access, but secret handling, pooler configuration, failure monitoring, and rotation
  remain deployment responsibilities. Jobs stop retrying after the bounded failure ceiling and need
  operator visibility.
- **Provenance v2 deliberately retains extracted text.** Raw URL responses and PDF bytes are not
  stored, but bounded source chunks remain inside append-only revisions so later claims are auditable.
  Soft deletion removes authenticated visibility; physical retention/garbage-collection policy still
  needs the same operator discipline as other retained audit history.
- **Expanded Slice 10, the MVP finish, and Review #2 are not yet production-verified.** Migrations `20260723053444`,
  `20260723061012`, `20260723061925`, `20260723064500`, `20260723151939`, `20260810005135`, and
  `20260810044832` still need deliberate partner-environment application plus authenticated
  RLS/Storage/recompute-status canaries. The app
  also needs a server-only service-role key for receipt minting, and the recompute app/worker secrets
  must pass their release checks. The production app currently lacks the service-role and recompute
  settings, `causent-recompute` does not exist, and `causent-resolve` lacks `DATABASE_URL`. The app
  release check now requires the resolve URL/secret, and the resolver must pass its dedicated
  `DATABASE_URL`/secret config check. Passing local reset is not production evidence.
- **The gate is a point-in-time result** against the seeded fixture. The expanded workflow is
  configured to rerun it on every PR/push, but this working tree has not yet produced a hosted CI
  result. The passing webpack/manifest checks and browser acceptance are useful product evidence,
  but they do not replace the authenticated partner-environment database canary.
