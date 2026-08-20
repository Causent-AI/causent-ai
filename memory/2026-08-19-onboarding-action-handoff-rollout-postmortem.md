# Postmortem: onboarding fallback and missing action handoff controls — 2026-08-19

## Status

Root causes are confirmed and corrected in the release source. The owner explicitly authorized an
application-only release; local source and browser gates pass, while hosted CI, immutable-candidate
acceptance, explicit promotion, and post-promotion acceptance remain pending. Production continues
serving the previous verified artifact until those gates complete.

This incident caused user-visible feature loss. It did not corrupt report, activation, action,
metric, causal, or audit data, and no authorization bypass or cross-workspace disclosure was found.

## Executive summary

Two regressions surfaced during production review:

1. A newly authenticated user still entered the legacy onboarding funnel instead of the current
   Decision Report builder.
2. A supporting action assigned to a secondary monitoring metric did not show the Claude and Codex
   copy controls that appeared on the primary action.

The failures had the same systemic shape: a newer product/domain contract landed without updating
every older consumer and release assumption.

- Slice 9 intentionally made Decision Report onboarding an opt-in rollout. Product direction later
  changed to current-by-default for authenticated users, but the resolver, invite flow, tests, and
  release checklist still encoded the original opt-in contract.
- Slice 10 introduced the action handoff under a single-metric contract. The later multi-metric
  activation work correctly assigned supporting actions to monitoring metrics, but the handoff
  builder still required every action metric to equal the one primary prediction metric. The
  Actions page silently removed every rejected handoff.

The tests were green because they proved the old assumptions consistently. Acceptance exercised an
already-enabled account and the registered primary action rather than a fresh unassigned account and
every action in a multi-metric plan.

## User impact

### Onboarding

- An authenticated user without an exact enabled rollout row landed on `?flow=legacy`.
- An old `?flow=legacy` URL stayed sticky even after product direction moved to the current builder.
- The user could reasonably conclude that the new onboarding had not shipped.

### Actions

- A valid current supporting action assigned to a secondary metric lost both the Claude and Codex
  controls.
- The primary action continued to work, making the page look partially configured instead of
  clearly broken.
- The underlying action-to-metric binding, registered prediction, causal boundary, and audit rows
  remained intact.

## Timeline

| Date | Change | Effect |
| --- | --- | --- |
| 2026-08-03 | PR #28, `c894451`, introduced the controlled Slice 9 rollout. | Unassigned and lookup-failure users intentionally used legacy onboarding; `?flow=legacy` was sticky; saved report links remained reachable. |
| 2026-08-03 | PR #29, `690e196`, introduced the manual action handoff. | The then-valid contract assumed one report metric shared by the prediction and selected action. |
| 2026-08-18 | PR #31, `33760ee`, added one primary outcome plus per-action monitoring metrics. | Supporting actions could correctly bind to a metric different from the primary prediction. The older handoff guard and page fan-out were not updated. |
| 2026-08-18/19 | Production schema, workers, and application were promoted through candidate/canary/rollback/re-promotion steps. | One controlled account was explicitly enabled. This did not test a fresh unassigned account, and the report walkthrough did not assert controls on every multi-metric action. |
| 2026-08-19 | A fresh-user and full-page review exposed both issues. | Investigation separated production state from source behavior and reproduced the secondary-action failure from the current contracts. |
| 2026-08-19 | Current working-tree fix. | Authenticated unassigned users now receive current onboarding; explicit disable/error remains rollback. Every valid current action now receives a binding-checked handoff, with supporting metrics labeled monitoring-only. |

The exact rollout row for the reporting account was not independently queried during diagnosis. The
deployed resolver nevertheless produced the reported result deterministically for either an
unassigned user or a sticky legacy URL, and both states were part of the old contract.

## Root cause 1: product rollout policy changed without a contract migration

The old behavior was internally correct:

- OAuth returned a new session to bare `/onboarding`.
- The page read `decision_report_rollouts` for the exact workspace and authenticated user.
- Missing rows and lookup errors became legacy.
- `?flow=legacy` remained authoritative across refresh and later enablement.
- The invite path added an allowed email and organization membership but did not add a rollout row.

The product decision changed from “controlled opt-in” to “latest onboarding for authenticated
members.” That change was treated as a UI expectation, not a versioned exposure-contract change. No
single release artifact declared whether onboarding was `off`, `allowlist`, or `default-on with an
explicit denylist rollback`. As a result, the database, route resolver, invite process, tests, and
operator procedure remained consistent with the old policy.

### Five whys

1. Why did the user see legacy? The exact user/workspace state did not resolve to enabled current
   onboarding, and legacy URLs stayed sticky.
2. Why was enablement required? Slice 9 deliberately used an opt-in rollout row.
3. Why did that remain after product direction changed? The change was not recorded as an exposure
   contract migration with code, data, tests, and operator steps.
4. Why did tests pass? They correctly locked the original opt-in behavior and used pre-enabled local
   fixtures.
5. Why did release acceptance miss it? It reused the controlled acceptance account instead of
   starting with a real fresh, unassigned OAuth identity.

## Root cause 2: downstream handoff contract did not evolve with multi-metric actions

The action data model evolved from one shared report metric to:

- one primary outcome and prediction;
- one registered primary action tied to that outcome; and
- supporting actions that may use different monitoring metrics without independent causal claims.

The handoff builder still rejected an action when
`action.primaryMetricId !== prediction.metricId`. The Actions server called that builder for each
row and converted a rejected result to an empty array. `DecisionDetail` renders both copy controls
only when a handoff exists. A correctly configured supporting action therefore disappeared from the
handoff set without an error, even though its normalized activation binding was valid.

### Five whys

1. Why were the buttons missing? The page received no handoff for that action.
2. Why was there no handoff? The builder rejected its secondary metric.
3. Why did it reject a valid metric? It retained the earlier single-metric invariant.
4. Why was the stale invariant not found? PR #31 changed the activation domain but did not inventory
   every downstream reader of action metric identity.
5. Why did tests pass? Builder fixtures used a primary-metric action, and no page-assembly test
   asserted one handoff and two copy targets for every eligible current action.

## Contributing factors

- **State was split across systems.** Git source, Vercel candidate, production alias, Supabase
  migrations, worker deployments, membership, workspace cookie, and rollout assignment were all
  independently correctable but not summarized in one release manifest.
- **A merge was easy to confuse with exposure.** Source merge, deployment creation, alias promotion,
  schema activation, and feature rollout are separate events.
- **Local fixtures were too helpful.** The reset path pre-enabled the current flow and made the
  expected screen appear, so it did not represent a first production login.
- **The acceptance scenario was not combinatorial.** A multi-action, multi-metric report was created,
  but checks did not explicitly enumerate Action 1, Action 2, and every Claude/Codex control.
- **Failure was silent.** Fail-closed handoff filtering protected data boundaries but supplied no
  invariant or telemetry saying that an eligible current action had been omitted.
- **The change set was broad.** PR #31 changed many contracts, increasing the chance that a
  downstream consumer would retain an earlier assumption.

## Why existing controls did not catch it

| Control | What it proved | What it did not prove |
| --- | --- | --- |
| Rollout unit tests | The original opt-in contract was implemented consistently. | That the product still wanted opt-in behavior for new members. |
| Local onboarding acceptance | An enabled local account could reach Decision Report. | A fresh unassigned production OAuth account reached the current flow. |
| Handoff unit tests | A primary action could produce a bounded, redacted packet. | A supporting action on a secondary metric also produced a handoff. |
| Multi-metric browser review | Metrics could be assigned and preserved. | Every eligible action rendered both provider controls. |
| Candidate canaries | The candidate, workers, routes, and database contracts were reachable. | The exact authenticated exposure matrix and every action-row affordance. |

## Corrective changes in the current tree

### Onboarding

- Replaced a boolean with explicit rollout states: `enabled`, `disabled`, `unassigned`, and
  `unavailable`.
- Authenticated `enabled` and `unassigned` users now receive Decision Report onboarding.
- Explicit `disabled` and lookup `unavailable` remain fail-closed legacy rollback states.
- A stale legacy query is canonicalized to the current flow when the user is enabled or unassigned.
- Saved report links still take precedence, and anonymous local demo still requires its explicit
  environment flag.

### Action handoff

- The dashboard report read model now carries the current activation identity.
- Page assembly validates the current decision, prediction, activation, action, and normalized
  action-to-metric binding.
- The registered prediction remains the sole decision outcome.
- A supporting action may carry a different metric only as explicit monitoring-only, non-causal
  context.
- A pure page-assembly regression test proves that one primary action and one secondary-metric
  supporting action produce two handoffs, and both prepare successfully for Claude and Codex.

### Local verification

- Focused rollout, handoff, and project-view regression suite: **28/28 passed**.
- Complete library suite: **687 total; 621 passed; 66 intentional skips; 0 failed**.
- Full TypeScript and ESLint: **passed**.
- Dashboard request-bound build contract: **passed**.
- Next.js 16 webpack production build: **passed**.
- Browser: stale local `?flow=legacy` redirected to `?flow=decision-report`, the current
  challenge-first builder rendered, and the checked console had no warnings or errors.
- `git diff --check`: **passed**; `plugins/` remained untouched.

Hosted CI and production candidate/alias browser acceptance remain pending.

## Streamlined rollout contract

Future Causent releases should use the following sequence. Candidate creation, promotion, product
exposure, and customer acceptance are separate gates.

### 1. Establish authority and capture the baseline

- Confirm whether the request authorizes source edits, schema apply, worker deploy, application
  candidate creation, alias promotion, rollout mutation, and cleanup. Do not infer one from another.
- Record branch, exact commit/tree, worktree state, PR/check/review state, production alias target,
  known-good rollback deployment, database migration history, worker deployment IDs, and current
  rollout/exposure mode before mutation.
- Stop on unexpected source, migration, environment, alias, or rollout drift.

### 2. Publish one release manifest

For every candidate, record:

- source commit and tree;
- app candidate ID and immutable URL;
- database migration level and any phased rollout/backfill state;
- drift, recompute, and resolve worker deployment IDs;
- exposure mode: `off`, `allowlist`, or `default-on with explicit rollback`;
- target cohort and test identities;
- changed product contracts and downstream consumers;
- required browser scenarios and exact assertions; and
- verified rollback artifact and rollback order.

This can begin as a dated Markdown record. Automation may generate it later, but the fields must not
remain implicit across chat, Vercel, Supabase, and browser state.

### 3. Build a contract-and-consumer matrix

For each changed domain concept, list every reader and writer. A multi-metric action change must, at
minimum, cover:

- primary action on primary metric;
- supporting action on primary metric;
- supporting action on secondary metric;
- stale or foreign activation binding;
- missing or duplicated action/metric identity; and
- causal output remaining primary-only.

Every eligible current action must produce exactly one handoff and both provider targets. Historical,
stale, unbound, or unauthorized actions must produce none.

### 4. Test the exposure matrix

Run the real route through these states:

- authenticated enabled user;
- authenticated unassigned user;
- explicit disabled rollback user;
- assignment lookup unavailable;
- saved direct report under rollback;
- stale `?flow=legacy` URL; and
- fresh OAuth callback with no preexisting app cookie.

Do not let a local-only environment flag or pre-seeded rollout row stand in for the fresh-account
case.

### 5. Verify source before infrastructure mutation

Run the universal gates: focused tests, complete library tests, TypeScript, lint, schema/integration
tests when relevant, engine/bridge tests when relevant, dashboard contract, webpack production build,
and clean diff/plugin checks. Add change-specific contract tests before creating a candidate.

### 6. Activate infrastructure in dependency order

- Rehearse and apply additive database changes before code that requires them.
- Deploy immutable worker candidates and verify their exact configuration, authorization failures,
  bounded success, retry behavior, and logs before app promotion.
- Create an immutable application candidate without assigning the production alias.
- Never load demo seed or silently create product rollout assignments during schema activation.

### 7. Run authenticated candidate acceptance

- Use both a fresh account and an existing account.
- Exercise exact changed paths, not only a generic smoke test.
- For action lists, enumerate every row and assert each expected control by name.
- Record pre/post database counters and candidate logs so navigation-only actions cannot hide writes.
- Keep initially unassisted partner evidence separate from automated acceptance.

### 8. Promote, verify, and monitor

- Recheck candidate identity immediately before promotion.
- Promote explicitly; then prove the production alias points to the intended immutable deployment.
- Repeat the small authenticated smoke on the alias.
- Verify cron/worker health, error logs, exposure state, and the exact new-user route.
- Retain the known-good rollback deployment and commands until the observation window ends.

### 9. Roll back in the right order

- For an exposure defect, disable or narrow product rollout first when that is the fastest safe
  containment.
- Roll back the application alias second.
- Leave additive schema and append-only audit data in place unless there is an actual database
  incident; do not improvise down-migrations during an application rollback.
- Verify the alias, route, and audit state after rollback.

### 10. Close the release record

- Update `docs/STATUS.md`, `TODOS.md`, schema/design documentation, and a dated `memory/` report with
  exact source, infrastructure, acceptance, rollback, and remaining human gates.
- Record what is live separately from what is merged, Ready, deployed, promoted, enabled, or merely
  tested locally.
- Convert every escaped regression into a focused contract test and a rollout-skill rule.

## Prevention actions

| Action | Status |
| --- | --- |
| Make authenticated unassigned users current-by-default while retaining explicit rollback. | Complete locally |
| Add supporting secondary-metric handoff coverage. | Complete locally |
| Add a pure Actions-page assembly invariant for all eligible actions and both providers. | Complete locally |
| Document the exposure matrix and rollout state as release-manifest fields. | Complete in this postmortem and the installed `$HOME/.agents/skills/causent-production-rollout/` skill |
| Add the postmortem to the repo-native engineering context corpus. | Complete in `memory/`; linked from `docs/STATUS.md` |
| Deploy and repeat production fresh-account plus all-action acceptance. | Pending explicit release authorization |
| Make rollout repository tests assert the exact scope/user query instead of accepting any `.select()`/`.eq()` chain. | Follow-up candidate |
| Add database-to-page and rendered-control coverage for primary-metric support actions, secondary-metric support actions, duplicate identities, and forged role/lever combinations. | Follow-up candidate |
| Add PII-free operational reporting for eligible-action/handoff count mismatches. | Follow-up candidate |
| Automate generation of the release manifest from GitHub, Vercel, Supabase, and worker state. | Follow-up candidate |

## Rollout-skill forward test

A fresh agent used the installed rollout skill against the current worktree and correctly returned
`BLOCKED`, rather than treating local green tests as release authorization. It identified the dirty,
unreviewed artifact, the broad exposure-policy change, missing authenticated acceptance, incomplete
rendered-control coverage, and absence of a new immutable candidate and live alias proof. This is the
intended fail-closed behavior. The coverage gaps it found are recorded above as follow-up work; no
candidate, rollout assignment, deployment, database row, or Git state was changed during the test.

## Recurrence criteria

The incident is considered prevented only when a release candidate and the promoted alias both prove:

1. a fresh authenticated unassigned user lands on the current Decision Report builder;
2. explicit disablement and lookup failure still select legacy;
3. saved reports remain directly reachable during rollback;
4. every valid current primary and supporting action shows Claude and Codex controls;
5. supporting metrics remain visibly monitoring-only and never become independent causal outcomes;
6. navigation/copy actions do not change activation, telemetry, or recompute counters; and
7. source SHA, deployment ID, production alias, database level, worker IDs, and exposure mode match
   one reviewed release manifest.
