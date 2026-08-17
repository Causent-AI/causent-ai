# Engineering schema and scale review — 2026-08-16

## Founder-selected disposition — 2026-08-16

The findings below are retained as the before-state scale review. The founder selected a bounded
hardening pass rather than a claim that the product is now proven for 10,000 active users/hour over
gigabytes. Source implementation is present in the current working tree; the coordinated clean
reset, schema/RLS/Storage/integration gate, full engine suite, Next.js build, browser acceptance,
staging load run, production-clone rehearsal, and deployment remain pending.

| Finding | Selected response | Current disposition |
| --- | --- | --- |
| Shared production hotspot | Not selected in this round | The server-resolved workspace selector removes the single hard-coded operating-scope path for the local product journey, but both review workspaces still share one synthetic organization. Separate-tenant capacity and production membership rollout remain unproven. |
| Unbounded dashboard reads | Deliberately deferred | No claim is made that the all-history dashboard/read-model issue is closed. New indexes do not make an unbounded API contract safe. |
| Python compute-on-read drift | Option 1 | Source writes now coalesce workspace jobs; a bounded worker materializes `current_prediction_drift`; the dashboard reads one viewer-checked projection RPC and never spawns Python. The hosted worker and its secrets are not deployed. |
| Automatic causal recomputation | Deliberately deferred | The existing queue/worker contract remains throughput- and deployment-gated. This round does not claim a production worker pool, connection budget, or automatic production recomputation. |
| CSV ingestion | Option 3 | The synchronous cap is reduced to 2,000 rows and imports use resumable, digest-bound 250-row chunks with durable progress/final receipts and bounded serialization/deadlock retries. No CSV bytes are retained. |
| Hot filters and RLS | Option 1, bounded first step | Workload-shaped indexes and authenticated plan scripts cover actions, decisions, report series, latest evidence, and open levers. The plan must still be captured against a representative gigabyte fixture; broad dashboard reads remain deferred. |
| Private image delivery | Option 1 | After the existing metadata, workspace, attachment-status, and optional content-hash checks, the Next route redirects to a 60-second signed URL for the exact server-owned Storage path instead of proxying bytes. Upload sanitation and private-path rules are unchanged. |
| Connector retry loss | Option 1 | A service-only transactional inbox now binds provider event identity to a payload digest, canonical mutation, attempt state, retry/dead-letter handling, and a processed marker. GitHub/Jira routes reject oversized bodies before parsing and submit verified normalized events to that boundary. |
| Multi-metric migration | Option 1 | Rollout is split into expand, bounded resumable backfill, `NOT VALID`/validation, and contract migrations. Parent indexes have an outside-transaction concurrent-build runbook; v1/v2 stay callable until the final contract phase exposes v3. |
| Load test and SLO | Option 1 | A guarded k6 harness, protected manual staging workflow, deterministic scale-fixture planner, and explicit p95/p99/error thresholds exist. No staging, soak, gigabyte-plan, or production-capacity result is claimed until those jobs actually run in the target environment. |

Primary source: `supabase/migrations/20260817055415_materialize_current_prediction_drift.sql`,
`supabase/migrations/20260817055817_chunked_metric_csv_imports.sql`,
`supabase/migrations/20260817055412_connector_webhook_inbox.sql`,
`supabase/migrations/20260817060606_hot_read_path_indexes.sql`, the ordered
`20260817012313`/`20260817062054`/`20260817062057`/`20260817062102` multi-metric migrations,
`supabase/rollouts/decision_report_multi_metric_activation.md`, `load/causent-mvp.js`, and
`.github/workflows/staging-load.yml`.

## Verdict

**Causent's relational integrity and tenant-denial model are credible for the current partner MVP,
but the application is not capacity-proven for 10,000 active users in one hour over gigabytes of
metric and report history.** The difficult part is not the headline arrival rate. Ten thousand user
arrivals over 3,600 seconds average only **2.78 users/second**. The blockers are that every production
session can select only one of two server-registered workspaces in one synthetic organization,
several dashboard loaders still fetch a workspace's entire history, and the drift/causal workers are
both undeployed and throughput-bounded. Drift no longer launches Python from the dashboard request in
the current working tree; that closes the request-path defect, not the hosted capacity gate.

If an active user causes six to ten page/API requests, the same arrival rate implies roughly
**17–28 requests/second on average**. A 10x review-day burst implies **167–278 requests/second**.
Those are planning assumptions, not measured results. The repository now has correctness/isolation
gates, a guarded load generator, and a deterministic gigabyte-scale fixture planner, but it still has
no staging result, production latency distribution, connection-pool budget, or representative query
plan from which to claim a safe concurrency ceiling.

The practical answer is therefore:

- 10,000 authentication or landing-page arrivals in an hour may be unremarkable for the hosted
  platforms, but this repository does not test that claim.
- 10,000 active dashboard users sharing the current workspace and reading gigabytes of history is
  **not a supported or evidenced workload today**.
- The target becomes plausible after tenant/workspace resolution, bounded read models, asynchronous
  drift/recompute, and a measured worker/database concurrency budget are in place.

Primary operating references: [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod),
[database connection and pool modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[RLS performance guidance](https://supabase.com/docs/guides/database/postgres/row-level-security),
[platform metrics](https://supabase.com/docs/guides/monitoring-and-debugging/metrics), and
[database advisors](https://supabase.com/docs/guides/database/database-advisors).

## Review scope and evidence standard

This was a read-only capacity audit of the current migrations, indexes, RLS helpers and policies,
checked RPCs, Next.js/Supabase access paths, ingestion, causal recomputation, Storage lifecycle,
deployment docs, and CI. Functional success is not treated as load evidence. The review used the
current Supabase/Postgres guidance on indexing foreign keys and policy columns, deterministic lock
ordering, short transactions, set-based reads, pagination, connection pooling, and measured query
plans.

## What is already strong

- The Next.js application uses the Supabase HTTP client rather than opening one direct Postgres
  connection per web request. Production reads use an authenticated cookie-bound client
  (`lib/supabase-server.ts:75-113`); direct psycopg connections are isolated to the stateful Python
  services.
- Daily observations have the correct point/range identity, a primary key on
  `(metric_id, obs_date)` (`supabase/migrations/20260703223627_v1_schema.sql:68-75`).
- RLS is consistently enabled, membership is resolved through checked `SECURITY DEFINER` helpers,
  and the observation policy fails closed through the metric's scope
  (`supabase/migrations/20260703223628_v1_rls.sql:28-56,85-97,175-191`). The current explicit tenant
  matrix passes 39/39 tests, including the two new activation audit tables.
- Activation and iteration writes are transactional, idempotent, and workspace-bound. The new
  multi-metric contract persists append-only selected-metric and action-metric relations with
  composite scope FKs and application DML revoked
  (`supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql:95-152,342-364`).
- User-controlled input paths are deliberately bounded: metric CSV is 256 KB/2,000 rows committed
  in 250-row receipts (`lib/metrics/csv.ts`, `lib/metrics/import.ts`), URL input is 1 MB, PDF input is 5 MB/40 pages, and the retained
  source corpus is 72,000 characters (`lib/decision-reports/sources/types.ts:1-7,19-42`). Private
  supplied images are limited to 5 MB and 16 megapixels (`lib/decision-reports/image.ts:6-11`).
- The recompute queue coalesces generations and has a due-work partial index
  (`supabase/migrations/20260723061925_causal_recompute_current_report.sql:26-51,160-236`), while
  workers claim with `FOR UPDATE SKIP LOCKED` (`engine/persistence/recompute.py:80-108`). Those are
  good primitives for horizontal workers once the transaction and deployment model is corrected.

## Severity-ranked findings

### P0 — all production users share one database hotspot

The session seam explicitly says invited partners share one tenant and one seeded workspace, with
per-partner tenants deferred (`lib/auth/session.ts:5-13`). `getSession()` returns the same
`DEMO_SCOPE_ID` in production (`lib/auth/session.ts:28-36`), and the dashboard data layer is pinned to
that ID (`lib/data/config.ts:9-16`; `lib/supabase-server.ts:8-19`).

At 10,000 active users this is more than a multi-tenancy limitation: all history scans, workspace-row
locks, report transitions, metric selection, queue coalescing, and RLS-visible data hit the same hot
scope. Adding web instances does not remove that database hotspot. It also makes the meaning of
"10,000 users" ambiguous: ten thousand independent customer workspaces and ten thousand people
editing one workspace are fundamentally different load and privacy contracts.

Options:

1. **Recommended:** provision a workspace per tenant, resolve the authorized active workspace from
   the session/membership, pass that identity explicitly through loaders and RPCs, and include it in
   cache keys. Keep RLS as the final enforcement boundary.
2. If one 10,000-member workspace is intentional, declare it as the primary workload. Remove broad
   workspace-row locks, introduce optimistic versions where possible, partition/denormalize the hot
   time-series paths, and load-test that single-scope contention pattern.
3. Keep the shared demo tenant for partner review, but narrow the claim: it is a controlled demo, not
   a 10,000-active-user architecture. Do not extrapolate from login traffic to dashboard capacity.

### P0 — dashboard reads are unbounded, fan out, and can become incorrect at the API row cap

One render launches nine top-level loaders (`lib/data/dashboard.ts:112-129`). The metric loader first
fetches every workspace metric, then sends one full-history observation query per metric because a
single query would cross PostgREST's default 1,000-row response cap
(`lib/data/metrics.ts:42-66`). It constructs every series in application memory
(`lib/data/metrics.ts:68-113`). Reports fetch every live report and every current JSON snapshot with
no limit (`lib/data/decision-reports.ts:53-96`); actions and decisions likewise fetch the entire
workspace (`lib/data/actions.ts:59-83`; `lib/data/decisions.ts:104-127`).

The graph path is the highest-integrity risk. It fetches every node, edge, and append-only evidence
row, then decides which evidence is newest in JavaScript (`lib/data/graph.ts:72-115`). Recompute
appends two evidence rows per target action (`engine/persistence/bridge.py:191-223,333-351`), while
the base schema has only individual scope, edge, and action indexes
(`supabase/migrations/20260703223627_v1_schema.sql:148-172`). Once a response is clipped at 1,000,
the UI can select stale evidence; this is not merely a latency problem.

Options:

1. **Recommended:** build one viewer-checked dashboard/read-model RPC. Return the explicit current
   report, paged action/report summaries, only selected/core metrics, and a bounded chart window.
   Select latest evidence in Postgres with `DISTINCT ON (edge_id, methodology)` ordered by
   `created_at DESC, evidence_id DESC`, backed by a composite
   `(scope_id, methodology, edge_id, created_at DESC, evidence_id DESC)` index.
2. Maintain a transactional `current_edge_evidence` projection and query append-only evidence only
   for audit/history screens. Continue to paginate reports/actions with keyset cursors.
3. Short term, add explicit date windows, hard surface limits, and `.range()` pagination everywhere.
   Treat a capped response as an error; never rely on an implicit PostgREST maximum.

### P0 before-state — dashboard Python drift spawn (selected option 1 implemented locally)

`getDecisions()` includes `getDriftByPrediction()` in the main dashboard render
(`lib/data/decisions.ts:108-127`). That path spawns a Python subprocess per render with a 15-second
budget (`lib/data/drift.ts:19-47`). The script may open a lookup connection and then a separate
authenticated connection (`engine/persistence/read_drift.py:58-78`). It lists every unresolved
prediction and loops over them (`engine/persistence/drift_read.py:69-83`); each iteration reloads its
metric series and levers (`engine/persistence/drift_read.py:44-66`).

This is an N+1 analytical job in a latency-sensitive read path. On a serverless deployment the
Python environment may also be absent, in which case the feature silently returns no drift. Either
behavior is a poor capacity and product contract.

Options:

1. **Recommended:** materialize drift asynchronously when relevant observations, actions, or
   predictions change. Read one indexed current-drift relation from the dashboard.
2. Batch unresolved predictions by distinct metric in a long-lived worker, cache by a durable input
   generation/hash, and publish a scope-level receipt.
3. Disable drift on the shared dashboard until a hosted, bounded service exists; expose an explicit
   on-demand analysis action instead of hidden compute-on-read.

### P0 — automatic causal recomputation remains deliberately deferred

Activation queues one recompute job in the same transaction
(`supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql:1106-1111`) and the
Server Action immediately requests a one-job drain
(`app/(onboarding)/onboarding/decision-report-activation-actions.ts:74-89`). The five-minute cron
requests at most 20 jobs (`app/api/cron/recompute/route.ts:13-17`; `vercel.json:12-15`), so its
theoretical recovery ceiling is **240 jobs/hour**. That does not prove a production ceiling because
immediate wake-ups may add concurrency, but it means the durable backstop cannot drain a
one-job-per-user 10,000-activation hour.

Each worker drains sequentially, at most 20 (`engine/persistence/recompute.py:22-24,354-370`). A
claim holds the queue row and report → series → workspace → activation locks while it loads all
observations, hashes inputs, runs NumPy, writes graph/evidence, and commits
(`engine/persistence/recompute.py:111-178,181-231,305-351`). Every HTTP invocation opens a new direct
psycopg connection (`api/recompute.py:92-103`). The deploy plan uses the Supabase session pooler
(`scripts/deploy-recompute.sh:16-21`) but defines no worker concurrency or connection budget. Most
importantly, current status says the `causent-recompute` project does not exist and no worker is
deployed (`docs/STATUS.md:18-30,646-669`).

Options:

1. **Recommended:** deploy a bounded worker pool against the appropriate Supavisor pool mode. Run N
   concurrent `SKIP LOCKED` claims with explicit connection, statement, and lock timeouts; size N
   from measured job seconds and database headroom. Track jobs/second and oldest-job age.
2. Claim/lease in a short transaction, compute outside report/workspace locks from an immutable
   snapshot/version, then compare-and-swap the generation and current pointer in a short commit.
   This requires strict stale-result guards but removes long lock occupancy.
3. Move work to a managed durable queue with autoscaled workers and a database semaphore/backpressure
   limit. Raising cron frequency or batch size alone is unsafe until query and connection load are
   measured.

### P1 before-state — large synchronous CSV transaction (selected option 3 implemented locally)

Both Server Actions buffer and parse the complete upload before calling Postgres
(`app/(dashboard)/data-workshop/server-actions.ts:125-150,166-194`). The workspace import locks the
workspace before row-by-row JSON validation, repeated JSON expansion, an existing-row count, and a
10,000-row upsert
(`supabase/migrations/20260722225327_decision_report_workspace_metric_import.sql:50-75,98-142`). The
active-report import likewise locks workspace → report → metric before the expensive work
(`supabase/migrations/20260723061925_causal_recompute_current_report.sql:812-905`).

Besides request duration, the active import's workspace-first order conflicts with activation's
report-first order. Concurrent import and activation/retry can form a deadlock; Postgres can choose a
victim, but the application has no general transaction-retry envelope for that case.

Options:

1. **Recommended:** upload to a staging/private Storage path, validate asynchronously, use `COPY` or
   a staging-table merge, and hold the target/version lock only for the short final commit.
2. Parse JSON into a CTE or temporary relation and perform set-based validation before taking the
   workspace/report locks. Align every affected RPC to one documented lock order and add lock and
   statement timeouts.
3. Keep the small synchronous MVP path but lower the cap, process idempotent chunks, return a job
   receipt/progress state, and retry serialization/deadlock victims safely.

### P1 partial — hot indexes and plan scripts implemented; representative plans pending

The observation primary key is good for `metric_id + date`, but observations carry no `scope_id`.
Every RLS-visible row resolves metric → scope → workspace/project → membership through nested
security-definer helpers (`supabase/migrations/20260703223628_v1_rls.sql:28-56,85-97,184-191`). This
is secure, but no authenticated `EXPLAIN (ANALYZE, BUFFERS)` evidence exists at gigabyte volume.

Actions have only individual scope and cluster indexes even though the UI and worker filter/order by
scope and effective date (`supabase/migrations/20260703223627_v1_schema.sql:96-110`;
`engine/persistence/recompute.py:202-216`). Decisions have only `scope_id` while the UI orders by
`created_at` (`supabase/migrations/20260711000000_prospective_layer.sql:25-35`;
`lib/data/decisions.ts:108-120`). `decision_report_series` has no scope-leading index although every
report index render filters on scope
(`supabase/migrations/20260723053444_decision_report_iteration_series.sql:3-9,66-70`;
`lib/data/decision-reports.ts:58-65`).

Options:

1. **Recommended:** first replace broad reads with bounded queries, then capture authenticated query
   plans and add workload-shaped indexes, likely `(scope_id, effective_date DESC, action_id)`,
   `(scope_id, created_at DESC, decision_id)`, and
   `(scope_id, created_at DESC, series_id)`. Indexes do not rescue an all-history API contract.
2. Denormalize `scope_id` onto observations with a composite
   `(scope_id, metric_id, obs_date)` key/index and a direct scope policy, preserving the metric FK and
   validating scope agreement. This spends storage/write complexity to make policy filtering direct.
3. Keep the normalized schema and expose narrow security-definer time-series RPCs that authorize the
   scope once, then execute indexed range queries. Benchmark them against direct RLS before choosing.

### P1 before-state — private image byte proxy (selected option 1 implemented locally)

The private bucket and path policy are sound: it is non-public, 5 MB-limited, type-limited, and
member-scoped (`supabase/migrations/20260722165809_decision_report_assets.sql:5-16,18-50,266-295`).
However, every preview performs a metadata query, downloads the Storage object into the Next route,
and sends the bytes again with only a 60-second private cache
(`app/api/decision-report-assets/[assetId]/route.ts:6-28`). Upload buffers the file in a Server Action
(`app/(onboarding)/onboarding/decision-report-asset-actions.ts:21-27`) and Sharp decodes/re-encodes up
to 16 megapixels inline (`lib/decision-reports/image.ts:74-124`). Cleanup is request-coupled and
sequential (`lib/decision-reports/assets.ts:62-74,145-162`); no scheduled orphan collector was found.

At the maximum size, one asset for each of 10,000 users is roughly 50 GB before replicas and egress.
Storage capacity itself is not the primary problem; repeated application double-hop, sanitizer CPU,
orphan lifecycle, and unmeasured bandwidth are.

Options:

1. **Recommended:** after the metadata/RLS check, issue a short-lived signed Storage/CDN URL for the
   exact server-owned path. Use the content hash as an immutable ETag/version and avoid Next.js byte
   proxying.
2. Reserve a direct-upload path, quarantine the object, and run sanitation in a bounded image worker
   before marking it attached/servable.
3. Keep the inline MVP path but honor `If-None-Match`, use longer immutable caching for attached
   content-hashed assets, cap sanitizer concurrency, and add scheduled pending/detached-object GC.

### P1 before-state — connector retry loss (selected option 1 implemented locally)

The signed GitHub webhook is processed inline (`app/api/webhooks/github/route.ts:23-41`). Its core
path commits a unique transition-event row before calling the separate lever detector
(`lib/levers/webhook.ts:70-108`). If the detector or its second database request fails after that
first commit, GitHub redelivery sees the event as a duplicate and permanently skips the unfinished
work. The dedup key prevents double processing, but it is not a transactional inbox.

The hourly reconciliation sweep loads every `DRAFTED`/`CREATED` lever in the shared scope and polls
external providers serially (`lib/levers/reconcile.ts:42-93`; `vercel.json:3-7`). Levers have separate
scope and status indexes, not an index shaped for that combined scan
(`supabase/migrations/20260712040728_cold_start_levers.sql:23-43`). GitHub backfill also pre-reads
references and batch-inserts fresh rows; one concurrent unique conflict makes the adapter return zero
for the entire batch (`lib/ingest/github-store.ts:23-47`; `lib/ingest/github.ts:347-366`).

Options:

1. **Recommended:** add a transactional webhook-inbox RPC with
   `received/processing/processed/failed`, attempts, and a durable payload digest. Apply the event's
   canonical mutation and mark it processed in one transaction, with async retry/dead-letter handling.
2. Make reconciliation cursor-based and claim stale rows in bounded batches (`SKIP LOCKED`), group
   external searches by repository/token, use rate-limited concurrency, and add a partial composite
   index for open stale levers.
3. At minimum, allow compare-and-swap retries of incomplete webhook deliveries and use
   `INSERT ... ON CONFLICT DO NOTHING RETURNING` for action backfill so one raced reference cannot
   erase the successful count for unrelated rows.

### P1 before-state — monolithic multi-metric rollout (selected option 1 implemented locally)

The migration alters activation constraints, builds new full-table unique constraints on metrics and
actions, updates/backfills every historical activation, validates anomaly queries, creates child
tables/indexes, and attaches deferred FKs in one transaction
(`supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql:9-35,65-263`). This
is appropriate for the current small local database and passes a clean reset. On large tables, the
blocking DDL, index builds, backfill, and constraint validation can hold locks long enough to exceed a
normal deploy window.

Options:

1. **Recommended:** before material production volume, split rollout into expand → batched backfill →
   validate → contract. Build large indexes concurrently, attach them as constraints, create FKs and
   checks `NOT VALID`, then `VALIDATE CONSTRAINT` separately.
2. Take a measured maintenance window after a production-size clone rehearsal and temporarily stop
   activation/import writes; keep the current single migration only if measured lock time fits.
3. For the current partner database, apply database first and app second; roll back app first. The
   legacy normalizer keeps old v1/v2 clients compatible, but a new app cannot call v3 before the DB is
   expanded.

### P1 partial — load/SLO instruments implemented; staging evidence still absent

The current tree adds `load/causent-mvp.js`, a protected manual staging workflow, initial latency/error
thresholds, and `engine/persistence/scale_fixture.py`. Those are the selected test instruments, not a
passing result. The normal CI correctness/build gates still do not exercise production concurrency,
and the new workflow has not run against configured staging or retained database/pool/worker
telemetry. Worker logging remains focused on request/terminal outcomes rather than a complete capacity
dashboard.

Options:

1. **Recommended:** add k6 or Artillery scenarios and a deterministic scale fixture. Gate a staging
   release on steady, burst, hot-workspace, mixed-write, and soak profiles.
2. Add OpenTelemetry/Sentry plus database and worker dashboards: route/RPC latency, pool wait/active
   connections, row scans and bytes, lock waits/deadlocks, queue depth/oldest age/retry/terminal jobs,
   job seconds/rows, Storage latency/egress, and error rate.
3. Enable and retain `pg_stat_statements` evidence plus authenticated
   `EXPLAIN (ANALYZE, BUFFERS)` for the top read/write paths. Stage at 1x and 2x the target rather than
   inferring from local correctness.

## Required capacity test matrix

| Profile | Minimum shape | What it answers |
| --- | --- | --- |
| Steady arrivals | 10,000 users/hour, realistic six-to-ten request journey | Average route/RPC and pool capacity |
| Burst | At least 10x average request rate plus a concurrent-login/open wave | Cold starts, auth, pool wait, API throttling |
| Hot workspace | Hundreds of concurrent readers plus activation/import/completion on one scope | Lock contention and shared-workspace semantics |
| Gigabyte fixture | Production-shaped metric, observation, report, action, graph, and evidence cardinality | Row caps, memory, query plans, index selectivity |
| Recompute surge | One queued generation per activation/import, worker loss then recovery | Jobs/sec, backlog age, retry and backpressure |
| Soak | Several hours at target with background ingestion/recompute | Leaks, bloat, queue drift, connection churn |
| Adversarial tenant | Same load split across member/viewer/foreign users | RLS latency and isolation under concurrency |

Suggested initial acceptance budgets—not current guarantees—are: page/API p95 below 2 seconds and
p99 below 4 seconds for bounded dashboard reads; fewer than 1% unexpected 5xx/timeouts; database CPU
and pool occupancy below 70% steady state; zero deadlocks/cross-tenant rows; and recompute oldest-job
age below two minutes after the burst ends. These must be adjusted with product expectations and the
chosen Supabase/Vercel plans.

## Recommended implementation order

1. Decide whether the target is many customer workspaces or one large collaborative workspace; remove
   the hard-coded production demo scope accordingly.
2. Replace the all-history dashboard/graph path with bounded, paginated server-side read models and
   move drift off the request path.
3. Deploy and instrument the recompute worker, shorten its lock-holding phase, and establish a tested
   connection/concurrency budget.
4. Align lock ordering and move larger CSV/image work to staged asynchronous processing.
5. Add workload-shaped indexes from real plans, then execute the capacity matrix at 1x and 2x target.

Until those P0 items are closed, the honest engineering statement is: **the schema is robust for
audited MVP state transitions and isolation, but the end-to-end system is not yet robust for 10,000
active users/hour over gigabytes of data.**
