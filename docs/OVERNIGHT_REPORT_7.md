# Overnight Report 7 — finish #15 funnel + #18 ungated slice (ship-state + scorecard)

Branch `spec/coldstart-c2-finish-c5-scorecard` off `main` (`e6aba2d`). **PR opened, NOT merged.**
Part of epic #13. Closes #15. Progresses #18 (ship-state + scorecard; drift-alert surface
deferred — gated on the mechanism-mapping test).

## What shipped, per issue

### #15 — Onboarding funnel (CLOSING)
- **Step 1 auth wired into the funnel.** `app/auth/callback/route.ts` now redirects post-OAuth
  into `/onboarding` (was `/impact`) so a real authenticated session drives Steps 2-4. `?next=`
  overrides the destination, clamped to same-origin relative paths (no open-redirect). The
  session seam (`lib/auth/session.ts`, from #5) already resolves the real Supabase user; the
  `CAUSENT_LOCAL_DEMO=1` dev-session fallback is untouched, so the local demo still renders with
  no live Google login (verified in QA — the whole funnel ran unauthenticated under the flag).
- **Instrumentation — the `funnel_events` seam.** New append-only table
  (`supabase/migrations/20260713144706_funnel_events.sql`, RLS member-write/viewer-read,
  server-clock `created_at` — never hand-picked). A pure fold (`lib/funnel/events.ts`) computes
  the DoD metrics: **time-to-first-type (<30s target), Step-4 commit rate, step drop-off**, plus
  the #18 resolution-return rate. IO half is injected-client (`lib/data/funnel.ts`). The funnel
  emits `LANDED / STEP_VIEW / FIRST_TYPE / STRUCTURED / COMMITTED / SHIP_STATE` fire-and-forget —
  instrumentation never blocks the funnel. Verified live: a full QA run wrote one of each event.
- **E2E-under-auth.** `lib/onboarding/__tests__/e2e-under-auth.integration.test.ts` walks the
  whole server-action chain a session drives (login-scoped client → paste → interrogate →
  declare metric → commit → prediction card) against a scratch tenant, with events folded to the
  DoD metrics; plus the garbage-paste shadow path. Skips honestly when Supabase is unreachable.

### #18 — Ship state + resolution scorecard (UNGATED slice — PROGRESS, not closed)
- **`components/onboarding/ShipState.tsx`** — the Step-7 confirmation: committed prediction card
  + the watched lever ticket(s) + due date + the calm trust-first line ("Go build. I'll interrupt
  you only if the work stops matching your intent."). Wired into the funnel after the lever is
  armed (`LeverCreate.onAttributed`). Handles the no-lever case honestly (never blank).
- **`components/reports/Scorecard.tsx`** — the resolution scorecard ("You said +3%. Here's what
  happened."). Caveat-first, reuses `Delta` + `VerdictBadge`. Pure shaping in `lib/scorecard.ts`
  converts the native CI bounds onto the committed %-of-mean scale (never re-implements the
  math — reads what `resolve.py` measured). Every verdict class routes to an honest surface:
  measured (CONFIRMED/DIRECTION_CONFIRMED/REFUTED show predicted-vs-measured), **GATHERING**
  (auto-extended re-measure note — never a hard resolve), **UNMEASURABLE_NO_METRIC** (connect-
  the-metric / self-report prompt — never a blank/error), no-signal, no-lever.
- **`PredictionVerdict` gains `UNMEASURABLE_NO_METRIC`** (type + presentation map), matching the
  DB check constraint from C1/#14. The verdict machine is now 9-state in the UI.
- **Mid-window touch** — `DecisionDetail` renders a quiet "still on track, N days to resolution"
  nudge for undrifted, unresolved predictions.
- **Resolution trigger** — `app/api/cron/resolve/route.ts` (CRON_SECRET-guarded, fail-closed,
  like reconcile-levers) shells the same `run_resolution.py` due-sweep the "Resolve now" dev
  affordance uses; `vercel.json` cron entry (daily 06:00). Nothing re-implements the engine.
- **Resolution-return-rate** — a `SCORECARD_VIEW` event fires when a resolved scorecard renders
  (`DecisionDetail` effect + `recordScorecardView` action); `getResolutionReturnRate` computes
  distinct-viewed / resolved. Verified live (2 distinct scorecards viewed in QA).

### Explicitly NOT built (gated — confirmed absent)
- `components/drift/DriftAlert.tsx` + the `LEVER_DROPPED` assert-fact/ask-interpretation alert +
  its trigger predicate + alert-action-vs-mute metric. Grep of the branch diff for
  `DriftAlert|LEVER_DROPPED|ask-interpretation` → **NONE**. The baseline-drift beat (PR #22),
  #16 live connector/App/PAT, and #19 Jira parity were untouched.

## Gate evidence — ALL GREEN

1. **`supabase db reset` clean + seed runs.** All 10 migrations apply (incl. `funnel_events`);
   `seed_demo.py` → `PASS — confident, gathering-data, all 7 target verdicts, and a firing
   baseline-drift beat`. The seed now exercises CONFIRMED / REFUTED / DIRECTION_CONFIRMED /
   INCONCLUSIVE / GATHERING / VOIDED / **UNMEASURABLE_NO_METRIC** (new: decision D8, a declared
   metric with no observations, past-due → resolves UNMEASURABLE through the real engine).
2. **Engine pytest: `1147 passed`** (no regression; == baseline 1147). **Lib tests: `288 pass`,
   0 fail** (was 269; +19: 7 for #15 [funnel fold + E2E-under-auth], 12 for #18 [verdict→UI
   mapping + resolution→scorecard integration over each seeded verdict class incl
   UNMEASURABLE_NO_METRIC + GATHERING], +1 updated 8→9 verdict-count assertion). 19 skipped are
   the pre-existing live-API gates.
3. **`npx tsc --noEmit` clean; `npm run build` clean** (all routes incl. `/api/cron/resolve`).
4. **Live browse QA** (screenshots in `docs/overnight-7-qa/`, also `/private/tmp/causent-qa/`):
   - `01–04` funnel login→paste→interrogate→commit through the auth path (LLM structured the
     paste live; real precedent panel; committed under `CAUSENT_LOCAL_DEMO=1`, no login).
   - `05` **ShipState** renders after arming the lever ("You're set. Go build." + Watching
     🎯github:issue:77 CREATED + the calm line).
   - `06` `/actions` list shows every verdict badge + the **mid-window touch** ("Still on track…
     231 days to resolution").
   - `07` **Scorecard CONFIRMED**: You predicted ▲+13.5% · Engine measured ▲+13.6% · 95% CI
     +13.4%…+13.7%.
   - `08` **Scorecard UNMEASURABLE_NO_METRIC**: the connect-the-metric / self-report prompt.
   - `09` `/impact` renders. No console errors on any page. `funnel_events` populated live
     (LANDED/FIRST_TYPE/STEP_VIEW×4/STRUCTURED/COMMITTED/SHIP_STATE + SCORECARD_VIEW×4 across 2
     predictions).
   - Cron route fail-closed: `GET /api/cron/resolve` → 401 without a valid `CRON_SECRET`.
5. **Drift-alert surface NOT built** — confirmed by grep (above).

## Decisions taken
- **Scorecard home = the Decisions tab detail** (`DecisionDetail`), where predictions already
  live — the most discoverable place a resolved prediction earns attention. `Scorecard.tsx` lives
  under `components/reports/` per the issue's file map but is rendered inline there. A whole-project
  scorecard rollup on the Reports tab is a natural follow-up, not required to close the slice.
- **Component render coverage = browse QA, not unit tests.** The test runner is `node --test`
  over `lib/**/*.ts` (no JSX transform; the repo has zero `.tsx` tests by convention). All
  testable logic lives in pure lib (`lib/scorecard.ts`, `lib/funnel/events.ts`, `lib/verdicts.ts`)
  and is unit-tested; `ShipState`/`Scorecard` are thin renderers verified by gate 4.
- **UNMEASURABLE_NO_METRIC seed** uses a declared metric with a past-due prediction so the sweep
  resolves it through the real verdict machine — no forced/faked tuple.
- **Return-rate** is prediction-keyed (`SCORECARD_VIEW.meta.prediction_id`) so it survives across
  browser sessions, distinct from the funnel-session return rate in `computeFunnelMetrics`.

## Resume instructions
- **Worktree:** `/Users/adamowens/Code/worktrees/coldstart-c2-c5` (branch
  `spec/coldstart-c2-finish-c5-scorecard`). Its `.env.local` sets `CAUSENT_LOCAL_DEMO=1`,
  `CAUSENT_ALLOW_RESOLVE_NOW=1`, and `CAUSENT_ENGINE_PYTHON` → the MAIN checkout venv (the
  worktree has its own `node_modules` from a real `npm install` — a symlinked `node_modules`
  breaks Turbopack; do NOT symlink it, and do NOT symlink `engine/.venv` either).
- **Run the gates:** `supabase db reset` → `cd engine && .venv/bin/python persistence/seed_demo.py`
  → `.venv/bin/python -m pytest -q` (1147) → back at root `npm test` (288) → `npx tsc --noEmit`
  → `npm run build`. Dev: `PORT=3210 npm run dev`.
- **Follow-ups (not blocking this PR):** real OAuth-redirect exercised against a live Google login
  (the wiring is in place; QA used the demo seam); a Reports-tab scorecard rollup; a
  funnel-metrics dashboard reading `getFunnelMetrics`/`getResolutionReturnRate`. The **gated**
  drift-alert surface (`LEVER_DROPPED`) still waits on the design-partner mechanism-mapping test
  + #16 live detection.
- `docs/STATUS.md` left UNTOUCHED — reconcile at merge time.

## Commits
```
7d8e225 feat(onboarding): wire Step 1 auth into funnel + funnel instrumentation (#15)
293f38a test(onboarding): funnel metrics unit + E2E-under-auth walk (#15)
bca3073 feat(reports): ship-state + resolution scorecard surfaces (#18 ungated)
ce87f55 feat(reports): resolution trigger cron + UNMEASURABLE_NO_METRIC seed + #18 tests
```
