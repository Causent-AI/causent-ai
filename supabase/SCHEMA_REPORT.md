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

The 2026-08-18/19 release run supersedes that operational snapshot. After isolated persistent
with-data and disposable worker-role rehearsals, production Supabase `royftsqyawtyfjolfabd` advanced
from 11 to **42/42 migrations**. The first 41 used the same controlled phases. Phase A applied 20 migrations. All eight parent/hot
indexes built concurrently outside migration transactions are ready, valid, and live. Phase B1
applied six migrations. Phase B2's owner drain returned exactly
`(processed_count=0, last_activation_id=NULL, has_more=false)`. Phase B3 validated all 17 targeted
constraints and left zero invalid. Phase B4 left one activation v1, v2, and v3 overload present and
removed the rollout-only backfill function. The ACL migration then applied. The last successful
migration dry-run through 41 reported the remote database up to date. Migration 42 then passed a full
local reset, disposable-clone Supavisor rehearsal, and production apply. Its local/production role
catalog checks and error-level schema lint pass, and a serialized post-42 dry-run reports the remote
database up to date.

Migration `20260819044116_harden_security_definer_function_acl.sql` closes a privileged-function ACL
regression found in the cloned catalog. Seventeen public SECURITY DEFINER functions were still
effectively executable by `anon`, primarily because owner/default privileges survived older
schema-local revokes. The migration revokes function execute from PUBLIC and `anon` in both the
`postgres` owner default and current privileged catalog; explicitly restores only the RLS helpers'
authenticated/service access; sets `role_rank(text)` to an empty search path; and grants
`handle_new_user()` only to `supabase_auth_admin`. A transactional probe proves that a newly created
`postgres`-owned SECURITY DEFINER function does not inherit anonymous execution, and the migration
aborts if any current public SECURITY DEFINER function remains anonymous-executable. Production now
has 37 public SECURITY DEFINER functions: `anon` executes 0/37 and 37/37 use the fixed empty search
path. Regression tests cover the catalog invariant, future default, comparator ACL/search path, and
auth trigger ACL. Supabase's leaked-password-protection advisor remains a separate platform warning.

Migration 42 is the applied least-privilege contract for the three stateful workers. It creates
passwordless `NOLOGIN`, `NOINHERIT` roles and clears rehearsal memberships/grants before installing
the exact graph:

- `causent_drift_worker` has `BYPASSRLS`, can select/update only `private.drift_refresh_jobs`, can
  read the bounded detector inputs, and can insert/delete only the derived
  `public.current_prediction_drift` projection.
- `causent_recompute_worker` has `BYPASSRLS`, can select/update only
  `private.causal_recompute_jobs`, read the immutable target relations, and update only the target
  primary-key columns needed for `SELECT ... FOR UPDATE`. Its `authenticated` membership is
  SET-only and non-inherited so graph work can switch to the stored actor's existing RLS identity.
- `causent_resolve_worker` has no `BYPASSRLS`, direct application-table grant, or private-schema
  access. Its sole application capability is the same SET-only, non-inherited `authenticated`
  membership for the supplied actor's RLS sweep.

No worker can assume or inherit `service_role`. The catalog regression suite enumerates role
attributes, memberships, schema/table/column/sequence grants, effective access, queue separation,
and auth/storage denial; it passes 8/8 locally, and the production catalog checks pass. The
disposable-clone Supavisor login rehearsal passed and its credentials were disabled afterward.
Production enables `LOGIN` with separate generated passwords without widening those contracts, and
each exact role was verified through the `aws-1` session pooler. Production worker DSNs use these
target-specific Supavisor forms:

```text
postgresql://causent_drift_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
postgresql://causent_recompute_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
postgresql://causent_resolve_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

The runtime guard requires exact `<role>.<20-character-project-ref>` usernames, a nonempty password,
a matching `*.pooler.supabase.com` host, port `5432`, database `postgres`, and only
`sslmode=require`. It rejects `postgres.<ref>`, `service_role.<ref>`, local/direct database hosts,
port `6543`, and cross-worker role reuse. Each DSN is stored only in that worker's Sensitive
`DATABASE_URL`; all three are configured and have been exercised by the promoted workers through
the held application candidate's authorized cron canaries.

Schema activation created no `decision_report_rollouts` assignment, loaded no production seed, and
did not rotate the database password. The billable rehearsal branch should be deleted once its
evidence is no longer needed. The authenticated application full-loop remains a separate gate.

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
That earlier source checkpoint linked no Vercel project and deployed no worker. The current operator
inventory now confirms that drift, recompute, and resolve projects exist with matching strong
Sensitive app/worker secrets and app URLs, plus a rotated cron secret. Their exact role-specific
Supavisor `DATABASE_URL` values are stored Sensitive and their production logins/catalogs pass. Drift
deployment `dpl_5a5BFfP86YxCjWGBhMX3Z3iF64po`, recompute
`dpl_2PAG63un8RvuXTDAyCJYMyGCYKFK`, and resolve
`dpl_2pra4r5dHLiPvPpKP92Qk8ojphMM` are promoted on dedicated domains. App-candidate cron canaries
passed for resolve (4/4 predictions), drift (generation 4), recompute (0), connector (0), and
reconciliation (two registered workspaces, 0).

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

The 2026-08-16 multi-metric rollout is now ordered as expand, bounded backfill, validation, and
contract rather than one production-sized transaction:

1. `20260817012313_decision_report_multi_metric_activation.sql` expands the activation identity and
   append-only child relations while leaving v3 unavailable.
2. `20260817062054_decision_report_multi_metric_backfill.sql` normalizes at most 100 activations
   during migration and retains an owner-only, resumable 500-row worker for material histories.
3. `20260817062057_decision_report_multi_metric_validate.sql` installs new foreign keys as `NOT
   VALID`, validates historical rows separately, and attaches prebuilt parent identity indexes.
4. `20260817062102_decision_report_multi_metric_contract.sql` swaps only validated checks, removes
   the rollout-only worker, and exposes `activate_decision_report_v3`.

The operator runbook at `supabase/rollouts/decision_report_multi_metric_activation.md` builds the
three parent identity indexes concurrently outside the migration transaction, rehearses and drains
the bounded backfill, and keeps v1/v2 callers live until the final contract phase. The reset-safe
index statements in the expand migration are fallbacks for new/empty databases. The current 13 MiB
production-data clone rehearsal and phased production apply passed, but that is still not evidence
that lock time is acceptable at material or projected volume.

`activate_decision_report_v3` accepts one to five unique selected daily metrics and one to twenty-five
unique selected report actions, requires exactly one selected-metric assignment for every action,
and requires the registered primary action to target the confirmed primary metric. Its canonical
SHA-256 receipt makes reordered exact retries reuse the one immutable activation while changed metric
sets or action mappings conflict. Existing v1/v2 function signatures and their one-to-three-action
validation remain callable through the rolling deployment.

Two append-only, viewer-readable relations make the richer receipt durable:
`decision_report_activation_metrics` records the complete selected metric set and
`decision_report_activation_action_metrics` records each canonical action's source identity and
assigned metric. Composite foreign keys bind activation, metric, action, and workspace scope;
deferred parent references prove that the compatibility `activation.metric_id` is selected and that
the primary lever action/source is one real binding. Application and service-role DML is revoked.
Historical activations are backfilled to their original single-metric meaning by joining each
canonical action's stored `rationale_richtext.meta.source_item_id`; the migration aborts on incomplete
or mismatched history. An `AFTER INSERT` normalizer gives rolling v1/v2 clients the same child rows.
Unbounded historical source IDs are retained as raw audit text but keyed relationally by SHA-256, so
the compatibility path does not depend on an unsafe large-text B-tree key.

V3 still materializes exactly one canonical decision and one human prediction for the confirmed
primary outcome. Every selected action is canonical, and its `rationale_richtext.meta.expected_metric`
uses that action's assigned metric name. Only the primary action receives the primary manual lever,
and only the confirmed primary metric queues causal recomputation; secondary metrics are explicit
context/action assignments, not fabricated secondary causal predictions. Successor activation still
moves the series/workspace current pointers in the same transaction, so the prior report stays
operational until commit.

`20260817055407_decision_report_scientific_contracts.sql` extends normalized supporting-action
bindings with optional `monitoring_expected_direction` and `monitoring_check_date`. A private trigger
derives those values only from the exact immutable revision action; the registered primary action
always leaves them null. `list_decision_report_activation_metrics_v2` replaces per-metric probes with
one viewer-checked catalog that reports unit, latest observation/value, observation count, history
days, readiness, earliest confident review date, and percent scale. Cross-workspace and
unauthenticated callers receive the same non-enumerating denial. Readiness is descriptive and does
not relax activation or the 45-day-per-side ITS floor.

The same migration adds viewer-readable, append-only
`decision_report_package_interventions`. A V3/multi-action activation does not become a causal
intervention until every included canonical action is complete. The checked manual-completion RPC
then records the included action with the latest effective completion date as the package
intervention, using immutable report order as the same-day tie-break. It preserves the original
registered primary action and primary metric, writes its content-bound package hash, and enqueues the
current report. Primary-lever state changes under the same private transaction
capability; exact action-completion retries reuse while changed retries conflict. A trigger proves
that the package matches the immutable activation and that every included action is complete. This
models the whole decision package and creates no per-action causal prediction.

The 2026-08-16 founder UX follow-up adds no database object. Its local review fixture creates a real
Northstar project and Support Operations workspace alongside Gummy Alpha through the existing
org/project/workspace schema. The two workspaces intentionally share the synthetic demo organization,
so the demo owner is authorized for both by the existing downward-inheriting membership model.
Application selection is therefore a narrower current-operating-scope boundary: an HttpOnly cookie is
intersected with the server registry and visible workspace rows, and every service-role-backed report,
revision, asset, metric, action, dashboard, and resolver operation carries the selected `scope_id`
explicitly. This does not replace RLS or prove separate-customer tenant isolation.

Action-start activation retains `activate_decision_report_v3` unchanged. Before materialization, the
Server Action performs a non-enumerating report/revision lookup constrained by the selected session
workspace. A report ID from the other authorized demo workspace therefore fails before the atomic RPC,
even though the synthetic organization owner can otherwise read both workspaces. The database RPC still
owns report/revision consistency, immutable receipt hashing, action/metric bindings, current-pointer
movement, exact retry, and rollback behavior.

The current small production-data clone rehearsal and production schema apply passed, but
representative-volume lock/query evidence remains open. Deploy the v3 application only after its
worker/config canaries; roll back the application to v1/v2 first if needed and do not remove the
append-only audit rows or validated constraints. The companion
`docs/reviews/2026-08-16-engineering-schema-scale-review.md` still concludes that integrity is suitable
for the partner MVP but 10,000 active users/hour over gigabytes is not capacity-proven. The unbounded
dashboard/history contract, representative query plans, hosted worker capacity, pool budget, and
staging load/soak evidence remain open.

`20260817055415_materialize_current_prediction_drift.sql` moves baseline drift off the dashboard
request path. Private `drift_refresh_jobs` coalesce source changes by workspace and generation;
dedicated workers lease with bounded attempts and replace only the matching generation of
viewer-readable `current_prediction_drift`. The public `get_current_prediction_drift_v1` RPC returns
at most 500 rows for the explicit workspace and exposes sanitized queued/current/retrying/failed
freshness metadata. Authenticated users have SELECT only; application roles cannot mutate the queue
or projection. The separate worker endpoint, dedicated database role/URL, shared secret, and
five-minute app cron are deployed and configured; the held application candidate's authorized drift
cron processed generation 4 for one workspace. Authenticated full-loop and representative-load
evidence remain open.

`20260817055412_connector_webhook_inbox.sql` adds a service-only durable connector inbox. The checked
RPC identifies one GitHub/Jira delivery by provider ID plus SHA-256 payload digest, records attempt and
retry/dead-letter state, applies the canonical transition/lever/action mutation, and marks the delivery
processed in one transaction. Exact processed redelivery is a duplicate; the same provider identity
with changed bytes conflicts. Authenticated/anonymous roles have no table or function access. A
service-only `SKIP LOCKED` retry RPC drains bounded due work; the app cron still needs its production
secret and provider-specific canaries.

`20260817055817_chunked_metric_csv_imports.sql` adds viewer-readable
`metric_csv_import_jobs` plus private chunk receipts. Report and workspace begin RPCs establish the
exact scope/metric/import identity. Each append accepts at most 250 ordered rows and is idempotent by
import, chunk index, and digest; finalize requires complete contiguous progress. The application caps
one file at 2,000 rows and retries only bounded serialization/deadlock/lock-unavailable failures. CSV
bytes are not retained. Authenticated callers may read their workspace receipts but cannot write the
tables directly.

`20260817060606_hot_read_path_indexes.sql` adds workload-shaped indexes for scope/effective-date
actions, scope/created-at decisions and report series, latest evidence by
scope/methodology/edge/time, and open lever reconciliation. The canonical reset migration uses
idempotent ordinary DDL; `scripts/query-plans/create-hot-indexes-concurrently.sql` is the
production-clone preflight for online builds. `scripts/query-plans/hot-read-paths.sql` runs the five
queries as an authenticated fixture user. Plans against representative volume are pending, and these
indexes do not close the separately deferred unbounded dashboard contract. On the 13 MiB production-
data clone, three of five reads used the expected indexes; the actions and evidence reads used
sequential scans, and the evidence read took roughly 60–87 ms. That small-catalog choice is not a
failure by itself, but it leaves the representative-volume plan/load gate open.

The private-image schema and sanitation contract are unchanged. The application read route now
authorizes the asset metadata by exact workspace/status and optional content hash, then issues a
60-second signed Storage URL for the server-owned object path. Next.js no longer proxies the image
bytes. The final local gate covers the exact
workspace lookup, optional content-hash mismatch, 60-second signer call, opaque failures, 307
`private, no-store` response, unauthenticated short circuit, and the existing Storage upload/
replacement/removal integration. Production URL lifetime, CDN/egress behavior, and authenticated
cross-workspace denial still require a canary.

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

**Production is at 42/42; application release is not claimed.** The rehearsed phases were applied to
`royftsqyawtyfjolfabd`: 20 Phase A
migrations, eight ready/valid/live concurrent indexes,
six Phase B1 migrations, the zero-row B2 drain, 17 valid B3 constraints, B4 contract with v1/v2/v3
and no rollout backfill, then ACL hardening and the dedicated worker-role migration. Migration 42's
apply, role catalog, error-level lint, and serialized post-42 dry-run all pass.
Error-level lint passes across
`public`/`private`/`storage`, `anon` executes 0/37 public SECURITY DEFINER functions, and 37/37 have
an empty search path. No rollout assignment or seed was added, and no password rotation occurred,
during schema activation.

**The product/science/engineering hardening schema through migration 42 and its refreshed exact local
combined gate pass; production release is not claimed.** The clean reset replayed every migration and
reseeded both workspaces. Local worker-role tests pass 8/8 and error-level schema lint passes. The
credentialed application/Supabase/RLS/Storage suite reports 671 total, 652 passed, 19 intentional
live-model skips, and zero failures; the full Python engine/bridge/isolation suite passes
1,290/1,290. Authenticated hot-query
EXPLAINs, the deterministic 1.19 GiB fixture plan, Next.js 16.2.11 webpack build, dashboard guard,
desktop/390 px browser acceptance, and final diff audit passed. Browser QA also found and fixed a
collapsed Actions commitment card before publication. The disposable-clone Supavisor rehearsal and
production role catalog/pooler access also pass; clone credentials were disabled afterward.

The workers are deployed and their point-in-time cron canaries pass, but replacement app candidate
`dpl_GC2TDZGLx6DijqGwgEXfxgMVn6ai` remains unpromoted and no authenticated full-loop canary or
rollout assignment exists. Candidate error logs were empty after the five canaries. Resolver UUID
fix `f6b0204` and CI assertion fix `8b2ad20` close the observed release regression. A resolver exact
retry returned HTTP 200 with zero workspaces/zero predictions, and Vercel logs independently confirm
HTTP 200 for all five cron requests. Hosted CI run `32225950985` completed successfully at 07:07 UTC
on 2026-08-19; PR #32 remains draft. Shared secrets were rotated; no value is recorded here.

The k6 profiles and scale fixture remain instruments only. The source now requires a durable external
session broker, but that broker has not been implemented, audited, or configured, so protected
staging/soak execution is operator-blocked. Representative-volume plans, production CDN/egress
behavior, and authenticated full-loop application canaries remain
pending. This is not evidence for 10,000 active users/hour.

### Historical checkpoint before this hardening round

**The 2026-08-12 release candidate passed its then-complete local schema and application gate;
production release was not claimed.** A clean reset applied all 31 migrations. The serialized
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
The remote production migration state was not freshly inspectable because the Supabase CLI was not
authenticated or linked. The seven migrations documented at that checkpoint and every later
2026-08-17 hardening migration remain operator-pending until exact history verification,
production-clone rehearsal, deliberate apply, and authenticated database canaries complete. The
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
  operator visibility. The release check now rejects weak/repetitive/placeholder shared secrets
  without logging their values. Matching strong Sensitive app/worker secrets and exact role-specific
  Supavisor DSNs are configured; migration/catalog/pooler checks pass; the deployment is promoted;
  and its zero-job cron canary passed. Queue-under-load and authenticated full-loop evidence remain.
- **Provenance v2 deliberately retains extracted text.** Raw URL responses and PDF bytes are not
  stored, but bounded source chunks remain inside append-only revisions so later claims are auditable.
  Soft deletion removes authenticated visibility; physical retention/garbage-collection policy still
  needs the same operator discipline as other retained audit history.
- **Expanded Slice 10, the MVP finish, Review #2, and the schema through migration 42 are
  production-applied but not application-armed.** Production has no rollout assignment or seed from
  activation.
  Authenticated application/Storage/recompute/drift/import/connector canaries and representative-
  volume lock/query plans remain open. The app has a Sensitive server-only service-role key and no
  stale demo date; all three stateful worker projects, matching Sensitive app/worker secrets, app
  URLs, rotated cron secret, separate production role credentials, and exact Sensitive role-specific
  `DATABASE_URL` values exist. All three workers are promoted and five app-candidate cron canaries
  passed. The public app remains on the rollback artifact; the Ready replacement candidate is not
  promoted; and no authenticated full-loop canary or rollout assignment exists.
- **Protected staging load is broker-blocked.** The source validates
  `CAUSENT_STAGING_SESSION_POOL_URL`, a high-entropy `CAUSENT_STAGING_SESSION_POOL_TOKEN`, durable
  allocation-set/profile lease envelopes, real Supabase session lineage, disjoint single-use
  sessions, and an adversarial foreign positive control. The external broker is not implemented,
  audited, or configured, so no live capacity or load-isolation result exists.
- **The gates are point-in-time results.** The earlier coordinated local product gate, production
  schema activation, and worker cron canaries verify different artifacts. Hosted CI run
  `32225950985` completed successfully; PR #32 remains draft. Prior webpack/manifest and browser acceptance do not replace
  protected staging capacity or the authenticated full-loop app-candidate canary.
