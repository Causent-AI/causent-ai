# Causent Decision Report — Product, Science, and Engineering Hardening Follow-up

Date: 2026-08-16

Status: selected changes implemented and exact local combined gate passed; release gates pending

Scope: founder-selected responses from the 2026-08-16 product-manager, data-scientist, and
engineering-schema reviews

Evidence standard: source/contract inspection, clean local database replay, credentialed integration
tests, complete application/engine suites, production build, and desktop/mobile browser acceptance.
This report does not claim a new customer causal result, partner validation, staging capacity, hosted
CI, production migration, or deployment.

## Outcome

This round connects the product's document, execution, and measurement surfaces while tightening the
scientific meaning and several high-risk persistence paths:

`Finish report -> Set commitment -> Start action -> Complete plan -> Measure decision package`

The one primary outcome and registered primary action remain immutable. Supporting metrics remain
monitoring context. In a multi-action plan, measurement begins at the included action with the latest
effective completion date because that is when the whole decision has been implemented; immutable
report order breaks same-day ties. Causent records that action/date separately without rewriting
which action was originally registered as primary or depending on completion-entry order.

## Product decisions implemented

- One sticky lifecycle footer replaces separate readiness/activation wayfinding. It focuses the next
  missing report field, then the next missing commitment field, then the action-level **Start**.
- The Action Plan chart derives from the current primary metric and commitment, using the connected
  baseline and an immediately updated signed target.
- The complete default-included action/metric plan stays visible before execution. Starting one action
  still activates the complete exact saved plan and opens only the clicked canonical action.
- Report-native Actions keeps a compact commitment header with outcome metric, signed commitment,
  native baseline/target when available, resolution date, registered primary action, state, and Data
  and Impact links.
- Navigation remains **Data -> Reports -> Actions -> Impact**. The review's alternate navigation
  option was deliberately not re-opened.

Primary evidence:

- `lib/decision-reports/product-continuity.ts`
- `components/decision-report/DecisionReportEditor.tsx`
- `components/decision-report/ActionPlanCanvas.tsx`
- `components/decision-report/PredictedImpactChart.tsx`
- `components/actions/DecisionDetail.tsx`
- `components/impact/PredictionPanel.tsx`

## Scientific decisions implemented

- `lib/data/decision-report-activation-contract.ts` reads the current report's normalized selected
  metrics and action bindings. Incomplete, cross-linked, or malformed audit state fails closed; no
  fallback reconstructs scientific meaning from action rationale text.
- Percent-of-mean remains the one activation commitment. The native calculator shows baseline,
  signed delta, and implied target in the metric's real unit without creating a second prediction.
- The viewer-checked metric catalog exposes last observation/value, pre-history count/days,
  percent scale, earliest confident review date, and **Ready to monitor**, **Needs data**, or
  **Causal window not ready**. These states do not block activation and do not lower the 45/45 ITS
  confidence floor.
- Supporting action bindings may retain an optional expected direction and check date as monitoring
  context. The registered primary action does not receive a second monitoring hypothesis.
- `decision_report_package_interventions` is created only after every included V3 action is complete.
  It preserves the registered primary action and stores the latest-effective included action/date as
  the package breakpoint, using report order as the deterministic same-day tie-break. Recompute and
  resolution label the causal object as the **Decision package**; individual-action attribution is
  unavailable.

Primary evidence:

- `lib/decision-reports/prediction-calibration.ts`
- `lib/data/decision-report-activation-contract.ts`
- `supabase/migrations/20260817055407_decision_report_scientific_contracts.sql`
- `engine/persistence/recompute.py`
- `engine/persistence/resolve.py`

## Engineering decisions implemented

### Async materialized drift

`20260817055415_materialize_current_prediction_drift.sql` adds a coalesced private workspace queue
and a viewer-readable current projection. Relevant source writes advance a requested generation. A
bounded worker leases due work, computes outside the dashboard request path, and publishes only if a
short compare-and-swap still matches that generation. The public RPC returns bounded sanitized
results and freshness; malformed rows fail the application snapshot closed.

The app cron and worker seam exist, but the hosted worker, `DATABASE_URL`, `CAUSENT_DRIFT_URL`, and
matching secrets are not deployed or canaried.

### Chunked CSV receipts

`20260817055817_chunked_metric_csv_imports.sql` lowers one synchronous import to 2,000 rows and
stores durable job progress. A begin call fixes the scope/metric/file identity; deterministic
250-row append calls are idempotent by chunk digest; finalize requires complete contiguous progress.
Exact resubmission resumes or reuses the final receipt. The application retries only bounded
serialization, deadlock-victim, and lock-unavailable failures. CSV bytes are not retained.

### Durable connector inbox

`20260817055412_connector_webhook_inbox.sql` makes verified GitHub/Jira delivery durable before the
canonical mutation. Provider ID plus payload digest owns exact retry identity. Mutation and the
processed marker commit together; failures retain bounded retry/dead-letter state. Authenticated and
anonymous callers have no table or RPC access. Provider routes reject oversized bodies before parse.
GitHub repository and Jira site/project origin are part of the checked target. Ambiguous historical
Jira rows quarantine without consuming retry budget until an explicit same-scope re-draft safely
binds their site.

### Private-image delivery

The existing private bucket, sanitation, server-owned path, report/revision attachment, and
workspace/status checks remain unchanged. The read route now returns a short-lived signed Storage URL
for the exact content-hashed path instead of downloading and proxying the bytes through Next.js.

### Indexes, migration rollout, and scale instruments

- `20260817060606_hot_read_path_indexes.sql` covers current action, decision, report-series, latest
  evidence, and open-lever filters. Authenticated plan and online-index scripts are included.
- Multi-metric activation is split into expand (`20260817012313`), bounded backfill
  (`20260817062054`), validation (`20260817062057`), and contract (`20260817062102`). The runbook
  keeps v1/v2 callable until v3 is safe to expose and requires concurrent parent-index builds for a
  populated database.
- `load/causent-mvp.js`, `.github/workflows/staging-load.yml`, and
  `engine/persistence/scale_fixture.py` define guarded smoke, steady, burst, hot-workspace,
  mixed-write, soak, adversarial, and deterministic scale-fixture work. The reusable `release_gate`
  runs steady, burst, hot-workspace, mixed-write, and soak serially in the protected `staging-load`
  environment. Initial targets are checks above 99%, unexpected HTTP failures below 1%, p95 below
  2 seconds, and p99 below 4 seconds.

These additions do not prove capacity. The broad dashboard/history contract remains unbounded, the
automatic causal worker remains undeployed/throughput-gated, and representative authenticated plans,
load/soak artifacts, pool occupancy, lock waits, queue age, and production-like data volume are still
required.

## Deliberately deferred

- bounded/paginated dashboard and graph read-model replacement;
- production automatic causal-recompute worker pool, connection budget, and instrumentation;
- separate-customer tenant provisioning and a measured hot-workspace contract;
- production deployment, remote migrations, and any claim that 10,000 active users/hour over
  gigabytes is supported;
- MCP/provider synchronization; the current manual copy/paste seam remains powerless; and
- the missing initially unassisted partner sessions.

## Local verification — 2026-08-17

- Clean `npm run db:reset-demo`: **PASS**; all migrations replayed and both review workspaces reseeded.
- Warning-level schema lint: **PASS** with four pre-existing advisories and no new schema error.
- TypeScript and full ESLint: **PASS**.
- Credentialed Node/Supabase/RLS/Storage suite: **660 total, 641 passed, 19 intentional live-model
  skips, 0 failed**.
- Complete engine/bridge/isolation suite: **1,251/1,251 passed**.
- Authenticated hot-query EXPLAIN contract: **PASS** against the deterministic fixture. The 1.19 GiB
  fixture planner also completed; representative-volume plans remain a staging gate.
- Next.js `16.2.11` webpack production build: **PASS** under bundled Node `24.19`; the repository and
  hosted CI remain pinned to Node `22.23`. The request-bound dashboard manifest guard passed.
- Browser acceptance: **PASS** at desktop and `390 x 844`. It generated and activated a Northstar
  report, selected two metrics, bound Setup Support Tickets to a supporting action, activated the
  whole plan by starting that support action, preserved the registered primary action, opened the
  exact clicked canonical row, and verified Data/Reports/Actions/Impact plus workspace switching and
  Core Metrics ordering. The warning/error console was empty. Browser review found and fixed a
  flex-collapsed commitment card and the remaining sub-44 px mobile links.
- `git diff --check`: **PASS**; `plugins/` remains untouched and excluded.

## Remaining release gates

- Run the protected staging `release_gate` and retain all k6 artifacts.
- Capture authenticated plans against representative gigabyte-scale data and record pool/lock/queue
  behavior; the local planner alone is not capacity evidence.
- Rehearse the split migration and concurrent indexes against a production-sized clone.
- Configure and canary the hosted drift/recompute workers, connector retry cron, signed-image route,
  and production runtime secrets before any migration or deployment.
- Complete hosted PR/CI review, founder review, and the missing initially unassisted partner sessions.

Accurate statement: **the selected hardening contracts and exact local combined gate pass, but the
release and 10,000-users/hour capacity are not verified.**
