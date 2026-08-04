# Causent — Build Status & Resume Guide

## 2026-08-03 — Slice 10 review branch

PR #28 merged the Slice 8/9 baseline into `main` as `c894451`. The separate
`codex/decision-report-slice-10` branch and draft PR #29 package the explicit iteration-series work, bounded URL/PDF
ingestion, automatic current-report recomputation, manual AI handoff preview, and the MVP completion
guardrails described below for review. Publication does not apply migrations, configure or deploy the
worker, satisfy the partner-session gate, or establish that the expanded hosted CI workflow passed.

## 2026-07-23 — Expanded Decision Report MVP completion

Explicit post-activation iterations are implemented as linear series with a database-owned current
report pointer and an explicit workspace series pointer. Successor start is checked, locked,
retry-safe, and copies the reviewed snapshot without private asset identity. Activation creates a
fresh canonical intent set and moves both pointers atomically; prior canonical and audit rows remain
immutable. Reports presents the timeline and current-only start flow, while Actions & Decisions,
Data Workshop, and Impact resolve through the explicit current report.

The expanded MVP also accepts at most one bounded public HTTPS page and one bounded text-based PDF.
It performs no crawl or OCR, stores no raw URL/PDF bytes, and persists provenance v2 source chunks,
locators, and SHA-256 digests in the RLS-protected revision snapshot. The first sourced save consumes
a private, 24-hour, one-use server-minted receipt bound to the actor, scope, exact source summaries,
and sourced-claim multiset; later revisions cannot replace that corpus. Activation v2 records one
selected action as the primary manual lever. Activation, current-report observation changes, and
primary-action completion enqueue a private, coalescing causal-recompute job; the stateful worker
revalidates the current pointers before materializing graph evidence. Its standalone Python 3.12
deployment bundle is stage-tested but has not been linked or deployed.

Actions & Decisions also contains a manual preview of the future agent loop. It exports only a
bounded, redacted view of the explicit current report and accepts a fingerprint-matched structured
review as transient browser state. Nothing is sent automatically, and the preview has no server
write, report mutation, action-completion, recompute, or attribution path. An authenticated MCP/API
connection for Claude or ChatGPT remains deferred until after partner review.

The MVP finish starts onboarding blank, with the Gummy Alpha fixture behind an explicit **Load
example** action. Before generation, the user must confirm that the project brief and extracted
URL/PDF text may be sent to the configured AI provider; changing any source clears that confirmation.
Generation, provider, and route failures preserve the user's input or durable revisions and expose
retry or return-to-Reports recovery rather than implying data loss.

Decision Report lifecycle telemetry is best-effort and content-free. It records only an opaque
server-minted session key, elapsed time, bounded edit/follow-up/missing-field counts, and a small
boolean allowlist. It contains no report, prompt, source, asset, or clipboard content. The aggregate
measures distinct-session stage counts/drop-off, median time to editable/save/activation, median
edit/follow-up counts, and failure events plus affected sessions. Data Workshop and Impact now show
only the explicit current report's sanitized recompute state (`idle`, `queued`, `retrying`, `failed`,
or `current`) and safe timestamps; private queue details remain inaccessible. Authenticated telemetry
access is explicitly append-only at the privilege layer (`SELECT`/`INSERT` only), including revocation
of `TRUNCATE`, which row policies cannot block.

Prediction resolution dates must be strictly later than the current UTC date. The activation form
starts at tomorrow, the shared server validator rejects today/past/invalid dates, and a database
trigger independently rejects any activation insert whose date is not future-facing.

Production configuration now fails closed: the app requires its Supabase URL, anon key, and
server-only `SUPABASE_SERVICE_ROLE_KEY`, because provenance receipt minting is deliberately
service-role-only. Release checks additionally require the recompute URL/secret and cron secret for
the app, and `DATABASE_URL` plus the matching recompute secret for the worker. Local-only demo,
seed, fixture, and local-rollout flags must be absent. Node is pinned to `22.23.0`; the expanded CI
workflow pins Python 3.12 and Supabase CLI 2.98.1 and runs the complete local release gate. The
expanded Slice 10 revision has not yet completed hosted CI.

The shared dashboard layout is explicitly `force-dynamic`. This closes the production-cache defect
found during completion browser acceptance: Reports and Impact had been eligible to freeze a seed or
pre-activation snapshot at build time even though their data is workspace/current-report specific.
The Next.js 16.2.11 webpack build now classifies `/actions`, `/data-workshop`, `/impact`,
`/onboarding`, and `/reports` as dynamic routes. `check:dashboard-build` independently inspects the
build manifests and fails unless the four dashboard pages exist and remain absent from the prerender
manifest; the local guard passes and CI runs it immediately after the webpack build.

Implementation proceeded under an explicit product-direction override before the normal Slice 9
partner-session gate. The missing three initially unassisted sessions remain required release evidence;
this override is not evidence that the gate passed. The implementation is packaged separately from
merged PR #28 on `codex/decision-report-slice-10` in draft PR #29; migration, deployment, and canary
work remain open.

Last updated: 2026-08-03. Single source of truth for "where are we and how do I pick up."
Product: **dual cold-start on one causal graph** — the retrospective wedge ("Did-It-Ship,
Did-It-Work": tie each shipped action to a metric, honest ITS readout) PLUS the prospective
on-ramp (human pre-registered prediction → drift watch → engine-measured resolution). See
`docs/designs/prospective-prediction-loop.md` (approved 2026-07-11).

**Active product plan:** replace form-like onboarding with an AI-assisted Decision Report
that makes Causent's leverage visible immediately. One initial prompt produces multiple
coordinated assets from one typed report aggregate: a partial three-section report,
sourced-evidence summary with up to three proof claims, metric hypothesis/chart, action-plan
summary, up to three draft actions, and an explicit supplied-mock-up state. Focused inline questions fill required gaps; this is not a
general chatbot. One final idempotent operation materializes the decision, human prediction,
metric relationship, and selected actions. Approved design:
`docs/designs/ai-assisted-decision-report.md`.

## TL;DR

**The Slice 10 review branch contains Decision Report Slices 1–10 plus the accepted
partner-feedback follow-ups. It now covers bounded generation, focused completion, durable
revisions, human-controlled activation, private sanitized images, CSV metrics, report-native
dashboard isolation, action completion, recoverable report removal, controlled rollout, explicit
linear iterations, bounded one-URL/one-PDF ingestion with provenance v2, and automatic
current-report causal recomputation. A current-report-only manual AI copy/paste preview demonstrates
the proposed external-agent loop without granting it a write path. Reports retains immutable lineage; the three operational tabs
show only the workspace's explicit current report. The 45-day-per-side ITS confidence floor is
unchanged. The current clean reset, schema lint, TypeScript, full lint, Node/Supabase, focused
integration, engine/bridge, webpack production build, and four-iteration browser/console acceptance
are green. Three real
initially unassisted partner sessions, one final deep UI/workflow review, production
migration/configuration, and deployment canaries remain human/operator gates.**
The retrospective loop closed 2026-07-08 (PR #1) and the
**prospective Foundations tranche landed 2026-07-12 (PR #12, epic #6, children #7–#11
all closed, cloud CI green)**: intent-layer schema (`decisions`/`decision_actions(is_lever)`/
`predictions`/`prediction_revisions`/`transition_events`), the 8-state resolution verdict
machine + CLI runner (`engine/persistence/resolve.py` + `run_resolution.py`), on-the-fly
reference-class priors (`lib/priors.ts` + `lib/data/priors.ts`), a decisions-first Actions &
Decisions tab (elicit-not-assert capture, lever mapping, reason-gated revisions, caveat-first
readout), and seed exercising all six target verdicts through the REAL engine. Evidence:
`docs/OVERNIGHT_REPORT_3.md`. **The baseline-metric-drift DEMO beat shipped (PR #22, 2026-07-13)** —
reconciled through office-hours + CEO/Eng/Design review as the demo showcase (a change-point detector
over the metric's own series), distinct from the still-gated webhook lever-descope drift (#18).
**The Decision Report remains an unvalidated product thesis.** The explicit product-direction
override permitted bounded URL/PDF ingestion, iterations, and causal automation before partner
evidence. Do not treat that override as permission for OCR, URL crawling, broad file ingestion,
conversational delivery, or other production expansion before observed unassisted use.

```
✓ Plan     office-hours → CEO → Eng → Design reviews (all CLEARED)
✓ Engine   honest causal inference, 1058 tests (1078 with engine-fn), signed off 8/10
✓ Schema   11 tables, RLS + RBAC memberships, tenant-isolation verified (0 leaks)
✓ Bridge   engine → evidence (append-only) → causal graph, live E2E verified
◐ CI       expanded pinned workflow configured; Slice 10 review revision awaiting hosted CI
✓ App/UI   approved shell (Next 16): 4 tabs + Core Metrics drawer, visual-QA'd vs mockups
✓ Loop     seed → real bridge → Supabase → UI; /impact matches DB cell-for-cell (A1–A4, A-verify)
✓ Ingest   fixture-tested capped/idempotent GitHub → actions + live adapters/CLI (C1, C-verify)
✓ Summary  honest deterministic readout→prose + adversarial/regression eval (B1, B2, B-verify)
✓ Engine-fn  deploy-ready Vercel Python fn (guards+caps), stateless, no creds (D1, D-verify)
✓ Live-eval Anthropic summary guardrail proven vs claude-opus-4-8 (19/19, 2026-07-04)
✓ Landed   PR #1 overnight/wire-up → main (2026-07-08); local main synced
✓ UI-v2    Reports tab + North Star objective + Aggregated-Impact restructure (2026-07-09)
✓ UI-v3    FINAL brand logo + nav deep-links + objectives DB parity + mobile fixes +
           ingest hardening (2026-07-10, branch overnight/ui-polish)
✓ ENGINE   LIVE at https://causent-engine.vercel.app/api/engine (2026-07-11, standalone
           Vercel project via scripts/deploy-engine.sh; secret set; smoke-tested 405/401/200)
✓ PIVOT    prospective-prediction-loop design approved + docs on main (2026-07-11)
✓ PROSPECT Foundations tranche MERGED (PR #12, 2026-07-12): intent schema + verdict
           machine + priors + decisions-first Actions tab + seed (1110 pytest, 245 lib)
✓ COLDSTART C1+C4 MERGED (PR #20, 2026-07-13): levers table (multi-lever, drops
           is_lever), declared metric + UNMEASURABLE_NO_METRIC, cluster-resolution path
✓ AUTH     #5 invite-only Google-OAuth allowlist + create-from-decision GitHub connector
           scaffolding MERGED (PR #21, 2026-07-13); local demo fallback retained, while the
           later 2026-07-16 production deployment armed invite-only Google OAuth
✓ DRIFT    baseline-metric drift DEMO beat MERGED (PR #22, 2026-07-13): change-point detector
           (segmented_ols reuse) + calm assert-fact notice + stub Restate; seeded, 1147 pytest
✓ FUNNEL   #15 onboarding funnel CLOSED (PR #23, 2026-07-13): Step-1 auth wired + instrumentation
           + E2E-under-auth; #18 ship-state + resolution scorecard shipped (drift-alert deferred)
✓ DEPLOY   app LIVE at https://app.causent.ai (2026-07-16): Vercel project `causent-ai`
           (git-connected, auto-deploys main), invite-only Google OAuth ARMED (allowlist
           hook + owner invited), cloud Supabase seeded via seed_demo.py — all 7 verdicts
           + drift beat live; Google OAuth + GitHub App + fine-grained PAT all configured
✓ RESOLVE  resolution PORT MERGED (PR #24) + DEPLOYED 2026-07-18: api/resolve.py stateful
           sibling of the engine fn LIVE at https://causent-resolve.vercel.app/api/resolve
           (own Vercel project `causent-resolve`); CAUSENT_RESOLVE_SECRET set on both projects
           + CAUSENT_RESOLVE_URL on the app; guards smoke-tested (GET 405, no/bad secret 401).
           ☐ ONE STEP TO ARM: set DATABASE_URL (Supabase SESSION pooler DSN, :5432) on
           causent-resolve, then REDEPLOY BOTH projects (Vercel env added post-deploy needs a
           redeploy). Until then the cron 500s at the DB connect (auth passes).
✓ JIRA     #19 Jira parity + write-scope auto-create MERGED (PR #25, closes #19): read-only
           deep-link + scan-detect + canonical map + webhook + write-scope issue-property/label
           create; 27 tests + 334 lib green, no migration. Code LIVE on main; route INERT until
           armed. ☐ TO ARM: JIRA_BASE_URL/EMAIL/API_TOKEN/WEBHOOK_SECRET + GITHUB_WRITE_TOKEN
           (Issues:R+W) on causent-ai + a Jira webhook → /api/webhooks/jira (deferred: no Jira
           instance tonight). Read-only deep-link + paste works with zero creds now.
☐ PARTNER  zero-code mechanism-mapping test  ← gates T2 connector completion + #18 drift-alert surface
☐ CONFIG   production now requires a server-only SUPABASE_SERVICE_ROLE_KEY for provenance receipt
           minting; set and canary it before release. Connector automation remains a separate
           operator decision; paste-URL attribution still works without provider write automation.
☐ OPEN     #16 connector live (creds) · #18 drift-alert surface (gated) · ~~#19 Jira parity~~ (PR #25)
◐ ACTIVE   AI-assisted Decision Report partner wedge: Slices 1–10 implementation complete locally. The 24.4s
           six-action baseline triggered a sparse three-proof/three-action contract; live
           re-benchmark passed in 13.9s. Durable explicit save/reload is now verified;
           explicit metric/prediction/action activation now materializes atomically and
           hands the user to Actions & Decisions. Data Workshop now imports a bounded
           daily CSV into a named workspace metric or, after activation, only that report's
           confirmed metric. The workspace catalog feeds future report metric selection. One
           sanitized PNG/JPEG now
           attaches privately to an editable revision with scoped preview, safe replacement/
           removal, and active-report locking. Linear successors, bounded one-URL/one-text-PDF
           sources, provenance v2, and automatic current-report recomputation are implemented.
           A redacted, ephemeral manual AI copy/paste preview shows the proposed loop without MCP,
           writes, or automatic sync. Controlled rollout and local PDF/URL acceptance pass; one final
           deep UI/workflow review, three initially unassisted partner sessions, and production rollout
           remain open.
```

## What's built (historical landed baseline plus the current local Slice 10 working tree)

- **Causal engine** — `engine/causal/` (C1–C9): pure-numpy segmented-OLS Interrupted Time
  Series + a 7/14-day descriptive cross-check. **Honest by design:**
  - `FLOOR_CONFIDENT = 45` days/side — a confident `belief = 1.0` requires both sides ≥ 45
    daily points AND the CI excludes zero AND it survives BH-FDR AND the placebo didn't fire
    AND Durbin-Watson ≥ 1.3. Below the floor → `INSUFFICIENT_HISTORY` (belief withheld,
    "gathering data"). Strong autocorrelation → capped 0.5 (`AUTOCORRELATION`). FDR-demoted →
    0.5 (`FDR_DEMOTED`, auditable). Placebo fired → vetoed.
  - The causal method is **Interrupted Time Series** — deliberately **not** "CausalImpact"
    (Google's Bayesian structural method, which we do not use).
  - Verified by an AR(1) coverage gate: belief-1.0-on-noise ≤ 6%. scipy is a **test-only**
    oracle; shipped code is numpy-only (`t_ppf` matches scipy to ~1e-9).
- **Schema + RLS** — `supabase/migrations/`: org→project→workspace
  scope hierarchy, `memberships` (RBAC: owner/admin/member/viewer, inherits down), metrics +
  observations, actions (with `rationale_richtext`), clusters, nodes, `causal_edges`,
  append-only `evidence_objects`. RLS on every table via `has_scope_access()`. A live
  tenant-isolation gate proves user A can't read user B; 3 privilege-escalation holes were
  caught + fixed (metric_scope leak, admin→owner self-grant on INSERT/UPDATE).
- **Persistence bridge** — `engine/persistence/bridge.py`: server-side, RLS-scoped (engine
  stays stateless, no DB creds). Fetches metric+actions → `batch_readout` → appends evidence
  → materializes edges (direction/belief/reason from the authoritative ITS row) → cluster
  overlay. Live E2E gate + 3 integrity defects fixed and locked as regression guards.
- **CI** — `.github/workflows/ci.yml`: on every push to `main` and every PR, pins Node from
  `.node-version` (`22.23.0`), Python 3.12, and Supabase CLI 2.98.1; starts a clean Supabase
  stack; runs TypeScript, full lint, serialized Node/Supabase/RLS/Storage tests, schema lint,
  complete engine/bridge/isolation tests, recompute bundle staging, and the Next.js 16 webpack
  production build, then asserts that Actions, Data Workshop, Impact, and Reports are request-bound
  rather than prerendered. The workflow is configured in this working tree; a hosted run is still pending.

## How to run it

```bash
# DB-backed tests need the local Supabase stack (Docker must be running):
supabase start            # or: supabase db reset  (clean-slate migration apply)

# Current full engine/bridge/RLS suite (1204 tests):
cd engine && .venv/bin/python -m pytest -q

# Current serial Node/Supabase/Storage suite (499 total; 480 pass, 19 live-model skips):
node --test --test-concurrency=1 "lib/**/*.test.ts"

# Network-free release checks (run only with the target's production env loaded):
npm run check:release-config
npm run check:recompute-config

# After `npm run build:webpack`, assert dashboard routes are not prerendered:
npm run check:dashboard-build

# Engine-only (no DB): the non-test_rls_/test_bridge_ files.
# Local DB URL used by the DB tests: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Python env: `engine/.venv` (numpy shipped; scipy + psycopg are test-only dev deps in
`engine/requirements-dev.txt`).

## Key product boundary (don't lose this)

**A metric needs ~45 days of daily history on each side of a ship date before Causent makes
a confident causal claim.** Shorter → honest "descriptive + gathering data." This shapes the
first-partner ask (point it at a metric with ~3 months of daily history and a change that
shipped 45+ days ago) and the demo (pick such a metric). It is the "credible inconclusive"
the design was built around.

## Loop closed — as built (2026-07-04, branch `overnight/wire-up`)

The dashboard now renders **from Supabase** (materialized `causal_edges` + authoritative ITS
`evidence_objects`), not seed data. `lib/seed.ts` is retained only behind the explicit
`CAUSENT_USE_SEED=1` development flag; database read failures surface instead of silently replacing
current report data with old fixtures. Verified: a
served `/impact` in DB mode matches an independent direct-SQL computation of the graph
cell-for-cell (Actions 10, Confident 4/50, Net +$249K, Gathering 15, Win 50%, per-action
lifts, all-dash sub-45-day May cohort), the 45/45 boundary is faithfully reflected, and the
service-role key does NOT reach the client bundle. New wiring:
- `engine/persistence/seed_demo.py` — idempotent tenant seed, materializes the graph through
  the **real** bridge over an **RLS-scoped** connection (`SET ROLE authenticated`). 10 actions
  (8 May PRs exercise gathering-data + 2 earlier landmark PRs make the confident path
  reachable, since no May-2025 action can reach 45 post-ship points before END_DATE 2025-05-23).
- `engine/persistence/run_demo.py` — bridge runner over the seeded project.
- `lib/supabase-server.ts` (server-only client, browser-import guard) + `lib/data/*` async
  getters + `lib/data/dashboard.ts` (`loadDashboardData()`, React-`cache` memoized, explicit
  seed mode). Impact cells show a signed number **only** for a confident directional edge;
  withheld/insufficient readouts collapse to "—" — no engine figure is ever fabricated.
- `lib/ingest/*` — fixture-tested, capped, idempotent GitHub → `actions` ingestion (pure core
  + live adapters + CLI, token-gated) with a `(scope_id, external_ref)` unique-index backstop.
- `lib/summary/*` — deterministic honest readout→prose generator + adversarial/regression eval
  harness (golden baseline) + invariant-clamped LLM polish seam (off by default).
- `api/engine.py` + `vercel.json` + root `requirements.txt` — deploy-ready (NOT deployed)
  Vercel Python function wrapping `batch_readout`, shared-secret + input caps, stateless.

### UI iteration (2026-07-09, from live review)

First dogfooding pass over the running app. All changes are seed-mode-visible and thread
through the same `lib/data` → component shapes (DB parity noted in `TODOS.md` P2):
- **Reports tab** (`app/(dashboard)/reports/`, `components/reports/*`) — a new fourth tab. A
  whole-project stakeholder report that rolls up objective + decisions + key metrics + impact
  analysis into one document (and is the summarization that feeds the decision graph). Saved
  reports list + `depth: "full" | "succinct"` (succinct = top movers only). Reuses the honest
  ITS figures + 45-day caveat so a report never overclaims. "Create Report" moved off the
  global header into this tab's "New Report" button.
- **North Star objective** (`components/actions/ObjectivePanel.tsx`) — a purpose document
  pinned above the Actions & Decisions list so the action log reads as bets against a stated
  goal. New `ProjectObjective` type + `seed.projectObjective`; `DashboardData.objective`
  (seed-only, DB path returns null pending an `objectives` row).
- **Aggregated-Impact restructure** (`components/impact/AggregatedImpact.tsx`) — dropped the
  Neutral/Negative tiles; the strip now leads with Metrics-Tracked + Improvement-Rate, then
  the top-4 metrics by magnitude of confident causal lift (from `impactByMetric`).
- **Honesty labels** — the Impact-by-Metric and Aggregated-Impact subtitles no longer claim a
  fabricated "Last 30 Days vs Prior 30 Days"; they say "net confident causal lift (ITS)".
- **Dev-mode flag** — `CAUSENT_USE_SEED=1` in `.env.local` pins the app to the deterministic
  seed dataset for visual iteration (skips the ~7s ECONNREFUSED hang when local Supabase/Docker
  is down). Comment it out to read from a running local Supabase.
- **Deferred** (`TODOS.md` P2): wire inert chrome buttons + cross-links (e.g. Impact actions
  table → the action in the Actions tab); DB-path parity for objective + reports + the trimmed
  aggregated-impact getter.

### Overnight UI + hardening pass (2026-07-10, branch `overnight/ui-polish`)

All verified locally (248 lib tests + 1079 engine tests green, `next build` clean,
live browser QA in both seed and DB modes):
- **Brand logo (FINAL)** — `public/logo.svg` replaced with the FINAL stacked lockup
  (palette `#4285f4`/`#00aaa7`/`#f1c232`); header lockup rebuilt from the real brand
  pieces (`components/shell/Logo.tsx`: dot-grid mark + outlined wordmark); new SVG
  favicon `app/icon.svg` (colored dot cluster on a white tile).
- **Nav wiring** — Impact actions table deep-links to `/actions?selected=<id>`
  (Suspense-wrapped `useSearchParams` seeding); drawer "Add / Layer Metric" →
  `/data-workshop`; account chip → `AccountMenu` dropdown (honest disabled sign-out).
- **Objectives DB parity** — migration `20260710000000_objectives.sql` (workspace-scoped
  north-star doc, metrics-style RLS, explicit grants), `lib/data/objective.ts`,
  seed_demo.py row, RLS-isolation test coverage; `getAggregatedImpact()` trimmed to the
  one improvement-rate figure the redesigned strip reads.
- **Design pass** — ImpactBar round-number axis ticks anchored at 0 (`formatCurrencyTick`);
  2 HIGH mobile fixes (tab-strip/breadcrumb collision; drawer overlap at 375px). Audit
  report: `~/.gstack/projects/adam-causent-causent-ai/designs/design-audit-20260710/`.
- **Ingest hardening (P3)** — within-run external_ref dedup, loud CLI arg validation
  (`lib/ingest/cli-args.ts`), 500-char per-line rationale cap, `server-only` build-time
  guard on `lib/supabase-server.ts` (CLI now needs `--conditions react-server`; noted
  in cli.ts).
- **Deliberately untouched** — the summary layer's golden baseline (formatter change was
  scoped to chart ticks to keep the live-proven guardrail output byte-identical) and the
  seed Gross-Profit generator (would invalidate documented verification figures).

### Approved shell (2026-07-03, still current)

The approved shell (Next 16 + Tailwind v4) was visual-QA'd against the mockups on all three
tabs. Structure (as-built lives at repo root, NOT `/src`):
- `app/(dashboard)/{impact,data-workshop,actions}/page.tsx` + shared `layout.tsx` (persistent
  header + tab strip + Core Metrics drawer); `app/page.tsx` redirects `/` → `/impact`.
- `components/shell` (GlobalHeader, TabStrip, CoreMetricsDrawer, Logo), `components/charts`
  (pure SVG: LineTimeSeries with PR flags, ImpactBar diverging, Sparkline — zero chart deps),
  `components/{impact,data-workshop,actions}`, `components/ui` (Delta = colorblind-safe
  glyph+color+label, Panel, icons).
- `lib/{types,seed,format,derive}.ts`. Brand tokens + single light theme in `app/globals.css`.
- Real brand logo saved at `public/logo.svg` (stacked lockup); header uses a purpose-built
  horizontal lockup (`components/shell/Logo.tsx`).
- Note: `unstable_instant` (Next 16 route hint) was NOT used — it needs `cacheComponents`
  enabled and throws in Client Components. Revisit if enabling Cache Components.

## Prospective layer — as built (2026-07-12, PR #12)

- **Schema** — migration `20260711000000_prospective_layer.sql`: `decisions`,
  `decision_actions(is_lever)`, `predictions` (incl. `resolution_tuple` jsonb = the memory
  tuple priors read), `prediction_revisions` (append-only), `transition_events` (created
  now, WRITTEN only in Tranche 3). RLS via `has_scope_access()` + scope resolvers mirroring
  `metric_scope()`; explicit grants; `actions.source` gained `'jira'`. Isolation gate covers
  all 5 tables.
- **Verdict machine** — `engine/persistence/resolve.py`: maps the lever edge's ITS
  belief-table state to CONFIRMED / DIRECTION_CONFIRMED / REFUTED / INCONCLUSIVE /
  GATHERING (auto-extends `resolution_date` +14d, non-terminal) / UNRESOLVABLE / VOIDED /
  UNATTRIBUTED. Scoring is sign-primary + magnitude-in-CI bonus in NATIVE units:
  `predicted_native = magnitude_pct_mean/100 × the exact ITS pre-window mean` (one
  denominator, no commit-vs-resolution drift; the commit-time native snapshot is
  display-only). Duplicate levers raise `LeverConflictError` before any write. Manual/dev
  runner: `run_resolution.py` (`--today` for the in-the-past demo); cron is Tranche 3.
- **Priors** — pure `lib/priors.ts` (`computePriors`: REFUTED+INCONCLUSIVE included,
  belief-weighted, honest nulls, `hasPrecedent:false` on an empty class) + RLS wrapper
  `lib/data/priors.ts` over terminally-resolved `resolution_tuple`s.
- **UI** — Actions & Decisions tab is decisions-first (`DecisionList`/`DecisionDetail`/
  `PredictionCapture`/`ActionDetail`/`VerdictBadge`; `DecisionEditor` retired; rationale
  lives on the decision). Elicit-not-assert is structural: the magnitude input is never
  pre-filled; the precedent panel only describes. Lever proposal = deterministic
  primary-metric heuristic behind a documented seam (LLM version later, off-by-default like
  lib/summary). Revisions require a logged reason. `/actions` is `force-dynamic` (it
  writes); `?selected=<actionId>` deep-links resolve to the parent decision.
  `Action.shippedAt` is now nullable (unshipped VOIDED lever #8440).
- **Seed** — `seed_demo.py` seeds 6 decisions + predictions and resolves them AS THE USER
  through the real machine: all 6 target verdicts verified live (CONFIRMED lands in-CI at
  13.5% of ARR mean). New actions: churn probe #8290 (INCONCLUSIVE), unshipped #8440
  (VOIDED) → 12 actions total. `lib/seed.ts` mirrors the story (incl. landmarks #8107/#8256,
  which the TS seed previously lacked).

## Cold-Start tranche — as built (2026-07-13, PRs #20 + #21)

- **PR #20 (closes #14, #17)** — `levers` table (multi-lever incl. same-metric via cluster
  overlay; `decision_actions.is_lever` dropped), declared metric on the prediction,
  `UNMEASURABLE_NO_METRIC` verdict, `resolve.py` multi-lever cluster-resolution path +
  ship-span guard, onboarding funnel + `LeverCreate` UI (progresses #15). Migration
  `20260712040728_cold_start_levers.sql`.
- **PR #21 (closes #5, progresses #16)** — invite-only Google-OAuth allowlist
  (`proxy.ts` guard + `lib/auth/*` + `scripts/invite.ts` + migration
  `20260712052812_auth_allowlist.sql`; Next 16 middleware→proxy rename) and the
  create-from-decision GitHub read-only connector spine (`lib/connectors/github*.ts`,
  webhook + reconcile-levers cron routes, deep-link+paste flow). Connector is INERT until
  the live GitHub App + PAT land. Gates green at merge: 1128 pytest, 262 lib tests.
  Evidence: `docs/OVERNIGHT_REPORT_5.md`, QA shots `docs/qa/auth-connector-20260712/`.

## Baseline-drift beat — as built (2026-07-13, PR #22)

- **PR #22 (merged, `26efd3c`)** — the demo showcase from this session's office-hours + CEO/Eng/Design
  reviews. A **change-point detector** (`lib/drift.ts` + `lib/data/drift.ts`) that reuses the engine's
  `segmented_ols`/`step_ci` level-shift fit, scanning the **pre-intervention window only** (so a working
  lever is never mistaken for drift), with a guard (min points + magnitude floor + declared/no-obs →
  "no baseline yet"). A **calm assert-fact `DriftNotice`** on the prediction card — info surface not an
  alarm, NEUTRAL/slate delta (a fact, not a verdict) — and a **stub Restate** over the existing
  `prediction_revisions` table. Seeded on a dedicated **New-User Activation** metric (avoids corrupting a
  core metric's action→metric graph). Gates: 1147 pytest, 269 lib, CI green; Restate DB-verified;
  4 states screenshotted (`docs/screenshots/drift/`). Evidence: `docs/OVERNIGHT_REPORT_6.md`.
- **Not yet live:** the detector runs on SEEDED data (compute-on-read). Live detection needs a real
  connected metric, and the level-shift threshold tuning is a documented open question. The notice +
  Restate are demoable now. Design doc: `~/.gstack/projects/adam-causent-causent-ai/adamowens-main-design-20260712-220650.md`.

## Funnel finish + ship-state/scorecard — as built (2026-07-13, PR #23)

- **PR #23 (closes #15, progresses #18)** — **#15 closed:** Step-1 auth wired into the funnel
  (real Supabase session from #5, `CAUSENT_LOCAL_DEMO=1` dev-session fallback kept), funnel
  instrumentation (`funnel_events` table + `SCORECARD_VIEW` resolution-return signal;
  migration `20260713144706_funnel_events.sql`), and an E2E-under-auth walk. **#18 ungated
  slice:** `components/onboarding/ShipState.tsx` (Step-7 confirmation) + `components/reports/Scorecard.tsx`
  + `lib/scorecard.ts` (predicted-vs-measured, all 7 verdicts incl. `UNMEASURABLE_NO_METRIC`
  connect/self-report prompt + `GATHERING` auto-extend), a `/api/cron/resolve` trigger +
  `vercel.json` cron, and a calm mid-window "still on track" touch. Integrated into
  `DecisionDetail` alongside `DriftNotice` + `MechanismChain`. Gates: engine 1147 (no
  regression), lib 288, tsc/build clean, 9 browse-QA shots (`docs/overnight-7-qa/`).
  Evidence: `docs/OVERNIGHT_REPORT_7.md`.
- **Deferred (gated):** `#18`'s **drift-alert surface** (the `LEVER_DROPPED` assert-fact alert)
  stays behind the mechanism-mapping test + #16 live detection — verified NOT built this run.

## Production deployment — as built (2026-07-16)

- **THE app project is Vercel `causent-ai`** (git-connected to this repo, auto-deploys `main`),
  live at **https://app.causent.ai** (Cloudflare CNAME `app` → Vercel; apex `causent.ai` is the
  separate Astro marketing site). A second Vercel project `causent` (created 7/10 via CLI link)
  is redundant — the repo is re-linked to `causent-ai`; check `.vercel/project.json` before
  `vercel env` commands.
- **Prod env snapshot (causent-ai, 2026-07-16)**: `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`,
  `ANTHROPIC_API_KEY`, `CAUSENT_ENGINE_SECRET`, `CAUSENT_DEMO_TODAY=2025-05-23`,
  `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, and `CRON_SECRET` were recorded. That snapshot omitted
  `SUPABASE_SERVICE_ROLE_KEY`; this is no longer a valid release posture. Provenance-v2 generation
  mints its one-use source receipt through a service-role-only RPC, so the production app must receive
  the key as a server-only secret before this working tree is deployed. Its presence also enables
  other service-role consumers, so webhook/reconciliation behavior must be canaried separately.
  `CAUSENT_LOCAL_DEMO`, `CAUSENT_USE_SEED`, `CAUSENT_DECISION_REPORT_FIXTURE`, and
  `CAUSENT_DECISION_REPORT_LOCAL_ROLLOUT` must all be absent in production.
- **Expanded Slice 10 and the MVP-finish migration are not armed in production.** The stateful recompute function needs the
  session-pooler `DATABASE_URL` and `CAUSENT_RECOMPUTE_SECRET`; `causent-ai` needs the matching
  `CAUSENT_RECOMPUTE_SECRET`, `CAUSENT_RECOMPUTE_URL`, and existing `CRON_SECRET`. The app also
  needs its Supabase URL, anon key, and server-only service-role key. Apply all five 2026-07-23
  migrations (`20260723053444`, `20260723061012`, `20260723061925`, `20260723064500`, and
  `20260723151939`) before deploying either side, then test immediate wake-up and the
  five-minute recovery cron.
- **Cloud Supabase `royftsqyawtyfjolfabd`**: migrations through the 2026-07-16 deployment are
  applied; the local Slice 10 migrations are not. The environment was seeded 2026-07-16 through
  the real bridge (`DATABASE_URL=<session-pooler aws-1-us-east-1, user postgres.<ref>>
  seed_demo.py`, password via `PGPASSWORD` — never in the URL). Seed is teardown-then-reseed
  under the demo-org UUID: safe to re-run, can't touch real users. Invite-only auth live:
  Google provider + Before-User-Created hook (`enforce_allowlist`) + `scripts/invite.ts`
  (service key inline-only). Data API rejects key-only anonymous requests (401) while
  session-authenticated RLS reads work — stricter than default, keep it.
- **Known prod limits**: ~~the resolve cron spawns local Python~~ — **PORTED + DEPLOYED
  (PR #24 merged, `causent-resolve` live)**: the cron HTTP-calls the serverless fn; one env
  step left to fully arm (`DATABASE_URL` on causent-resolve + redeploy both — see run-8 below).
  The drift detector still spawns local Python (same pattern, not yet ported). `/login` is
  publicly reachable and currently
  indexable (no robots.txt — the proxy redirects it; CT logs make the hostname discoverable);
  add `app/robots.ts` + proxy exclusion if stealth matters.

## Current local verification

- Clean local Supabase reset: **PASS**. Error-level schema lint: **PASS**. All five local
  2026-07-23 migrations are included in that reset.
- Serialized Node library/Supabase/RLS/Storage suite: **499 total; 480 passed; 19 intentional
  live-model skips; zero failures**.
- Focused integration verification: **9/9 passed**.
- Complete engine, bridge, isolation, recompute, function, and concurrency suite: **1,204/1,204
  passed**.
- TypeScript and full application lint: **PASS**.
- Next.js `16.2.11` webpack production build: **PASS** after making the workspace/current-report
  dashboard layout explicitly dynamic. `/actions`, `/data-workshop`, `/impact`, `/onboarding`, and
  `/reports` all build as dynamic routes. The post-build `check:dashboard-build` manifest guard also
  passes for Actions, Data Workshop, Impact, and Reports.
- Browser/console acceptance: **PASS**. Blank-first onboarding, explicit Gummy example loading, and
  provider confirmation were verified before generating, saving, and activating Iteration 1. Three
  sequential successors were created and activated through Iteration 4 with `+12%`, `+14%`, and
  `+16%` predictions; each predecessor remained current until its successor activated.
- Reports showed all four iterations with Iteration 4 current and earlier active reports historical.
  The original direct link remained reachable, activated, and read-only. Actions & Decisions showed
  only the current decision/actions/prediction. Data Workshop showed the current metric hint and
  sanitized `queued` recompute state. Impact showed the current report title, one confirmed metric,
  current actions, an honest no-evidence state, and the same sanitized `queued` state.
- `?flow=legacy` restored legacy onboarding. The browser warning/error log was empty. Acceptance
  caught and fixed the static Reports/Impact cache defect with `dynamic = "force-dynamic"` on the
  shared dashboard layout.
- The local recompute worker endpoint was intentionally absent, so server logs recorded only the
  sanitized `not_configured` deferred-kick outcome; source writes remained durable as designed.
- Hosted CI for this working tree: **PENDING**. The expanded workflow is configured, but no cloud
  result is claimed.
- No production migrations, environment changes, deployment, or canary were performed.

## Next (priority order)

### 1. Complete the final deep UI and workflow review

- Review the whole first-run path, Reports iteration controls, Actions & Decisions, Data Workshop,
  Impact, and the manual AI handoff preview as one experience. Capture confusing transitions,
  hierarchy, responsive/accessibility issues, and any place where the product overstates evidence
  or automation.
- Keep the handoff preview powerless during this review: pasted external advice is transient and
  cannot edit reports, complete actions, enqueue recomputation, or establish attribution.

### 2. Collect the missing partner evidence

- Run at least three initially unassisted partner sessions. At least two must pass four of five
  checks: decision accurate, problem accurate, evidence traceable, metric mechanism plausible,
  and next action usable.
- Record facilitator intervention, abandonment, and time to completion. Local automation and the
  product-direction override do not satisfy this demand-validation gate.

### 3. Deliberately activate production

- Require a green hosted run of the expanded CI workflow for the exact release revision.
- Apply `20260723053444`, `20260723061012`, `20260723061925`, `20260723064500`, and
  `20260723151939` to the partner Supabase environment, then rerun schema lint and authenticated
  RLS/Storage/recompute-status probes.
- Deploy the stateful recompute function with `DATABASE_URL` and `CAUSENT_RECOMPUTE_SECRET`; configure
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only
  `SUPABASE_SERVICE_ROLE_KEY`, `CAUSENT_RECOMPUTE_URL`, the matching recompute secret, and
  `CRON_SECRET` on the app. Ensure the demo, seed, fixture, and local-rollout flags are absent. Use
  the stage-tested `scripts/deploy-recompute.sh`; its successful local stage is not a production
  deployment.
- Run one authenticated clean-account canary across URL/PDF generation, save/activate, three
  successors, private-image reattachment, observation import, action completion, recompute status,
  deletion rollback, direct links, and rollout disablement. Preserve the legacy-flow rollback.

### 4. Existing operational and gated work

- Arm `causent-resolve` with its session-pooler `DATABASE_URL`, then redeploy both projects.
- Run the separate zero-code mechanism-mapping test before building the gated webhook
  lever-drift alert.
- Connector automation and Jira/GitHub write credentials remain deliberate operator choices;
  read-only/deep-link paths continue to work.
- Build the authenticated Claude/ChatGPT MCP/API loop only after partner review. That later work
  needs scoped authentication, explicit tool contracts, reviewed writes, and durable attribution;
  the current manual copy/paste preview is not live synchronization.
- OCR, URL crawling, multiple documents, authenticated-page ingestion, lower statistical floors,
  conversational delivery, richer revision/export UI, and numeric Completion Outlook remain gated.

## Open risks / TODO

- ~~CI's first cloud run not yet confirmed green~~ — **RESOLVED 2026-07-09 (PR #3).** The first
  cloud run was red, but not for the Python-version reason guessed here. Two causes, both fixed:
  (a) the schema relied on Supabase's *implicit* default privileges — `setup-cli@latest` in CI
  doesn't grant them to user-migration tables, so every RLS/bridge test hit `permission denied`;
  fixed by an explicit-GRANT migration (`20260709000000_grant_base_privileges.sql`). (b) two
  engine adversarial tests flipped on ~1e-14 float dust from zero-residual fits (nondeterministic
  across BLAS/numpy builds); fixed with a scale-relative dead-zone in the direction/placebo
  classifiers. CI now green (engine + RLS + bridge, 3m28s).
- `owner` role enforced server-side (no DB policy depends on it); hierarchy creation is
  service_role-only — see `supabase/SCHEMA_REPORT.md` residual risk.
- `nodes.semantic_ref` is polymorphic (no FK) — app-enforced integrity.
- The BEFORE_AFTER descriptive stat and the batch action-count cap exist; wire connectors
  (Postgres/BigQuery) later per the PRD (CSV-first).

## Document map

- `docs/designs/did-it-ship-did-it-work.md` — the PRD / v1 build plan (+ review report).
- `docs/designs/decision-graph.md` — the causal-graph data model + belief rules + roadmap (core asset).
- `docs/designs/security-and-auth.md` — auth, RBAC, RLS, threat model, secrets.
- `docs/designs/ai-assisted-decision-report.md` — approved active onboarding/product plan.
- `engine/OVERNIGHT_REPORT.md` — the engine build + honesty-fix + bridge build history.
- `supabase/SCHEMA_REPORT.md` — schema/RLS report + residual risk.

## Housekeeping

- OpenAI API key **rotated 2026-07-03** (old leaked key revoked; new key in `~/.gstack/openai.json`, 600, outside git).
- Local Supabase (Docker) may still be running; `supabase stop` to shut it down.
