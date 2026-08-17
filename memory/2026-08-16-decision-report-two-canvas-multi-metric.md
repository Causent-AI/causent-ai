# Decision Report two-canvas and multi-metric completion — 2026-08-16

## Direction and evidence boundary

Founder review replaced the fragmented report fields with exactly two embedded document editors and
expanded the plan from one report metric to one primary outcome plus per-action monitoring metrics.
This implementation is local engineering and design-review evidence. It does not mark the remaining
founder review, initially unassisted partner sessions, production-clone migration rehearsal, production
configuration, deployment, or canary gates complete.

## Delivered product contract

- The onboarding question is challenge-first and evidence remains optional. The editor bundle is
  lazy-loaded only after a generated or saved report is selected.
- One shared Tiptap 3 toolbar controls exactly two ProseMirror applications:
  - **Decision:** Background, Problem, Decision, and zero to three Evidence subsections.
  - **Action Plan:** Action Plan Summary, embedded Core Metrics, and every action's description and
    typed execution controls.
- All generated actions are included by default. A draft may contain up to 25 actions; users can add,
  edit, or remove actions and select one primary action.
- A draft can select one to five scope-bound metrics, one of which is the **Primary outcome**. Every
  included action receives exactly one selected metric. The primary action is locked to the primary
  outcome; supporting action assignments are labeled **Monitoring metric** and do not receive an
  independent causal estimate.
- `Claim.text` remains authoritative. Optional bounded portable rich-text JSON preserves formatting;
  formatting-only edits retain source provenance, while semantic edits become `user_confirmed` and
  clear inherited source authority. Active reports remain read-only and legacy snapshots hydrate from
  plain text without a backfill.
- Redundant help, promotional copy, and inert controls were removed across onboarding, Reports,
  Actions & Decisions, Data Workshop, Core Metrics, Impact, and the shell. Access, data-egress,
  destructive-action, error-recovery, uncertainty, methodology, and operational-state disclosures
  remain explicit.

## Durable activation contract

`ReportActivationInputV2` carries the selected metric set and one action-to-metric assignment for
every included action. The independent atomic `activate_decision_report_v3` transaction enforces:

- one to five unique selected metrics including the primary outcome;
- one to 25 unique selected actions and exactly one selected metric per action;
- primary action to primary outcome agreement;
- checked actor, viewer, workspace, report, revision, series, predecessor, and current-pointer identity;
- order-independent SHA-256 retry identity; exact retries reuse the original result and changed retries
  conflict;
- append-only selected-metric and action-binding audit rows with RLS-readable, direct-DML-denied
  policies;
- atomic canonical action creation, one prediction, one primary lever, one primary-outcome recompute
  request, report activation, and current-pointer movement.

Every canonical action retains its assigned metric name for compatible readers. Impact now preserves
the exact monitoring metric on support actions while restricting aggregation and causal readout to the
primary outcome.

## Verification on the combined tree

- Clean local Supabase reset through all migrations, including
  `20260817012313_decision_report_multi_metric_activation.sql`: **PASS**.
- Credentialed serialized Node/Supabase/RLS/Storage suite: **597 total; 578 passed; 19 intentional
  live-model skips; 0 failed**.
- Full Python engine, bridge, persistence, tenant-isolation, RLS, and Storage suite: **1,217 passed**.
- Focused authenticated activation materialization: **4/4 passed**; focused activation unit suite:
  **17/17 passed**; tenant/RLS matrix: **39/39 passed**.
- TypeScript, full ESLint with zero warnings, and `git diff --check`: **PASS**.
- Supabase warning-level schema lint: **PASS** with only the three pre-existing advisory warnings
  (`decision_report_v2_provenance_is_valid` volatility and two unread local variables).
- Next.js `16.2.11` webpack production build under the repository-required Node `22.23.2`: **PASS**
  after isolating the `.next` cache produced by an accidental Node 26 attempt. The Node 26
  `module.register()` deprecation and webpack hash failure were toolchain/cache issues, not app code.
- Request-bound dashboard build contract: **PASS** for Actions, Data Workshop, Impact, and Reports.
- Standalone causal recompute `--stage-only` bundle: **PASS**, 18 exact files and no network/deploy.

## Browser acceptance

The deterministic Northstar full-plan example was exercised on `http://127.0.0.1:3100` against the
fresh local demo database:

1. `/onboarding` redirected to `?flow=decision-report`; the casual challenge prompt and optional
   URL/PDF evidence appeared under the full-size shared header.
2. Generation produced exactly two `.report-canvas` editors with section titles and editable
   paragraphs. The browser added a fourth action and edited its title and description inside the
   Action Plan document.
3. Activation Rate and Support Tickets were selected together. Actions 2 and 4 were assigned Support
   Tickets; Actions 1 and the primary Action 3 were assigned Activation Rate.
4. Serialized autosave reached **Autosaved**, reload-safe content remained intact, and V2 activation
   created four actions before redirecting to Actions & Decisions.
5. Actions showed all four action codes and exact metric assignments, plus separate explicit Claude
   and Codex copy buttons where the current handoff policy permits them.
6. The direct report link reopened the active report with both editors `contenteditable=false` and no
   activation control.
7. Data Workshop had no Rows column. The on-demand Core Metrics drawer selected Support Tickets,
   moved it to the prominent first summary row, and retained the other metrics below it.
8. Impact showed Activation Rate as the only outcome metric, Support Tickets as the monitoring metric
   for the assigned support actions, no invented support-action causal estimate, and zero browser issue
   overlays after the final reload.
9. A fresh-server editor pass added and removed an action to exercise structural document sync and
   serialized autosave. Both canvases remained mounted, the draft returned to four actions, and the
   prior React/Tiptap lifecycle warning did not recur in the browser or development-server console.

Portable-format, paste sanitization, provenance, undo/redo, bounds, conflict, exact-retry, and active
immutability behavior are covered by automated domain/integration tests. A fresh hands-on 390 px
editor pass remains part of the founder review rather than being inferred from desktop automation.

## Independent reviews and remaining risks

- Product manager: the loop is credible but the prediction/activation transition, post-activation
  commitment context, module ordering, and compact final action summary are not yet self-evident.
- Data scientist: the single primary outcome/action boundary is sound. The remaining top risks are a
  generation-time chart that can diverge from the live commitment, no metric-readiness signal, and
  action-package attribution when plan actions land in one intervention window.
- UX designer: the rendered audit caught and fixed unstable sample/project identity and a sticky
  toolbar defeated by its overflow ancestor. The dated report retains evidence and options for the
  remaining long-scroll, action-control density, mobile title/touch targets, activation summary, and
  payoff-continuity issues.
- Engineering scale: relational integrity and fail-closed isolation are strong for the partner MVP,
  but the repository is not capacity-proven for 10,000 active users/hour over gigabytes of history.
  Real tenant resolution, bounded aggregate reads, async drift/recompute, a deployed worker pool,
  standardized lock order, staged ingestion, query/index evidence, SLO telemetry, and representative
  load/soak/restore tests remain required.

No commit, push, pull-request mutation, production migration, external write, worker deployment, or
production deployment was performed.
