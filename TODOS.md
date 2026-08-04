# Causent active backlog

Last reconciled: 2026-08-03. Completed historical work is documented in `docs/STATUS.md` and the overnight reports. This file contains only active or deliberately deferred work.

PR #28 merged the Slice 8/9 baseline into `main` on 2026-08-03. Slice 10 and the bounded MVP
expansions are packaged separately on `codex/decision-report-slice-10` in draft PR #29; hosted CI,
partner evidence, partner-environment migration/configuration, deployment, and canary work remain
open below.

## P0 — AI-assisted Decision Report partner wedge

Approved design: `docs/designs/ai-assisted-decision-report.md`.

### Completed Slice 10 — explicit report iteration series and current-report boundary

- [x] Backfill reports into explicit linear series with one current-active pointer, iteration numbers, predecessors, and successor reasons.
- [x] Add checked, locked, idempotent successor start that preserves logical IDs while stripping private asset IDs.
- [x] Advance the pointer atomically with activation while preserving all prior canonical and audit rows.
- [x] Add a database-owned workspace series pointer and select report-native dashboard data only through that explicit current identity; group Reports by series.
- [x] Reuse the editor/activation/image paths and support safe same-series removal rollback.
- [x] Fail closed when onboarding targets a missing workspace instead of surfacing the `decision_report_series_scope_id_fkey` implementation detail; remove silent seed-data fallback on database errors.
- [x] Guard pointer, activation, action-completion, and primary-lever transitions with private one-use transaction capabilities rather than caller-forgeable state.

Implementation proceeded before the Slice 9 partner-session gate by explicit user authorization. The three initially unassisted sessions remain a human release gate and are not marked complete.

### Completed MVP expansion — bounded URL/PDF sources and provenance v2

- [x] Accept at most one public HTTPS page and one text-based PDF alongside the bounded project brief.
- [x] Bound URL retrieval by public-only DNS/IP checks, DNS pinning, redirect revalidation, response type/encoding, 1 MiB, three redirects, and a 10-second timeout. Retain no credentials, cookies, query string, fragment, or response bytes.
- [x] Bound PDF extraction to one 5 MiB, 40-page, text-based PDF in a 12-second, resource-limited worker; reject encryption, active content, embedded files, malformed input, and image-only scans. No OCR or crawling was added.
- [x] Persist report schema v2 source summaries as bounded chunks with text, locators, SHA-256 digests, and claim-to-chunk references. A private 24-hour, one-use server-minted receipt binds scope, actor, exact source summaries, and the sourced-claim multiset to the first save; exact lost-ack retries reuse it, changed retries conflict, and later revisions freeze the corpus while allowing sourced claims only to remain or be removed. Rehashed forged corpora fail closed; source-free reports with no sourced claims do not require a receipt. Historical v1 snapshots remain readable.
- [x] Require a legacy-derived successor to be explicitly saved as provenance v2 before activation. Private image IDs and Storage paths remain report-bound and are never copied to a successor.

### Completed MVP expansion — automatic current-report causal recomputation

- [x] Require one selected report action as the primary manual lever during v2 activation and enqueue recomputation after activation, current-report metric observation changes, and primary-action completion.
- [x] Coalesce work by immutable activation in a private generation-counted queue; exact unchanged inputs produce no duplicate graph writes and failures retry with bounded backoff.
- [x] Re-resolve and lock report → series → workspace → activation in the worker before graph materialization so historical or superseded iterations cannot receive new causal output.
- [x] Compute the full eligible workspace hypothesis family for BH-FDR while persisting only the explicit current activation's action/metric graph. The 45-day-per-side causal confidence floor remains unchanged.
- [x] Keep source writes durable when the immediate worker wake-up is unavailable; the five-minute authenticated cron is the recovery path.
- [x] Add a network-free `scripts/deploy-recompute.sh --stage-only` path plus `api/DEPLOY.md` and `.vercelignore`; the 18-file Python 3.12 stage pins exact NumPy/psycopg versions and a 300-second function limit. Nine recompute-function tests pass. Nothing was linked or deployed.

### Completed MVP loop preview — manual AI copy/paste

- [x] Add a current-report-only **Manual AI handoff preview** to Actions & Decisions. A user can copy one bounded, deterministic, redacted context packet for Claude or ChatGPT and paste the matching structured review back into Causent.
- [x] Keep the handoff advisory and transient: copy is an explicit browser action, private/organization/unknown data requires a second confirmation, pasted JSON is strictly bounded and rendered as plain text, and refresh/navigation clears it.
- [x] Exclude workspace/report/revision/canonical IDs, source and receipt content, private asset identities and paths, raw observations, credentials, and unrelated report data. A context fingerprint detects stale paste-back but is not authentication.
- [x] Give the preview no write path. It cannot edit a report, complete an action, enqueue recomputation, attribute a PR, or claim that Claude/ChatGPT is connected to Causent.

The authenticated MCP/API loop, provider OAuth, automatic context delivery, trusted write tools,
and PR/artifact attribution remain deferred until after the partner review. The manual preview is a
prop for testing whether that future loop is understandable and useful; it is not a partial MCP.

### Completed MVP finish — consent, observability, recovery, and release guardrails

- [x] Start Decision Report onboarding blank. The Gummy Alpha fixture is now an explicit **Load example** action rather than an implicit user input.
- [x] Require an explicit source-egress confirmation before generation and clear it whenever the brief, URL, or PDF changes. The confirmation names the project brief and extracted URL/PDF text that may be sent to the configured AI provider; a provider or network failure preserves the user's inputs and editable fallback.
- [x] Instrument the report lifecycle with content-free, best-effort events for landing, generation start/editable/failure, save/failure, and activation/failure. Payloads accept only a server-minted opaque session key, elapsed time, bounded edit/follow-up/missing-field counts, source/fallback/retry booleans, and no report, prompt, source, asset, or clipboard content. The aggregate reports distinct-session stages/drop-off, median time to editable/save/activation, median edit/follow-up counts, and failure events plus affected sessions.
- [x] Enforce a future prediction resolution date in the browser, the shared runtime validator, and a database trigger using the UTC statement date.
- [x] Expose only the explicit current report's sanitized causal-recompute state (`idle`, `queued`, `retrying`, `failed`, or `current`) and safe timestamps in Data Workshop and Impact. The private queue, errors, attempts, hashes, and identities remain ungranted.
- [x] Add retry-oriented route recovery boundaries for the app, onboarding, and Data Workshop; failures state which durable data was not changed and keep navigation back to Reports available.
- [x] Pin Node `22.23.0`, add network-free app/worker release-config checks, and fail closed with a no-store `503` when a production app is missing its Supabase URL, anon key, or server-only service-role key, or retains a local-only flag. The service-role key is required because provenance receipt minting is intentionally unavailable to ordinary authenticated callers.
- [x] Expand the local CI contract to run TypeScript, full lint, the serialized Node/Supabase/RLS/Storage suite, schema lint, the complete engine/bridge suite, recompute bundle staging, a Next.js 16 webpack build, and a post-build dashboard-manifest guard on pinned Node/Python/Supabase versions. Explicitly revoke `UPDATE`, `DELETE`, and `TRUNCATE` capability from Decision Report lifecycle telemetry by granting authenticated users only `SELECT` and `INSERT`.
- [x] Keep the shared dashboard layout request-bound with `dynamic = "force-dynamic"`; production builds cannot freeze a seed or pre-activation snapshot into Reports, Actions & Decisions, Data Workshop, Impact, or the Core Metrics drawer.
- [x] Pass the Next.js 16.2.11 webpack build with all five product routes dynamic and pass `check:dashboard-build`, which asserts that Actions, Data Workshop, Impact, and Reports exist but are absent from the prerender manifest. Then browser-activate the initial report plus three sequential successors through Iteration 4. Verify predecessor/current semantics, four-item Reports lineage, historical direct-link read-only access, current isolation across all three operational tabs, sanitized queued recompute state, legacy-flow rollback, and an empty browser warning/error log.

### Remaining MVP release gates — human/operator work

- [ ] Require a green expanded hosted-CI run for the exact Slice 10 review revision. The workflow is configured, but no successful hosted run of that revision is claimed yet.
- [ ] Complete one final deep review of the end-to-end UI experience and workflow, including the manual handoff preview, before declaring the MVP interaction complete.
- [ ] Run at least three initially unassisted partner sessions; require at least two to pass four of five checks: decision accurate, problem accurate, evidence traceable, metric mechanism plausible, next action usable.
- [ ] After applying the migrations and runtime configuration to the partner environment, run one authenticated clean-account acceptance pass including one URL, one text-based PDF, three successor activations, direct historical links, private-image reattachment, deletion rollback, and rollout-flag rollback. Local engineering acceptance does not replace partner evidence.
- [ ] Apply `20260723053444`, `20260723061012`, `20260723061925`, `20260723064500`, and `20260723151939` to the partner environment. Configure the app's Supabase URL, anon key, server-only service-role key, recompute URL/secret, and cron secret; configure the worker's session-pooler `DATABASE_URL` and matching recompute secret; ensure all four local-only flags are absent. Then deploy deliberately and run migration/RLS/Storage/recompute canaries. No production deployment is claimed by this run.

### Completed Slice 1 — interaction prototype

- [x] Lock the versioned `DecisionReportV1` schema, five claim/provenance states, runtime validation, and the three-action ceiling.
- [x] Add the Gummy Alpha golden prompt, complete three-section report, metric hypothesis, 40% illustrative baseline, and 55% founder prediction.
- [x] Replace `/onboarding` with the deterministic prompt-to-report flow while retaining the legacy funnel code for rollback.
- [x] Build compact focused editors for Decision, Supporting Evidence, Implementation, actions, owners, governance, and visible missing fields.
- [x] Add contract tests for the golden fixture, sourced-claim requirements, missing-claim honesty, and action cardinality.

### Completed Slice 2 — live report generation

- [x] Define a model-output DTO that contains content and evidence excerpts but no trusted claim or action IDs.
- [x] Generate and validate the three prescribed sections from arbitrary bounded prompt text through a server-only Vercel AI Gateway seam.
- [x] Assign immutable claim/action IDs server-side and accept a sourced claim only when its evidence excerpt matches the supplied prompt.
- [x] Reject unsupported numeric claims and leave owners, customers, stakeholders, governance, and metric values missing unless sourced.
- [x] Preserve the deterministic Gummy Alpha fixture as an explicit development mode and provider-failure fallback; preserve arbitrary briefs in a safe partial fallback.
- [x] Add timeout, refusal, malformed-output, unsupported-claim, and retry-once tests.
- [x] Live-validate the Gummy Alpha prompt through `anthropic/claude-sonnet-5`: one attempt,
  24,412 ms, 4,309 input tokens, 2,967 output tokens, 7,276 total tokens, and six actions.
  Provider-wrapped structured output is normalized only when the recovered report passes the
  complete runtime contract. This was the pre-optimization six-action baseline.

### MVP latency reduction

- [x] Cap the report at three supporting proof claims and three actions.
- [x] Remove Alternatives, Relevant Precedent, and Estimated Cost from the MVP report and model contract.
- [x] Return `null`/`[]` for unknown model values, then materialize explicit editable `missing` states server-side.
- [x] Reduce the output ceiling from 4,500 to 2,200 tokens while preserving the safe fallback.
- [x] Re-run the live Gummy Alpha benchmark against the reduced contract: one attempt,
  13,852 ms, 3,873 input tokens, 1,598 output tokens, 5,471 total tokens, three proof claims,
  and three actions. Unsupplied customers, stakeholders, and data sources materialized as
  explicit `missing` states.

### Completed Slice 3 — focused gap completion and typed edits

Goal: help the user finish the partial report without adding chat infrastructure or another model call.

- [x] Add a pure `scanDecisionReportGaps(report)` function with stable priority: Decision, Problem, at least one proof claim, Core Metric mechanism, Action Plan summary, then at least one action.
- [x] Define the smallest `ReportEditCommandV1` reducer used by both direct field edits and focused answers. Commands may replace/confirm claim text, edit action title/summary/owner, add an action up to the three-action ceiling, and set data classification.
- [x] Render a compact “Complete this report” panel with at most three open questions and focus the corresponding report field when selected.
- [x] Mark user answers `user_confirmed`, preserve immutable claim/action IDs, and recompute gaps locally without another AI request.
- [x] Replace the inert final-review behavior with an explicit ready/not-ready state. Optional customers, stakeholders, owner, governance, and mock-up fields do not block readiness.
- [x] Add unit tests for gap ordering, optional missing fields, command validation, the three-action ceiling, ID preservation, direct-edit/question parity, and completing the safe fallback to ready.
- [x] Browser-review the live Gummy Alpha report and the ready-state transition. The review caught and fixed a contradiction where optional owners, customers, and stakeholders appeared required beside a “Decision Report ready” message.
- [x] Complete the sparse safe-fallback and keyboard-focus browser pass. Slice 9 verified exact-field focus, sequential Tab order, and report readiness without another model request.

Acceptance: the safe fallback can be completed into a report-ready draft; the Gummy Alpha report is already ready or names only real required gaps; direct editing and answering a focused question produce the same validated report state.

Non-goals: report persistence, refresh/Back recovery, general chatbot/history, metric or CSV handoff, uploads, final graph materialization, and connector work.

### Completed Slice 4 — durable report revisions and approval boundary

Goal: make the reviewed Decision Report durable and retry-safe without prematurely writing the canonical decision graph.

- [x] Add `decision_reports` and `decision_report_revisions` with scope-bound RLS and explicit grants. Revisions are append-only full `DecisionReportV1` snapshots with author, timestamp, base revision, and a database-owned deterministic content hash.
- [x] Add injected-client repository functions to create a report, append a revision, and load its current revision. Identical saves reuse the existing revision; a stale base revision returns an immediate HTTP 409 conflict with the current revision ID.
- [x] Bind generation and persistence server actions to the authenticated session and scope, then validate all client payloads at runtime. Save only on explicit user action; no per-keystroke autosave was added.
- [x] Add `Saved`/`Unsaved` UI state and explicit **Save draft**, **Save report**, and **Save changes** actions. The stable `?report=<id>` route reloads the exact report snapshot and metric projection.
- [x] Define and validate a pure, inert `ReportActivationInputV1` containing the report/revision IDs, confirmed metric ID, human prediction fields, and one to three selected action source-item IDs.
- [x] Integration-test cross-workspace denial, read-only report tables, append-only revisions, identical-save idempotency, stale-revision conflicts, schema/readiness rejection, exact reload, and zero canonical graph writes.

Acceptance: a ready Gummy Alpha report persists once; an identical retry creates no revision; one real edit creates one revision; another workspace cannot read or write it; reload restores the same report; and the slice creates zero `decisions`, `predictions`, `actions`, `decision_actions`, or `levers`.

Verification: the live local Supabase repository test passes both cases in roughly 250 ms; the RLS isolation suite passes 19/19; TypeScript, targeted lint, all 368 library tests, the Supabase schema linter, and the webpack production build pass. Manual UI acceptance remains part of the partner pass.

Non-goals: sources/assets/uploads, Data Workshop or CSV handoff, human-prediction UI, canonical materialization, connectors, and per-keystroke autosave.

### Completed Slice 5 — reviewed-report activation bridge

Goal: let one saved Decision Report produce several canonical assets without allowing duplicate or partial graph writes.

- [x] Add a three-part activation panel for real metric confirmation, a blank human prediction commitment, and selection of one to three generated actions.
- [x] Keep the illustrative metric chart separate from the commitment: it never pre-fills direction, magnitude, resolution date, or metric observations.
- [x] Add `decision_report_activations` as a scope-bound, read-only audit table and add the `active` report state plus canonical identity pointers.
- [x] Add one checked `activate_decision_report_v1` transaction that validates the exact reviewed revision, workspace metric, human prediction, and selected source-item IDs before creating one decision, one prediction, planned manual actions, and decision-action links.
- [x] Make exact retries return the same activation/decision/prediction/action IDs; return an immediate HTTP 409 when a retry changes the activation inputs.
- [x] Lock active reports against later revision saves. Activation failures leave the complete `report_ready` revision intact with zero partial canonical rows.
- [x] Hand off to `/actions?selected=<decision_id>` and render report-created actions with collision-free UUID identities plus a `Planned` reference instead of a fake GitHub PR number.
- [x] Keep lever creation, tracker tickets, causal edges, evidence, and impact claims outside activation.
- [x] Verify live atomic creation, exact retry reuse, changed-retry conflict, invalid-action rollback, cross-workspace metric rejection, zero levers, active-report reload, and edit locking. Expand the authenticated RLS gate to 22 passing cases.

Acceptance: a saved reviewed Gummy Alpha report requires explicit human metric/prediction/action choices; activation creates the intended canonical rows exactly once; retry and failure paths create no duplicates or partial plan; the user lands on the selected decision in Actions & Decisions.

Non-goals: metric creation, CSV ingestion, source/assets/uploads, connectors, tracker ticket creation, lever selection, causal impact, Completion Outlook, and per-keystroke autosave.

### Completed Slice 6 — report-native dashboard isolation and connector handoff

Goal: make an activated Decision Report the visible project boundary throughout the dashboard and continue its plan into the existing tracker workflow.

- [x] Load durable Decision Reports and current revisions into the dashboard through runtime validation.
- [x] Use the newest activated report's canonical decision, selected actions, and confirmed metric as the shared dataset for Core Metrics, Data Workshop, Actions & Decisions, and Impact.
- [x] Suppress workspace-wide objectives, metrics, actions, impact aggregates, and legacy report fixtures once the report project boundary is active.
- [x] Index saved Decision Reports in Reports with a compact native preview and stable link back to the full report.
- [x] Carry the existing Jira/GitHub create, read-only deep-link, and paste-attribution UI into a report-origin decision until a lever is linked.
- [x] Preserve the complete legacy dashboard for workspaces without an activated Decision Report.
- [x] Add pure regression coverage for report isolation and run TypeScript, focused lint, all 384 library tests, diff checks, and the webpack production build.

Acceptance: after report activation, no deterministic study metric, objective, action, impact aggregate, or stakeholder-report fixture appears in the report project; the confirmed metric and selected planned actions remain visible across tabs; Reports shows the saved Decision Report; and Actions & Decisions offers the established GitHub/Jira lever flow.

### Completed Slice 7 — report-native metric CSV ingestion

Goal: turn the activated report's confirmed metric into a real daily series without opening an arbitrary metric-write surface.

- [x] Replace the inert Data Workshop control with one-file `.csv` upload, drag/drop, pending, actionable error, and complete success-summary states.
- [x] Parse bounded UTF-8 bytes on the server under an exact `date,value` daily contract; reject malformed headers, invalid dates/numbers, padded or quoted ambiguity, duplicates, binary/invalid encoding, more than 10,000 rows, and files above 256 KB. Any rejected row aborts the whole import.
- [x] Derive the newest active report and confirmed metric from the authenticated workspace rather than accepting IDs from the browser.
- [x] Add one checked database RPC that revalidates the scope/report/metric tuple, member access, daily granularity, and declared/CSV source under row locks before an atomic primary-key upsert.
- [x] Define duplicate-date behavior explicitly: duplicates inside one file reject the import; a date already stored for this same metric is updated; dates not present in the file remain unchanged. Exact retries create no duplicate observations.
- [x] Refresh Data Workshop and the shared dashboard layout after success so the report-native Core Metrics series is immediately visible, including metric names outside the legacy demo catalog.
- [x] Cover parser edge cases, repository mapping, retry/idempotency, forged IDs, cross-workspace denial, member/viewer authorization, and real local Supabase writes.

Acceptance: a signed-in member can upload one valid daily CSV only into the activated report's confirmed workspace metric, immediately see the real series and row count, retry safely, and understand exactly what was inserted or updated; malformed or foreign-target attempts write nothing.

Non-goals: warehouse connectors, spreadsheet formats, file storage, background jobs, causal recomputation, arbitrary metric selection, and replacement of observations on dates absent from the uploaded file.

### Completed follow-up — workspace core-metric catalog import

Goal: make a newly supplied metric a durable workspace option before a Decision Report is activated, without weakening the active-report project boundary.

- [x] Add a separate named-metric CSV flow with explicit metric name and supported unit (`percent`, `count`, or `USD`).
- [x] Create or reuse a scope-bound daily CSV metric and atomically upsert observations through a checked workspace-row-locked RPC.
- [x] Render all workspace metrics in a labeled catalog and feed the same catalog into the report activation selector.
- [x] Consolidate Data Workshop to one named uploader; catalog selection pre-fills activation and the activated metric drives the bottom Core Metrics drawer.
- [x] Keep active reports isolated to their confirmed metric; workspace catalog availability is shown separately and does not widen the report project view.
- [x] Cover repository validation, creation/retry idempotency, missing-workspace denial, catalog observation state, TypeScript, focused lint, full library tests, schema lint, and webpack build.

Acceptance: a member can name and import an adoption-rate or visits CSV, see the created metric in the workspace catalog, and select it when activating a new report; re-imports update matching dates without duplicates and active reports remain unchanged.

Non-goals: changing an already-active report's metric, multi-metric active-report isolation, warehouse connectors, causal recomputation, or background ingestion jobs.

### Completed Slice 8 — private supplied-image path

- [x] Accept one PNG/JPEG only on a durable editable report; enforce 5 MiB input, 4096×4096, and 16 MP caps before persistence.
- [x] Verify real signatures and exact file boundaries, fully decode with Sharp, reject malformed/truncated/trailing-data, animated, ambiguous, unsupported-color, and oversized inputs, then deterministically re-encode without metadata.
- [x] Store only the sanitized derivative in the private `decision-report-assets` bucket under a server-owned unguessable path; never expose a service key, bucket, object path, filename, or original bytes.
- [x] Bind asset metadata to workspace, report, and current revision; require member access for upload/read/remove; reject viewer, stale, cross-workspace, active-report, and arbitrary-asset promotion attempts.
- [x] Attach/replace/remove through append-only report revisions. Replacement attaches the new object before retiring the old one; failed cleanup retains detached metadata for a safe later retry rather than orphaning invisible bytes.
- [x] Render saved-report upload, processing, actionable failure, private preview, replace, remove, reload, and active-lock states while preserving the explicit no-image state.
- [x] Verify pure sanitization, local Storage integration, exact reload, replacement/removal, forged IDs, RLS isolation, schema lint, browser success/failure paths, and server-side active-lock behavior.

Acceptance: a signed-in member can attach one sanitized private image to the exact current report revision, reload its authenticated preview, replace or remove it safely, and see actionable format/size/dimension failures; activation preserves the preview and locks mutation.

Non-goals: originals, multiple files, public buckets, OCR, extraction, PDFs, URL fetching, generated mock-ups, shared assets, background media processing, and general file management.

### Completed partner-feedback follow-up — metric selection and report action workspace

- [x] Remove the active-report banner and every redundant **Add / Layer Metric** control from Data Workshop and the persistent drawer.
- [x] Render one **Workspace Metrics** table with an Origin column and a single green Add control; selection stays on the current page and never restarts onboarding.
- [x] Persist up to five scope-bound core metrics through a checked, workspace-locked RPC; expose the same multi-select in onboarding while retaining one explicit prediction metric for report activation.
- [x] Render selected metrics across dashboard tabs and the bottom drawer without widening the active report's decision, action, prediction, or impact boundary.
- [x] Add a working trash control for removable core metrics; the active report's required metric remains labeled and locked unless it is also independently selected.
- [x] Replace the report-native Actions & Decisions split view with a full-width Decision Summary and expandable action rows containing work-item reference, completion state, details, owner, and governance.
- [x] Explain the actual GitHub/Jira connection contract in-product: account OAuth is not available; configured workspace credentials can create tickets, while prefilled links plus pasted issue URLs work without write access and webhooks monitor attributed work.
- [x] Add checked manual completion for report-created manual actions, including completion date and explanation, with idempotency, same-workspace validation, member authorization, and viewer/cross-tenant denial.

Acceptance: metric add/remove is an in-place operation; multiple dashboard metrics can be selected without changing the active report; Actions & Decisions opens on the report summary rather than an empty navigation column; and a member can complete a planned report action without a GitHub push while the audit detail survives reload.

Non-goals: account-level GitHub/Atlassian OAuth, warehouse connectors, changing an active report's confirmed prediction metric, connector reconciliation credentials, or causal recomputation.

### Completed partner-feedback follow-up — report history and metric-chart controls

- [x] Add a confirmed Delete report control to the Decision Reports index for draft, ready, and activated reports.
- [x] Soft-delete reports through a member-only, workspace-checked, retry-safe RPC; hide report revisions/assets from authenticated reads while retaining canonical decision/action audit rows and private bytes for recoverable cleanup.
- [x] Prevent removed report-native graph rows from resurfacing through the legacy fallback; deleting the newest active report selects the next live report, and deleting the last one leaves only genuine legacy work visible.
- [x] Number visible decisions/actions deterministically as `D1A1`, `D1A2`, and so on, using durable report action order rather than database join order.
- [x] Render the identifier in each action header and Core Metrics flag; link each flag to the matching expanded action on Actions & Decisions.
- [x] Replace the inert drawer labels with 30/60/90/all-data range selection and Daily/Weekly cadence controls, including calendar-day filtering, weekly averages, dynamic date labels, and in-window action flags.

Acceptance: a member can remove any old Decision Report from visible workspace history without erasing audit rows; action flags are unique and navigable; changing either chart control visibly changes the plotted series while the report-native boundary and legacy fallback remain isolated.

Non-goals: hard deletion or restoration UI, physical asset garbage collection, arbitrary custom date entry, monthly aggregation, changing the active report metric, or deleting canonical decision/action audit history.

### Completed partner-feedback follow-up — preliminary impact visibility

- [x] Load both authoritative ITS and `BEFORE_AFTER_14D` evidence for report-native action/metric edges.
- [x] Keep the 45-day-per-side causal confidence floor intact while rendering the shorter-history mean shift as a plainly labeled preliminary descriptive readout.
- [x] Normalize ratio-form percent metrics to percentage points, preserve unknown causal belief, and disclose overlapping actions instead of implying isolated attribution.
- [x] Regression-test short-history rendering and live-check the Impact table with the imported Gummy Alpha series.

Acceptance: completing a report action with at least 14 days of observations on each side can show a non-blank descriptive cross-check without upgrading it into a causal estimate; the confident aggregate remains gated by ITS evidence and its 45-day-per-side floor.

Non-goals: automatic engine execution after import/completion, lowering the ITS confidence floor, or attributing an overlapping before/after shift to one action.

### Implemented Slice 9 — partner rollout and clean-account acceptance; partner evidence pending

Goal: expose the completed Decision Report journey to controlled partner accounts and prove that a new user can finish it without manual recovery.

- [x] Add an operator-managed per-user rollout assignment for new Decision Report starts. Unassigned users fail closed to legacy; `?flow=legacy` pins an in-progress legacy session across refresh/Back and later enablement.
- [x] Define and verify rollback: disabling an assignment redirects new and unsaved Decision Report starts to legacy, while direct `?report=<id>` links continue loading durable draft, ready, and active reports unchanged.
- [x] Run the local clean-state browser matrix across live generation, deterministic fallback, direct edits and focused questions, save/reload, browser Back, supplied-image success/failure, named metric import and selection, activation, manual completion, honest no-evidence Impact, and flag rollback. Retry/idempotency and preliminary descriptive evidence remain covered by their existing integration/regression gates rather than duplicated in the browser.
- [x] Finish the sparse safe-fallback and keyboard-focus checks left from Slice 3. “Edit in report” focuses the exact missing textarea; Tab order continues through editable controls; focused answers reach ready without another model call.
- [x] Add nine Decision Report-specific unsupported-claim scenarios. Fabricated decision, background, problem, proof, mechanism, action summary, owner, customer, and stakeholder evidence cannot become `sourced`.
- [x] Retain the report/asset RLS, Storage, revision, activation, metric, manual-completion, and soft-delete gates. Slice 9 verification passed 24 focused TypeScript/Supabase integration cases and 41 combined primary/adversarial RLS cases.
- [ ] Run at least three initially unassisted partner sessions; require at least two to pass four of five checks: decision accurate, problem accurate, evidence traceable, metric mechanism plausible, next action usable.

Acceptance status: the controlled rollout, rollback, durable-report survival, and local clean-state journey are verified. The product release gate remains open until three real initially unassisted partner sessions are recorded; automated or facilitator-driven runs do not substitute for that evidence.

Slice 9 non-goals: lever-flow redesign, account-level GitHub/Atlassian OAuth, warehouse connectors, automatic causal recomputation, a lower causal confidence floor, hard report deletion/restoration, autosave, revision-history/export UI, URL/PDF ingestion, OCR, or conversational delivery.

Later Slice 10 MVP-expansion work implements the bounded URL/PDF and automatic recomputation items without changing the remaining Slice 9 release gate.

Already complete and not Slice 9 work: schema/provenance/gap/edit unit coverage, explicit durable save/reload, retry-safe activation, report-native isolation, private image handling, named CSV metrics, multi-metric selection, manual action completion, report soft deletion, action coordinates/deep links, chart controls, and preliminary descriptive impact rendering.

## P1 — Existing production operations

- Arm `causent-resolve`: set the Supabase session-pooler `DATABASE_URL` on the `causent-resolve` Vercel project, then redeploy `causent-resolve` and `causent-ai`.
- Deploy and arm the causal recompute worker with the Supabase session-pooler `DATABASE_URL` and `CAUSENT_RECOMPUTE_SECRET`; set `CAUSENT_RECOMPUTE_URL`, the matching `CAUSENT_RECOMPUTE_SECRET`, and `CRON_SECRET` on `causent-ai`, then verify the five-minute cron and immediate wake-up paths.
- Configure `SUPABASE_SERVICE_ROLE_KEY` as a server-only production app secret before releasing provenance-v2 generation; the source-receipt mint RPC requires it and ordinary authenticated clients cannot call that RPC. Never expose the key to the browser.
- Decide separately whether to enable automated connector reconciliation and canary its webhook/cron consumers after the service-role key is present. Paste attribution remains available without connector write automation.
- If Jira automation is needed, configure `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_WEBHOOK_SECRET`, and the Jira webhook.
- If GitHub issue auto-create is needed, configure a write-scoped `GITHUB_WRITE_TOKEN`; the existing token is read-only.
- Add `app/robots.ts` and the appropriate proxy behavior if `/login` should not be indexed.

## P1 — Product validation outside the Decision Report

- Run the existing zero-code mechanism-mapping test with the design partner before building the webhook-driven `LEVER_DROPPED` drift-alert surface.
- Use the seeded baseline-drift beat as the prop and capture whether the partner recognizes the event, how often it occurs, and what notification would change behavior.

## Remaining conditional production ramp

Only begin these after the Decision Report partner gate passes:

- Authenticated Causent MCP/API tools for Claude and ChatGPT, including scoped OAuth, automatic context delivery, reviewed mutation commands, and durable PR/artifact attribution. The MVP manual copy/paste preview must not be mistaken for this connection.
- Malware scanning/quarantine for broader file types.
- OCR for scanned PDFs, multi-document upload, URL crawling, authenticated pages, and broader ingestion.
- Conversational delivery as another client of the report schema, gap scanner, and typed commands.
- Richer revision/reapproval workflows for editing active reports.
- Model routing, extraction caching, or selective model tiers after measured cost/latency evidence.
- Numeric Completion Outlook after defining auditable inputs and calibration.
- Automated governance enforcement.

## P2 — Existing architecture and UX debt

- Replace remaining demo service-role dashboard reads with per-request `@supabase/ssr` RLS clients where live freshness is required.
- Add revision-history and export surfaces only if report-index partner use calls for them.
- Finish inert destinations only when their flows exist: New Project, Settings, and account-level credentialed connector controls.
- Make `LineTimeSeries` x-axis tick density viewport-aware.
- Increase mobile header touch targets if mobile becomes a supported primary surface.
- Tune the demo Gross Profit generator only if changing the documented verification baseline is worthwhile.

## P3 — Deferred scale work

- Full-history GitHub backfill worker with resumable cursors and rate-limit backoff.
- Warehouse connectors such as Postgres/BigQuery after a real partner request.
- Graph-scale policies for thousands of actions and edges.
