# Decision Report founder UX follow-up

Date: 2026-08-16

Status: local implementation and desktop/mobile full-loop verification are complete. No commit,
push, PR, production migration, deployment, partner acceptance, or production acceptance is claimed.

## Product choices implemented

- Northstar is a real local project/workspace scope rather than display-only report metadata.
- The report retains exactly two typed rich editors. Desktop formatting is selection-contextual;
  mobile uses one horizontally scrolling 44 px toolbar.
- The report title grows and wraps. Mobile account, editor, evidence, action-priority, and removal
  controls meet the 44 px interaction target used in this review.
- Each action has one editable heading and rich paragraph inside the second canvas. Metric/primary
  state stays compact; execution metadata moves into a native details dialog.
- The Decision commitment sits after Core Metrics and before the action list. A compact review shows
  the primary pair and every action-to-monitoring-metric binding.
- Starting any included action activates the exact saved report-wide plan. The clicked action is a
  destination only and never replaces the registered primary action or primary outcome.
- Primary tabs are ordered Data, Reports, Actions, Impact.

## Trust and authorization boundaries

- An HttpOnly selected-workspace cookie is resolved against a server-owned local workspace registry
  and the workspaces visible to the request client. Forged or inaccessible values fail generically.
- Every report, revision, asset, dashboard read, action write, metric write, and manual resolver path
  carries the selected scope explicitly. Local service-role access never substitutes for the scope
  predicate.
- Action start preflights the exact report and revision against the selected session workspace before
  calling the checked idempotent activation transaction.
- The two demo workspaces share one synthetic organization; organization membership intentionally
  authorizes the demo owner for both. This is not evidence of separate-tenant production isolation.

## Activation behavior

- No explicit acceptance button remains.
- Only a deliberate Start action may activate. Typing, autosave, focus changes, navigation, adding or
  removing actions, changing metrics, and opening a details dialog create no canonical rows.
- Start requires an exact persisted revision, complete report readiness, one to five selected metrics,
  one primary action/outcome pair, a future prediction date, and one valid metric assignment per
  included action.
- The existing v3 database RPC still commits the decision, prediction, actions, bindings, primary
  lever, activation audit, and current-series pointer move atomically. Exact retries reuse; changed or
  stale inputs conflict.

## Debug report — Next.js webpack cache

- **Symptom:** both Node 26.5.0 and pinned Node 22.23.0 failed during the client webpack hash phase
  with `WasmHash._updateWithBuffer` reading `length` from `undefined`.
- **Root cause:** the persistent `.next/cache` contained an invalid stale webpack value. The server
  compiler completed with cache hits before the client compiler failed while hashing.
- **Fix:** isolate the generated cache and rebuild on the repository-pinned Node 22.23.0 runtime.
- **Evidence:** the fresh-cache Next.js 16.2.11 webpack build completed compilation, TypeScript, page
  data, static generation, optimization, and trace collection; the dashboard manifest guard passed.
- **Regression scope:** no source or product-data change was required. Keep Node 22 pinned and clear
  only generated build cache if this exact internal hash failure recurs.
- **Status:** DONE.

## Verification record

- Clean local Supabase reset: **PASS**.
- Supabase schema lint completed with four pre-existing warnings and no new error-level finding
  attributed to this round.
- Full TypeScript check and full application lint: **PASS**.
- Credentialed TypeScript integration suite: **40/40 passed**.
- Python engine, bridge, isolation, recompute, function, and concurrency suite: **1,219 passed**.
- Next.js 16 webpack production build: **PASS**. The request-bound dashboard build contract also
  passed.
- Desktop browser full-loop acceptance across Gummy Alpha and Northstar's real local workspaces:
  **PASS**.
- Mobile browser acceptance at 390 x 844: **PASS**. There is no horizontal overflow; the report title
  wraps; exactly two editors remain; the horizontally scrolling formatting row, visible shell controls,
  and the full-screen action details sheet meet the 44 px interaction target.
- Workspace/navigation acceptance: **PASS**. Explicit workspace switching clears a mounted draft,
  inaccessible cross-workspace report links fail generically, and the clicked support action preserves
  its canonical query-and-fragment destination and monitoring metric.
- Final browser console review: **PASS** with no warning or error.

This verification is local engineering evidence. It did not create a commit, push, PR, production
migration, or deployment, and it does not replace founder or partner review.

## Human gates retained

- Founder hands-on review of this exact local build.
- Three initially unassisted partner sessions; local automation is not partner evidence.
- Production-clone migration/backfill dry run, production configuration, deployment, authenticated
  canaries, and capacity testing.
