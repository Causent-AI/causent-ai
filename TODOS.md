# Causent active backlog

Last reconciled: 2026-08-19. Active and deliberately deferred work appears first; the dated
completed-slice checklists below are retained as point-in-time implementation history.

PR #29 merged Slice 10 and the bounded MVP expansions into `main` as `690e196` on 2026-08-03 local
time with the hosted app/engine/RLS/bridge gate green. Review rounds 1 and 2, the completed-loop
Northstar example, and the founder-selected UX follow-up have a recorded passing checkpoint. The
current working tree adds a later product/science/engineering hardening round that materially changes
the application, engine, and database. The exact local reset, full application/engine tests,
production build, deterministic query-plan/scale checks, and desktop/mobile browser acceptance passed
through migration 42. The refreshed gate includes a full local reset, 8/8 worker-role tests, 671
credentialed Node tests (652 passed, 19 intentional live-model skips, zero failures), 1,290/1,290
engine/bridge/isolation tests, and local error-level schema lint. The clone rehearsal and phased
production schema apply through 42 pass. The fixed app and all three workers are live. One controlled
authenticated report loop, three-successor cleanup rollback, direct-link behavior, and current-report
tab continuity pass; hosted CI run `32287053300` is green for `85860dc`. Protected staging load,
representative-volume evidence, private-image and provider-connector production canaries, terminal
resolution, founder sign-off, and partner evidence remain open below.

## Production schema activation and release rehearsal — 2026-08-18/19

- [x] Authenticate the Supabase CLI, inspect the production migration baseline, and rehearse the
  complete pending set on an isolated persistent with-data branch. Phased history advanced
  `11 -> 31 -> 37 -> 38 -> 39 -> 40 -> 41`; eight online indexes were ready/live/valid; the bounded
  multi-metric drain processed zero rows on this clone; all 17 target constraints validated; final
  dry-run was empty; and error-level lint plus focused RLS/security/Storage metadata assertions passed.
- [x] Add `20260819044116_harden_security_definer_function_acl.sql` after the branch audit found 17
  public SECURITY DEFINER functions effectively executable by `anon`. Remove current/future PUBLIC
  and anonymous grants, fix the comparator search path, restrict the signup trigger, and fail the
  migration if any anonymous privileged function remains. Add catalog, future-default, comparator,
  and auth-hook regression tests.
- [x] Apply the original phased set to production Supabase `royftsqyawtyfjolfabd`, advancing
  11 -> 41/41 before the separately rehearsed worker-role migration brought production to 42/42.
  Phase A applied 20 migrations; all eight concurrent indexes are ready/valid/live; Phase B1 applied
  six; B2 drain returned `(0, NULL, false)`; B3 has 17 validated constraints and zero invalid; B4
  retains activation v1/v2/v3 and removes the rollout backfill; and the ACL migration applied. At
  that 41-migration checkpoint the dry-run was up to date; error-level
  `public`/`private`/`storage` lint passes, `anon` can execute 0/37 public SECURITY DEFINER functions,
  and 37/37 use the fixed empty search path.
- [x] Author source migration `20260819053842_provision_causent_worker_roles.sql` and the catalog
  regression contract for the three mutually bounded passwordless `NOLOGIN` identities:
  `causent_drift_worker`, `causent_recompute_worker`, and `causent_resolve_worker`. None can assume
  `service_role`; recompute/resolve receive only SET-only, non-inherited `authenticated` membership.
- [x] Apply and verify migration 42 through a full local reset, a disposable-clone Supavisor
  rehearsal, and production. Local role tests pass 8/8; the clone credentials were disabled;
  production role attributes/memberships/grants and exact `aws-1` pooler logins pass; local plus
  production error-level lint pass; and the serialized post-42 dry-run reports up to date.
- [x] Preserve the rollout boundary during schema activation: add no `decision_report_rollouts` row,
  load no production seed, rotate no database password, and move no worker or app artifact while the
  schema phases were running. A later single-user, single-workspace rollout was deliberately added
  for authenticated acceptance and remains enabled; no broad rollout occurred.
- [x] Remove stale `CAUSENT_DEMO_TODAY` from the `causent-ai` Production environment; add Sensitive
  `SUPABASE_SERVICE_ROLE_KEY`; create the `causent-drift`, `causent-recompute`, and
  `causent-resolve` projects; configure matching high-entropy Sensitive app/worker secrets and the
  three app URLs; and rotate `CRON_SECRET`. The promoted workers and fixed live app consumed this
  configuration without exposing a secret value.
- [x] Add exact stage-only parity for drift/recompute/resolve, pinned Vercel team/project checks,
  target-specific DSN validation in both the deploy gate and Python runtime, a strong-secret gate,
  `--skip-domain` production candidates, and a separate explicit promotion command. Owner,
  `service_role`, cross-worker, direct-host, and malformed DSNs fail closed without echoing values.
- [x] Replace the demo-only scheduled resolution sweep with bounded production discovery over due
  workspaces. Select a deterministic write-capable actor under the same inherited membership rules
  as RLS, send the explicit actor to the worker, cap each run at 20 workspaces/four concurrent calls,
  and repeat every five minutes to drain backlog. Preserve the original 15:00 UTC decision-day
  cutoff and keep production responses identity-free. Local demo retains its fixed fixture path.
- [x] Replace operator-supplied JSON pools with a source-side external-broker contract using
  `CAUSENT_STAGING_SESSION_POOL_URL` and high-entropy `CAUSENT_STAGING_SESSION_POOL_TOKEN`. Validate
  durable allocation-set/profile lease envelopes, exact capacity, real Supabase session lineage,
  distinct/disjoint single-use sessions, fail-closed login handling, and an adversarial foreign-
  tenant positive control outside every load pool. The complete `release_gate` matrix now includes
  adversarial rather than allowing an isolation-free success label; clean runners create the result
  directory and fail the gate when a required k6 artifact is absent.
- [ ] Implement, audit, and configure the external session broker. It does not exist today, so the
  protected live staging workflow is operator-blocked and has not run.
- [ ] Decide whether a later production database password rotation is desired. No rotation occurred
  during schema activation.
- [x] Generate separate nonempty production role passwords and configure each worker's Sensitive
  `DATABASE_URL` with exactly
  `<worker-role>.<20-character-ref>@*.pooler.supabase.com:5432/postgres?sslmode=require`. Never use
  `postgres`, `service_role`, an empty password, or one role/DSN for multiple workers. All three
  exact target-specific DSNs are stored Sensitive on their matching Vercel projects.
- [x] Promote the three worker deployments on their dedicated domains: drift
  `dpl_5a5BFfP86YxCjWGBhMX3Z3iF64po`, recompute
  `dpl_2PAG63un8RvuXTDAyCJYMyGCYKFK`, and resolve
  `dpl_2pra4r5dHLiPvPpKP92Qk8ojphMM`. Rotate secrets without recording their values.
- [x] Create replacement app candidate `dpl_GC2TDZGLx6DijqGwgEXfxgMVn6ai`; verify `/login` returns
  200 while `/` and Decision Report onboarding return 307 to login; then promote it for authenticated
  acceptance. When that acceptance exposed the active-report action-binding regression, immediately
  restore verified artifact `dpl_FCGWhLDt7oZsMp1preohuNt1gTww` while repairing the defect.
- [x] Pass all five candidate cron canaries: resolve 4/4 predictions for one workspace; drift
  generation 4 for one workspace; recompute 0; connector 0; reconciliation over two registered workspaces, 0. Confirm
  Vercel independently logged HTTP 200 for every request; confirm the resolver exact retry returned
  HTTP 200 with zero workspaces/zero predictions and candidate error logs were empty afterward.
  Record resolver UUID fix `f6b0204` and CI assertion fix `8b2ad20`.
- [x] Fix normalized active-report action/metric loading and pure **Open** navigation in `85860dc`.
  Focused tests pass 21/21; the complete library run reports 678 total (612 passed, 66 expected
  environment/live-model skips); materialization integration passes 4/4; and TypeScript, full lint,
  the Next.js 16 webpack build, and `git diff --check` pass.
- [x] Hosted CI run `32287053300` completed successfully for `85860dc`. PR #32 remains draft.
- [ ] Enable Supabase leaked-password protection. This remains a platform warning, not a passed gate.
- [ ] Run the protected remote k6 release matrix and representative-volume plans. The small clone used
  expected indexes for only three of five hot reads; actions/evidence used sequential scans and the
  evidence read was roughly 60–87 ms, so no scale claim is permitted.
- [x] Create and canary fixed replacement deployment `dpl_8twnZ3dwtahoCF6tLiejEFgMJCUL`, promote it
  to `app.causent.ai`, and retest the controlled authenticated report loop. Verify correct iteration-4
  primary/support action bindings and canonical deep links without changing activation, telemetry,
  or recompute counters.
- [x] Soft-remove iterations 4, 3, and 2 in reverse order through the UI. Verify Reports pointer
  transitions back to iteration 1, the removed iteration-4 direct link fails closed, iteration 1 plus
  Reports/Actions/Data/Impact load cleanly, and checked browser development logs remain empty. A
  privileged read-only audit confirms retained revisions and canonical/audit relations for the
  removed successors, disjoint current iteration-1 actions, one iteration-4 activation, four scoped
  activation events, no iteration-4 recompute job, and one enabled controlled rollout.
- [ ] Delete the billable with-data Supabase rehearsal branch after its evidence is no longer needed.

## P0 — AI-assisted Decision Report partner wedge

Approved design: `docs/designs/ai-assisted-decision-report.md`.

### Review round 1 — full-loop product presentation

- [x] Simplify onboarding to one decision brief, optional URL/PDF evidence, two explicit sample reports, and authorization copy on the draft action.
- [x] Present the editable Decision Report as Overview, Analysis, and Implementation Plan with document hierarchy, fewer status pills, a prediction visual, and a quiet AI Assisted footer.
- [x] Add optional action priority, tags, skills, estimated time, and estimated cost to the validated revision snapshot; surface them in the report and Actions & Decisions without changing active history.
- [x] Make project navigation responsive; add Project Summary and Edit Decision Report; keep the external-agent seam manual and avoid any MCP connection claim.
- [x] Keep Core Metrics closed by default, show one selected metric, and pair raw level bars with a zero-centered WoW/MoM change view.
- [x] Simplify Data Workshop around metric name, unit, connection, and one import explanation; place the activated prediction above Impact by Metric and Impact by Actions with methodology details at the bottom.
- [x] Add a 122-row Gummy Alpha full-loop fixture plus a loopback-only recompute runner. Local browser acceptance produced a +14.7pp confident readout from the active report's June 15 action.
- [x] Complete the founder's first-round interaction review; the outcome requires a second UI/workflow pass.

### Review round 2 — interaction comprehension

- [x] Reframe onboarding around the casual challenge-first prompt **What's the biggest business challenge on your mind today?** Causent fills the Decision Report from the user's own words and clearly highlights any core details that still need input.
- [x] Present one concise decision document with **Decision**, **Supporting Evidence**, and **Implementation** sections. Preserve structured Background, Problem, and Decision claims behind one readable prose block; make evidence an editable paragraph with one optional private chart/graph; remove the report-level metric-rationale and governance prompts.
- [x] Allow up to 25 draft actions and one explicit primary action. The later two-canvas follow-up supersedes the interim one-to-three activation limit by including all remaining actions and binding each to one selected metric.
- [x] Replace explicit Save Report gating with debounced, serialized autosave. Flush the exact latest revision before asset mutation or activation; preserve local edits and stop on a stale conflict rather than silently rebasing.
- [x] Add a forward database readiness predicate requiring Background, Problem, Decision, the Action Plan summary, and at least one titled action. Supporting evidence and metric rationale remain optional; focused integration coverage proves both the permissive and rejecting cases. Align the repository scanner and browser state in the interaction implementation.
- [x] Replace the manually resizable narrative fields with document-like canvases while keeping every paragraph bound to its existing claim ID, provenance, gap target, validated edit command, and serialized autosave path. The later follow-up locks the final structure to exactly two rich canvases.
- [x] Use the same responsive global header and full-size logo in onboarding and the dashboard. Keep the funnel tab-free, collapse only the New Project label at narrow widths, and remove the development-only Next.js badge that covered the logo during local review.

### Review round 2 follow-up — visual context and manual agent launchers

- [x] Add an on-demand Actions History chart from existing current-report metric observations and action timing. It creates no observation, evidence, or new durable data.
- [x] Add an Impact plan-versus-outcome chart from the existing current-report projection, prediction, and evidence, preserving honest planned, gathering, preliminary descriptive, and measured states without creating a new causal claim.
- [x] Present Claude and Codex as distinct UI triggers for the same bounded manual clipboard handoff dialog. Neither trigger authenticates with a provider, sends context automatically, or grants an agent authority.
- [x] Keep this follow-up presentation-only: no database migration, schema/table change, Storage path, server write, durable handback, or generated evidence was added.
- [x] Complete focused responsive, keyboard-semantic, browser, and console validation for the History chart, plan-versus-outcome chart, and Claude/Codex dialog controls at desktop and 390px. Native controls, focus-visible states, dialog egress gating/cancel controls, and zero browser-console warnings were verified; final founder review remains open below.

### Review round 2 completed-loop example — 2026-08-10

- [x] Add a deterministic Northstar Support golden report behind its explicit sample card. The brief supplies the 40% baseline, 55% target, named owners, customer, stakeholders, and governance boundary; the generated report preselects three fully described actions, one primary lever, and a +37.5% human prediction.
- [x] Add a dedicated 122-day **First-week Setup Completion** fixture and a loopback-only setup helper. The helper imports through `import_workspace_metric_csv_v1`, selects four populated context metrics through `set_workspace_core_metric_v1`, and asserts that the workspace current-series pointer is unchanged.
- [x] Show every activated action's assigned report metric in Actions & Decisions. Keep the current one-report-metric contract explicit: support actions are connected but not independently credited; only the pre-registered primary lever can enter the causal rollup.
- [x] Replace the report-mode generic impact aggregate with a mature Decision outcome: plan, measured estimate, variance, analysis sample, 3/3 completion, the existing plan/outcome chart, an observed baseline/target/action timeline, and an action-to-metric trace with confidence interval and pre/post counts.
- [x] Expand Core Metrics into visible Report target and Context choices with correct `1 report + N core` accounting. Context charts never change the report prediction or causal target and never reuse the report's action markers.
- [x] Run the local Northstar loop through the checked save, activation, three manual completions, recompute, and resolution paths. The dedicated metric resolves `CONFIRMED`: +37.0% measured versus +37.5% planned, +14.7pp native lift, 95% CI +14.5pp to +14.9pp, 75 pre and 47 post observations.

- [x] Finish release hardening for explicit sample selection: use a deterministic,
  server-validated activation-ready fixture and label the card **Full-plan example**. Verify that
  selecting it cannot depend on a model-shaped shortcut or bypass normal report validation.

This is an explicitly synthetic, local-only founder-review demonstration, not partner evidence or
production seed data. The 122-row completed outcome must never be loaded into production. Distinct causal
metrics and predictions per action would require a separate normalized multi-target activation and
recompute contract; they were not faked into this review pass.

Authenticated MCP/API delivery, provider OAuth, automatic context delivery, trusted writes, and
durable attribution remain deferred until after partner review.

- [ ] Continue the founder review after this operator-directed release and record any additional
  workflow corrections before declaring the MVP interaction complete.

### Review round 2 follow-up — two-canvas Decision Report

- [x] Replace the separate narrative fields with exactly two Tiptap/ProseMirror canvases under one shared document toolbar: Decision contains Background, Problem, Decision, and optional Evidence; Action Plan contains the plan summary, Core Metrics, and every action.
- [x] Support paragraphs, restrained headings, emphasis, lists, block quotes, safe links, undo, redo, and normalized rich paste without turning typed report controls into arbitrary editor blocks.
- [x] Keep `Claim.text` authoritative and persist optional versioned portable rich-text JSON in a report-level claim map so legacy readers, activation, Actions & Decisions, and causal workflows remain compatible.
- [x] Preserve sourced provenance for formatting-only changes; retain the existing `user_confirmed` and source-clearing transition for semantic text changes.
- [x] Reject orphaned/divergent/oversized editor JSON, unsupported nodes or marks, unsafe links, and library-only attributes. Never store or render pasted HTML.
- [x] Include every suggested action by default, retain the 25-action ceiling, and allow users to add or remove actions while keeping one explicit primary action.
- [x] Select up to five report metrics, keep one explicit primary outcome, bind exactly one selected monitoring metric to every action, and require the primary action to use the primary outcome.
- [x] Persist selected metrics and action bindings in append-only activation audit tables through checked, atomic, order-independent V2/v3 activation while retaining one prediction, one primary lever, and primary-only causal recomputation.
- [x] Keep active reports read-only, preserve serialized autosave/conflict behavior and exact gap focus, and lazy-load the editor runtime after the onboarding challenge step.
- [x] Remove redundant product help text and inert controls across the current report, Actions, Data Workshop, Impact, Core Metrics, and shell while retaining errors, authorization disclosures, uncertainty, methodology, and destructive-action warnings.
- [x] Record independent product-manager and data-scientist reviews with code evidence and multiple remediation options per major issue.
- [x] Resolve the UX review's high-priority continuity issues with one lifecycle footer, a live commitment chart, persistent post-activation commitment context in Actions, and a compact complete action/metric review.
- [x] Preserve every activated action's metric assignment through Actions and Impact; label support assignments as monitoring metrics and keep causal aggregation primary-only.
- [x] Replace the dashboard's compatibility-metadata metric mapping with a fail-closed normalized activation-contract reader over the activation metric/action child tables.
- [ ] Complete the 10k-users/hour production-hardening sequence: real tenant resolution, bounded aggregate reads, deployed/instrumented async recompute, standardized lock order, mutable draft compaction, async staged ingestion, index/retention work, and representative load/soak/restore tests.
- [ ] Complete the founder's hands-on editor review. Google Docs-class collaboration, comments, suggestion mode, pagination, offline sync, and Markdown source editing remain post-review product decisions.

### Founder-selected UX follow-up — 2026-08-16

- [x] Replace the sample-name illusion with two genuine local project/workspace scopes and a compact
  server-resolved workspace selector. Carry the selected scope through report generation, saves,
  assets, Actions, Data, Impact, recomputation, and scheduled reconciliation/resolution.
- [x] Give each of the two canvases its own contextual desktop formatting bubble and a single-row,
  horizontally scrolling mobile toolbar. Use an auto-growing report title and 44 px minimum mobile
  controls without changing the typed report schema.
- [x] Make each action one editor block with one editable heading, its rich summary, compact
  primary/metric state, and a details sheet for execution metadata. Put the report-wide commitment
  and complete action-to-metric mapping before the action list.
- [x] Remove the separate activation acceptance step. The first deliberate **Start** on any included
  action activates the exact autosaved report-wide plan atomically and opens that action; passive
  editing, blur, navigation, metric selection, and opening details never activate.
- [x] Preserve the preselected primary action and primary metric regardless of which support action
  is started. Exact retries remain duplicate-free, changed/stale inputs conflict, and the action-start
  Server Action binds report and revision to the selected session workspace before materialization.
- [x] Reorder primary navigation to **Data -> Reports -> Actions -> Impact**.
- [x] Complete the integrated desktop full-loop browser pass across both real local workspaces.
- [x] Complete the mobile responsive browser pass and clean-console review. Recheck
  workspace-switch draft reset, direct-link isolation, and clicked-action anchoring at the mobile
  breakpoint before closing this acceptance item. At 390 x 844, the title wraps without horizontal
  overflow, the two editors retain one horizontally scrolling 44 px toolbar, visible controls and the
  action-details sheet meet the 44 px target, explicit workspace switching clears the mounted draft,
  cross-workspace direct links fail generically, and the clicked support action opens at its exact
  anchored row with no browser warning or error.

The two review workspaces share one synthetic local organization so the demo owner is intentionally
authorized for both. The workspace selector is an explicit current-operating-scope boundary, not a
claim that the fixture models separate customer tenants. Production tenant scale and isolation remain
part of the existing hardening work below.

### Founder-selected product, science, and engineering hardening — 2026-08-16

- [x] Unify report readiness and commitment wayfinding in one sticky lifecycle footer; make the
  prediction chart reflect the current primary metric and commitment; keep the same commitment in a
  compact report-native Actions header; and show the complete default-included action/metric plan
  before any action is started.
- [x] Load the current report's selected metrics and action bindings from normalized activation audit
  rows and fail closed on inconsistent state. Preserve one primary outcome and registered primary
  action while treating the included action with the latest effective completion date as the
  intervention event for a completed multi-action **Decision package**. Same-day ties follow the
  immutable report-plan order, never completion-entry order.
- [x] Keep percent-of-mean as the immutable prediction unit while displaying its connected native
  baseline and implied native target. Expose descriptive metric readiness without weakening the
  45-day-per-side ITS confidence floor.
- [x] Store optional expected direction and check date only for supporting-action monitoring context;
  never promote those bindings into extra predictions or action-level causal estimates.
- [x] Replace request-path Python drift computation with a coalesced async workspace job and bounded
  materialized current-drift projection. The separate hosted drift worker and its production secrets
  remain an operator gate.
- [x] Lower one CSV import to 2,000 rows and process it through resumable, digest-bound 250-row
  chunks with durable progress/final receipts and bounded transient-transaction retries.
- [x] Move verified GitHub/Jira events through a service-only transactional inbox with exact payload
  identity, attempt state, retry/dead-letter handling, and atomic canonical mutation/processed state.
- [x] Deliver an authorized private report image through a short-lived signed Storage URL for the
  exact content-hashed server path rather than proxying the object bytes through Next.js.
- [x] Add workload-shaped indexes plus authenticated plan scripts, and split the multi-metric rollout
  into expand, bounded backfill, validation, and contract phases with an online-index runbook.
- [x] Add a guarded k6 staging matrix, deterministic scale-fixture planner, protected manual workflow,
  and initial p95/p99/error budgets. These are test instruments, not capacity evidence.
- [x] Run the exact combined clean reset, schema lint, RLS/Storage/integration suite, full Node/Python
  suites, Next.js 16 webpack build, desktop/mobile browser and console acceptance, and final diff audit.
  Refreshed local evidence after migration 42: 652/671 Node tests passed with 19 intentional
  live-model skips and zero failures; 1,290/1,290 Python tests passed; worker-role tests pass 8/8;
  error-level schema lint passes; the
  supported Node 24 webpack build and request-bound dashboard guard passed. Browser QA at desktop and
  390 x 844 exercised two editors, multi-metric assignment, support-action Start, current-workspace
  isolation, Data/Reports/Actions/Impact continuity, and zero warning/error console entries. It also
  caught and fixed a flex-collapsed Actions commitment card and the remaining sub-44 px mobile links.
- [ ] Implement/audit/configure the external broker, then run the protected staging steady, burst,
  hot-workspace, mixed-write, soak, and adversarial profiles against representative data; retain
  artifacts and authenticated query plans.
- [x] Rehearse the split migration, online indexes, bounded backfill, validation, contract, ACL
  hardening, and dedicated worker roles on isolated clones. This proves the current 13 MiB production
  history and exact worker role boundary, not representative-volume lock/query behavior.
- [x] Finish production history checks and apply the verified schema through 42/42 without seed or
  rollout. The serialized post-42 dry-run reports the remote database up to date.
- [x] Deploy, canary, and promote the drift, recompute, and resolve workers; exercise all five held
  application-candidate cron routes successfully.
- [x] Complete one controlled authenticated report loop, repair the active-report binding regression,
  promote fixed deployment `dpl_8twnZ3dwtahoCF6tLiejEFgMJCUL`, and verify successor cleanup rollback,
  current-report isolation, canonical action links, unchanged mutation counters, and clean browser
  logs.
- [ ] Obtain representative-volume evidence and deliberately canary live connector-provider
  attribution plus the private Storage redirect/reattachment path. Wait for the decision due date and
  sufficient post-intervention observations before asserting terminal causal resolution.
- [ ] Replace the remaining unbounded dashboard/history contract and provision/instrument the bounded
  causal worker pool. Both were deliberately deferred from this hardening round.

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

- [x] Start Decision Report onboarding blank. Gummy Alpha and Northstar Support are explicit sample cards rather than implicit user input.
- [x] Put source-egress authorization on the explicit draft action. The copy names the decision brief and extracted URL/PDF text that may be sent to the configured AI provider; a provider or network failure preserves the user's inputs and editable fallback.
- [x] Instrument the report lifecycle with content-free, best-effort events for landing, generation start/editable/failure, save/failure, and activation/failure. Payloads accept only a server-minted opaque session key, elapsed time, bounded edit/follow-up/missing-field counts, source/fallback/retry booleans, and no report, prompt, source, asset, or clipboard content. The aggregate reports distinct-session stages/drop-off, median time to editable/save/activation, median edit/follow-up counts, and failure events plus affected sessions.
- [x] Enforce a future prediction resolution date in the browser, the shared runtime validator, and a database trigger using the UTC statement date.
- [x] Expose only the explicit current report's sanitized causal-recompute state (`idle`, `queued`, `retrying`, `failed`, or `current`) and safe timestamps in Data Workshop and Impact. The private queue, errors, attempts, hashes, and identities remain ungranted.
- [x] Add retry-oriented route recovery boundaries for the app, onboarding, and Data Workshop; failures state which durable data was not changed and keep navigation back to Reports available.
- [x] Pin Node `22.23.0`, add network-free app/worker release-config checks, and fail closed with a no-store `503` when a production app is missing its Supabase URL, anon key, or server-only service-role key, or retains a local-only flag. The service-role key is required because provenance receipt minting is intentionally unavailable to ordinary authenticated callers.
- [x] Expand the local CI contract to run TypeScript, full lint, the serialized Node/Supabase/RLS/Storage suite, schema lint, the complete engine/bridge suite, recompute bundle staging, a Next.js 16 webpack build, and a post-build dashboard-manifest guard on pinned Node/Python/Supabase versions. Explicitly revoke `UPDATE`, `DELETE`, and `TRUNCATE` capability from Decision Report lifecycle telemetry by granting authenticated users only `SELECT` and `INSERT`.
- [x] Keep the shared dashboard layout request-bound with `dynamic = "force-dynamic"`; production builds cannot freeze a seed or pre-activation snapshot into Reports, Actions & Decisions, Data Workshop, Impact, or the Core Metrics drawer.
- [x] Pass the Next.js 16.2.11 webpack build with all five product routes dynamic and pass `check:dashboard-build`, which asserts that Actions, Data Workshop, Impact, and Reports exist but are absent from the prerender manifest. Then browser-activate the initial report plus three sequential successors through Iteration 4. Verify predecessor/current semantics, four-item Reports lineage, historical direct-link read-only access, current isolation across all three operational tabs, sanitized queued recompute state, legacy-flow rollback, and an empty browser warning/error log.

### Remaining MVP release gates — human/operator work

- [x] **Database rehearsal:** authenticate/link the Supabase CLI, inspect the production baseline,
  build eight online indexes, and run the phased pending set through migration 41 on an isolated
  with-data branch. Error lint and focused RLS/security/Storage metadata assertions passed; no
  production database write occurred.
- [x] **Database apply:** production Supabase is at 42/42 after the rehearsed phases through ACL
  hardening plus `20260819053842_provision_causent_worker_roles`. Error-level schema lint passes for
  all three schemas; `anon` executes 0/37 public SECURITY DEFINER functions; 37/37 have an empty
  search path; all three worker role catalogs/pooler logins pass; and the serialized post-42 dry-run
  reports the remote database up to date.
- [ ] **Database follow-through:** remove the billable rehearsal branch when its evidence is no
  longer needed and decide whether a later password rotation is desired. Schema activation retained
  the no-rollout/no-seed boundary; one later controlled rollout remains enabled after authenticated
  acceptance, and no broad rollout or production seed is authorized.
- [x] **Dedicated worker roles:** full local reset and 8/8 role tests pass; the disposable-clone
  Supavisor rehearsal passed and its credentials were disabled; production migration 42 and exact
  role catalog checks pass. Three separate generated credentials are active without widening the
  bounded grants, and each target-specific DSN is stored Sensitive on its matching worker project.
- [x] **App environment repair:** on `causent-ai`, add Sensitive
  `SUPABASE_SERVICE_ROLE_KEY` and remove stale `CAUSENT_DEMO_TODAY`. Worker/app cron canaries and the
  fixed promoted app exercised the repaired environment without exposing a secret value.
- [x] **App/worker secret and endpoint configuration:** `causent-drift`, `causent-recompute`, and
  `causent-resolve` exist. Matching high-entropy Sensitive secrets are configured on the workers and
  `causent-ai`; app worker URLs are configured; and `CRON_SECRET` is rotated. The promoted worker and
  app-candidate canaries provide point-in-time deployment evidence; no value is recorded.
- [x] **App worker environment and cron verification:** protected config passed without recording
  secret values. All five app-candidate cron canaries passed and candidate error logs were empty.
- [x] **Recompute worker:** its exact
  `causent_recompute_worker.<20-character-ref>` Sensitive session-pooler `DATABASE_URL` is
  configured; deployment `dpl_2PAG63un8RvuXTDAyCJYMyGCYKFK` is promoted; its candidate cron canary
  passed with 0 queued jobs.
- [x] **Drift worker:** its exact `causent_drift_worker.<20-character-ref>` Sensitive session-pooler
  `DATABASE_URL` is configured; deployment `dpl_5a5BFfP86YxCjWGBhMX3Z3iF64po` is promoted; its
  candidate cron canary processed generation 4 for one workspace.
- [x] **Resolver:** its exact `causent_resolve_worker.<20-character-ref>` Sensitive production
  `DATABASE_URL` is configured; deployment `dpl_2pra4r5dHLiPvPpKP92Qk8ojphMM` is promoted; its
  candidate cron canary processed 4/4 predictions for one workspace. Resolver UUID fix `f6b0204`
  and CI assertion fix `8b2ad20` are recorded.
- [x] **Worker promotion:** all three `--skip-domain` candidates passed their release boundary and
  were explicitly promoted to the dedicated worker domains.
- [x] **Strong secrets:** matching app/worker secrets and `CRON_SECRET` were rotated and exercised by
  the canaries. Placeholder, repetitive, or weak values fail closed; no value is recorded.
- [ ] **Protected staging broker:** implement, security-audit, and configure an external broker with
  `CAUSENT_STAGING_SESSION_POOL_URL` and high-entropy `CAUSENT_STAGING_SESSION_POOL_TOKEN`. It must
  durably lease real Supabase sessions once, keep profiles disjoint within an allocation set, and
  preserve the adversarial foreign positive control. Until then, live staging load is blocked.
- [x] **Exact release revision and Preview:** commit `5a67a6f`, push
  `codex/decision-report-review-round-1`, and obtain a Ready Vercel Preview for that exact branch.
- [x] **PR merge:** founder-created PR #30 merged the two review commits into `main` as `b2bb98c`.
- [x] **Production re-release:** the historical automatic Vercel build returned HTTP 503 because
  `SUPABASE_SERVICE_ROLE_KEY` was absent and stale `CAUSENT_DEMO_TODAY` was present. Those environment
  defects are repaired. The first promoted replacement exposed an active-report binding regression,
  production was restored to `dpl_FCGWhLDt7oZsMp1preohuNt1gTww`, fix `85860dc` passed hosted CI run
  `32287053300`, and fixed deployment `dpl_8twnZ3dwtahoCF6tLiejEFgMJCUL` was canaried, promoted, and
  authenticated-retested. PR #32 remains draft.
- [x] **Authenticated report-loop canary:** activate iteration 1 with two metrics and three actions,
  complete the action package, activate three sequential successors, verify primary/support action
  bindings and canonical deep links, then soft-remove iterations 4→3→2 and observe the current pointer
  return to iteration 1. The removed iteration-4 direct link failed closed; all product tabs and the
  current direct link loaded cleanly; checked browser development logs were empty. A privileged
  read-only audit confirmed retained revision/activation/canonical binding rows, disjoint current
  actions, unchanged activation counts, no iteration-4 recompute job, and the enabled controlled
  rollout.
- [ ] **Remaining authenticated canaries:** verify private-image reattachment/signed delivery and
  provider-specific connector redelivery in production. Terminal resolution must wait for the due
  date and sufficient post-intervention observations; do not turn the future-dated report run into a
  causal-result claim.
- [ ] Complete one final deep review of the end-to-end UI experience and workflow, including the manual handoff preview, before declaring the MVP interaction complete.
- [ ] Run at least three initially unassisted partner sessions; require at least two to pass four of five checks: decision accurate, problem accurate, evidence traceable, selected core metric plausible, next action usable.

The 2026-08-12 release pass published and merged PR #30. Its automatic production deployment failed
the public runtime canary and was rolled back to the newest verified pre-guard artifact. On
2026-08-18/19, the two app environment defects were repaired and production Supabase advanced to
42/42. The three worker projects, matching Sensitive secrets, app URLs, rotated cron secret, separate
production role credentials, and exact target-specific Sensitive `DATABASE_URL` values are
configured. The external staging session broker remains pending; the serving artifact was not
changed during schema activation. All three workers and fixed app deployment
`dpl_8twnZ3dwtahoCF6tLiejEFgMJCUL` are now live. One controlled rollout remains enabled after
authenticated report-loop and cleanup verification. The external staging session broker,
private-image/provider canaries, terminal resolution, and PR #32 merge remain pending. The operator
release does not satisfy founder acceptance or the unassisted partner-session gate.

### Completed Slice 1 — interaction prototype

- [x] Lock the versioned `DecisionReportV1` schema, five claim/provenance states, runtime validation, and the original Slice 1 three-action ceiling. Review round 2 later raised only the editable draft cap to 25.
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

- [x] Cap the latency-reduction contract at three supporting proof claims and three actions. Review round 2 retains the three-proof cap but later raises the editable draft-action cap to 25.
- [x] Remove Alternatives, Relevant Precedent, and Estimated Cost from the MVP report and model contract.
- [x] Return `null`/`[]` for unknown model values, then materialize explicit editable `missing` states server-side.
- [x] Reduce the output ceiling from 4,500 to 2,200 tokens while preserving the safe fallback.
- [x] Re-run the live Gummy Alpha benchmark against the reduced contract: one attempt,
  13,852 ms, 3,873 input tokens, 1,598 output tokens, 5,471 total tokens, three proof claims,
  and three actions. Unsupplied customers, stakeholders, and data sources materialized as
  explicit `missing` states.

### Completed Slice 3 — focused gap completion and typed edits

Goal: help the user finish the partial report without adding chat infrastructure or another model call.

- [x] Add a pure `scanDecisionReportGaps(report)` function. Review round 2 supersedes its readiness order with Background, Problem, Decision, Action Plan summary, then at least one action; supporting evidence and metric rationale do not block readiness.
- [x] Define the original Slice 3 `ReportEditCommandV1` reducer used by both direct field edits and focused answers. At that checkpoint commands could replace/confirm claim text, edit action title/summary/owner, add an action up to the then-current three-action ceiling, and set data classification. Review round 2 extends this typed path and raises the draft cap to 25.
- [x] Render a compact “Complete this report” panel with at most three open questions and focus the corresponding report field when selected.
- [x] Mark user answers `user_confirmed`, preserve immutable claim/action IDs, and recompute gaps locally without another AI request.
- [x] Replace the inert final-review behavior with an explicit ready/not-ready state. Supporting evidence, customers, stakeholders, owner, governance, and mock-up fields do not block readiness.
- [x] Add the Slice 3 unit tests for gap ordering, optional missing fields, command validation, the then-current three-action ceiling, ID preservation, direct-edit/question parity, and completing the safe fallback to ready. Later reviews extend these cases for the 25-action contract.
- [x] Browser-review the live Gummy Alpha report and the ready-state transition. The review caught and fixed a contradiction where optional owners, customers, and stakeholders appeared required beside a “Decision Report ready” message.
- [x] Complete the sparse safe-fallback and keyboard-focus browser pass. Slice 9 verified exact-field focus, sequential Tab order, and report readiness without another model request.

Acceptance: the safe fallback can be completed into a report-ready draft; the Gummy Alpha report is already ready or names only real required gaps; direct editing and answering a focused question produce the same validated report state.

Non-goals: report persistence, refresh/Back recovery, general chatbot/history, metric or CSV handoff, uploads, final graph materialization, and connector work.

### Completed Slice 4 — durable report revisions and approval boundary

Goal: make the reviewed Decision Report durable and retry-safe without prematurely writing the canonical decision graph.

- [x] Add `decision_reports` and `decision_report_revisions` with scope-bound RLS and explicit grants. Revisions are append-only full `DecisionReportV1` snapshots with author, timestamp, base revision, and a database-owned deterministic content hash.
- [x] Add injected-client repository functions to create a report, append a revision, and load its current revision. Identical saves reuse the existing revision; a stale base revision returns an immediate HTTP 409 conflict with the current revision ID.
- [x] At the Slice 4 checkpoint, bind generation and persistence server actions to the authenticated session and scope, validate all client payloads at runtime, and save only on explicit user action. Review round 2 later replaces that UI gate with serialized autosave while retaining the checked persistence boundary.
- [x] At the Slice 4 checkpoint, add `Saved`/`Unsaved` UI state and explicit **Save draft**, **Save report**, and **Save changes** actions. The stable `?report=<id>` route reloads the exact report snapshot and metric projection; Review round 2 removes the manual-save controls.
- [x] Define and validate a pure, inert `ReportActivationInputV1` containing the report/revision IDs, confirmed metric ID, human prediction fields, and one to three selected action source-item IDs.
- [x] Integration-test cross-workspace denial, read-only report tables, append-only revisions, identical-save idempotency, stale-revision conflicts, schema/readiness rejection, exact reload, and zero canonical graph writes.

Acceptance: a ready Gummy Alpha report persists once; an identical retry creates no revision; one real edit creates one revision; another workspace cannot read or write it; reload restores the same report; and the slice creates zero `decisions`, `predictions`, `actions`, `decision_actions`, or `levers`.

Verification: the live local Supabase repository test passes both cases in roughly 250 ms; the RLS isolation suite passes 19/19; TypeScript, targeted lint, all 368 library tests, the Supabase schema linter, and the webpack production build pass. Manual UI acceptance remains part of the partner pass.

Historical Slice 4 non-goals: sources/assets/uploads, Data Workshop or CSV handoff, human-prediction UI, canonical materialization, connectors, and per-keystroke autosave. Later slices and Review round 2 deliberately supersede several of these boundaries.

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
- [ ] Run at least three initially unassisted partner sessions; require at least two to pass four of five checks: decision accurate, problem accurate, evidence traceable, selected core metric plausible, next action usable.

Acceptance status: the controlled rollout, rollback, durable-report survival, and local clean-state journey are verified. The product release gate remains open until three real initially unassisted partner sessions are recorded; automated or facilitator-driven runs do not substitute for that evidence.

Slice 9 non-goals: lever-flow redesign, account-level GitHub/Atlassian OAuth, warehouse connectors, automatic causal recomputation, a lower causal confidence floor, hard report deletion/restoration, autosave, revision-history/export UI, URL/PDF ingestion, OCR, or conversational delivery.

Later Slice 10 MVP-expansion work implements the bounded URL/PDF and automatic recomputation items without changing the remaining Slice 9 release gate.

Already complete and not Slice 9 work: schema/provenance/gap/edit unit coverage, explicit durable save/reload, retry-safe activation, report-native isolation, private image handling, named CSV metrics, multi-metric selection, manual action completion, report soft deletion, action coordinates/deep links, chart controls, and preliminary descriptive impact rendering.

## P1 — Existing production operations

- Retain the verified migration-42 role/grant boundary and exact per-worker Supavisor DSNs documented
  in `api/DEPLOY.md`; never use `postgres` or `service_role` as a worker identity. The final
  serialized post-42 migration dry-run is complete.
- Keep the promoted drift, recompute, and resolve workers under log/canary review. Their exact
  dedicated-role Supavisor DSNs and rotated secrets are live; no credential value belongs in docs.
- Hosted CI run `32287053300` is green for `85860dc`, fixed deployment
  `dpl_8twnZ3dwtahoCF6tLiejEFgMJCUL` serves `app.causent.ai`, and the controlled authenticated report
  loop plus successor cleanup pass. PR #32 remains draft and still needs its reviewed merge path.
- `SUPABASE_SERVICE_ROLE_KEY` is now configured as a Sensitive server-only Production app value.
  Continue to confirm it never reaches the browser; no credential value belongs in docs or logs.
- Decide separately whether to enable automated connector reconciliation and the connector-inbox
  retry cron after the service-role key is present. Canary exact redelivery, payload conflict,
  failure/retry, dead-letter, and provider mutation before enabling it. Paste attribution remains
  available without connector write automation.
- Implement and audit the external session broker, then configure the protected `staging-load`
  environment with `CAUSENT_STAGING_SESSION_POOL_URL`, high-entropy
  `CAUSENT_STAGING_SESSION_POOL_TOKEN`, the separate adversarial
  foreign-owner/workspace/marker positive control, and an isolated write probe. The broker must
  durably enforce allocation-set/profile leases, real Supabase lineage, cross-profile disjointness,
  and single use. Until configured, the live k6 gate is blocked; make no capacity or tenant-isolation
  load statement.
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
