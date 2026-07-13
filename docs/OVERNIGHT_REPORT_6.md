# Overnight Run 6 — baseline-drift demo beat

Branch `spec/baseline-drift` (off `main` @ `f60067d`). Implements the reviewed
design doc `adamowens-main-design-20260712-220650.md` (CEO + Eng + Design cleared)
— the seeded **baseline-drift** beat: Causent reports a change to a metric's own
baseline that the builder structurally cannot see, beside a panel showing Jira
flags nothing. Live detection on a real connected metric and the collision-drift
second beat are deferred (documented open questions in the design doc).

**Not merged** — one PR to `main`, awaiting review.

## What shipped

1. **Detector — `engine/causal/drift.py`.** A thin change-point wrapper over the
   existing `segmented_ols` (C2) + `step_ci` (C3); no parallel stats path. It
   searches the **pre-intervention window only** — `[commit, ship)`, or the whole
   post-commit tail when no lever has shipped (the prospective case) — so a lever's
   own effect is never flagged as drift *by construction*. Fires only when the step
   CI excludes 0 **and** the fit is non-degenerate (≥28 pts/side, enforced by
   `segmented_ols`) **and** the baseline move clears a magnitude floor
   (`CAUSENT_DRIFT_MIN_PCT`, default 5%). No in-window observations, or too few
   points to fit any change-point → `NO_BASELINE_YET` ("gathering baseline"), never
   a fire. Displayed levels are the plain before/after segment means; the fire
   decision rests on the rigorous fitted step + CI.

2. **Bridge read — `engine/persistence/drift_read.py` + `read_drift.py` CLI.**
   Compute-on-read through the caller's RLS-scoped connection (never the service
   role), reusing the bridge's `_load_metric` and resolve's lever loader. No
   drift-persistence migration — drift is recomputed each read, so a Restate (which
   changes only the magnitude, not the baseline) leaves the notice correct. The CLI
   emits `{prediction_id: drift}` JSON; the Next read shells out to it exactly like
   "Resolve now" shells out to `run_resolution.py`.

3. **Seed — `engine/persistence/seed_demo.py`.** A dedicated **New-User Activation**
   metric carries the drift story so it never disturbs the five core metrics'
   confident-edge / verdict stories. Its baseline slides **20% → 12%** on 2025-04-05,
   after the +3% prediction was committed (2025-02-15) and before its lever
   (PR #8455, declared-not-shipped) ships. The prediction resolves 2025-08-02
   (future) so it stays unresolved and the live notice keeps rendering. Seed
   self-verify now asserts the detector FIRES on the seeded slide.

4. **TS surface — `lib/data/drift.ts`, `lib/drift.ts`, `getDecisions`.**
   `getDriftByPrediction` spawns the engine read (15s timeout, empty map on ANY
   failure → no notice, never white-screens). `presentDrift` is the pure presenter
   (three data states, fact-shaped neutral output). Drift is attached to each
   `Prediction`.

5. **Notice UI — `components/actions/DriftNotice.tsx` + `Delta` neutral tone.**
   Calm assert-fact surface (soft info-blue + "i" icon, never an alarm); fact first,
   different-baseline line second, choice last. The baseline-move delta is
   **neutral/slate** (a fact, not a verdict — `Delta` gained a `tone="neutral"` that
   keeps the directional glyph). "Restate prediction?" is a quiet outlined action
   opening the **stub** modal → writes a `prediction_revisions` row + updates the
   magnitude via the existing `revisePrediction` (no new schema). Muted
   "Jira: no change flagged" chip. Four states: fired · not-fired (nothing) ·
   no-baseline-yet · restate-clicked.

## Gate evidence

| Gate | Result |
|------|--------|
| `supabase db reset` clean | ✅ all 10 migrations applied; **no drift migration added** |
| Seed fires the detector | ✅ `FIRED — baseline moved 20.0% → 11.9% (-40%), CI [-8.35, -7.76]`; RESULT: PASS |
| Engine pytest (no regression) | ✅ **1147 passed** (baseline 1128; +19: 14 detector matrix + 5 DB round-trip). No existing test changed. |
| `segmented_ols` / `step_ci` untouched | ✅ their suites still green (reused, not modified) |
| Lib tests | ✅ **269 pass / 0 fail** (baseline 262; +7 presenter). `npm test` |
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ clean (all routes compiled) |
| Detector correctness: lever-shipped-in-window ≠ drift | ✅ proven both in the pure matrix (`test_drift.py`) and through the DB (`test_drift_read.py::test_lever_effect_not_flagged_via_ship_bound`) |
| Flat / noise / short / no-obs / boundary | ✅ covered in the matrix |
| Restate writes a revision + updates the prediction | ✅ verified in Postgres: `revisions 0→1`, `magnitude 3.0→2.0`, row `(3.0, 2.0, "…restating against the new baseline.")` |
| Browse QA — all four states | ✅ screenshots below |
| `/impact`, `/actions`, `/onboarding` render (no regression) | ✅ all 200, no console errors; `/impact` shows "Metrics Tracked: 6" with New-User Activation integrated honestly (no attributed impact — unshipped lever) |

### Screenshots (`docs/screenshots/drift/`)
- `01-fired.png` — the fired notice on the prediction card (calm info surface,
  neutral ▼ "DOWN 40%" delta, quiet Restate, muted Jira chip).
- `02-restate-modal.png` — restate-clicked (the stub modal).
- `03-no-baseline-yet.png` — "gathering baseline" (a declared/short-window prediction).
- `04-not-fired.png` — a resolved prediction: no notice.
- `05-impact-no-regression.png` — `/impact` renders with the 6th metric.

## Decisions honored from the design doc
- **Detector = thin wrapper over the existing level-shift fit** (CEO D5 / Eng),
  not a greenfield stats module.
- **Pre-intervention window is the correctness crux** (Eng) — drift ≠ lever effect,
  enforced by the `[commit, ship)` bound.
- **Restate = stub** (CEO): modal + `revisePrediction` reusing the existing
  append-only `prediction_revisions`; NOT the full revision-history subsystem.
- **Compute-on-read, no drift-persistence migration** (Eng).
- **Calm assert-fact notice, neutral (not verdict-colored) delta, four states**
  (Design). The approved mockup rendered the delta teal; the *written* Design
  review outcome specifies **neutral/slate** ("a fact, not a verdict") — followed
  the written decision (tone is load-bearing; pixel-match is not).

## Deferred (out of scope tonight, per the spec)
- Google OAuth / GitHub App / PAT console setup (human-only).
- Collision-drift second beat.
- Full revision-history UI subsystem (stubbed).
- Live detection on a real connected metric (window/threshold tuning is a
  documented open question). The prod demo has no engine venv, so drift is silent
  there by design (defensive empty map) — it is a local/browse-QA depth signal.

## Resume instructions
- Worktree: `/Users/adamowens/Code/worktrees/baseline-drift` (branch
  `spec/baseline-drift`). `CAUSENT_ENGINE_PYTHON` in its `.env.local` points at the
  main checkout venv; `node_modules` is a real install (Turbopack rejects a symlink).
- Reproduce: `supabase db reset` → `cd engine && .venv/bin/python persistence/seed_demo.py`
  (expects `RESULT: PASS … firing baseline-drift beat`).
- Run the app for QA: `CAUSENT_LOCAL_DEMO=1 PORT=3010 npm run dev`, open `/actions`
  (the drift decision "Lift new-user activation…" is selected by default).
- Gates: `cd engine && .venv/bin/python -m pytest -q` · `npm test` ·
  `npx tsc --noEmit` · `npm run build`.
- `docs/STATUS.md` intentionally left untouched — reconcile at merge time.
