# Causent latest editor release manifest — 2026-08-19

## Authority

- Authorized source changes: package the current local Decision Report onboarding and per-action
  handoff corrections, plus their tests and documentation.
- Authorized Git/PR changes: commit and push the exact reviewed tree to
  `codex/production-release-hardening` and update PR #32.
- Authorized database changes: none; this is an application-only release.
- Authorized worker deployments: none; retain the promoted drift, recompute, and resolve workers.
- Authorized app candidate: create an immutable production-environment candidate after the source
  gates and hosted CI pass.
- Authorized alias promotion/rollback: promote only after the authenticated candidate matrix passes;
  retain the verified immutable rollback artifact.
- Authorized exposure change: `default-on-with-explicit-rollback` for authenticated users. Enabled
  and unassigned users receive Decision Report; explicit disabled and lookup-unavailable states
  receive legacy; saved report links remain reachable.
- Authorized membership, rollout-row, seed, and production-data changes: none.

## Source baseline

- Repository: `Causent-AI/causent-ai`.
- Checkout: `/Users/adamowens/.codex/worktrees/92da/causent`.
- Branch/upstream: `codex/production-release-hardening` ->
  `origin/codex/production-release-hardening`.
- Baseline commit: `e6daa2df4afd71f4a95e34bcf9771d1fff561db5`.
- Baseline tree: `3a0037d5237e55f61335c025152b8986341fcde1`.
- Baseline `origin/main`: `33760eef3eaed80a88d90364d67904475259aee2`.
- Dirty scope before release: twelve tracked files plus
  `memory/2026-08-19-onboarding-action-handoff-rollout-postmortem.md` and this manifest.
- Local development server: port 3100 is running from this exact checkout, not the older main
  checkout at `/Users/adamowens/Code/causent`.
- PR #32: open draft, clean/mergeable, with green checks only for baseline commit `e6daa2d`; those
  checks do not cover the pending source.

## Production baseline

- App alias: `app.causent.ai` -> `dpl_8twnZ3dwtahoCF6tLiejEFgMJCUL`, Ready, production target.
- Current app source: `85860dc7756ca6d5f83b8aab539ac7c89d9765e3`.
- Verified containment rollback: `dpl_FCGWhLDt7oZsMp1preohuNt1gTww`, Ready.
- Supabase project: `royftsqyawtyfjolfabd`, 42/42 local/remote migrations matched on the pre-release
  read-only migration-list check.
- Drift worker: `dpl_5a5BFfP86YxCjWGBhMX3Z3iF64po`.
- Recompute worker: `dpl_2PAG63un8RvuXTDAyCJYMyGCYKFK`.
- Resolve worker: `dpl_2pra4r5dHLiPvPpKP92Qk8ojphMM`.
- Existing product exposure: one controlled enabled row plus the older application policy that sends
  unassigned users to legacy.
- Target product exposure: authenticated unassigned users become current-by-default; explicit false
  rows and assignment lookup failures retain the legacy rollback path.

## Changed contracts and consumers

### Onboarding exposure

- Producer: exact scope/user lookup in `decision_report_rollouts`.
- Contract: explicit `enabled | disabled | unassigned | unavailable` state.
- Consumer: `/onboarding` server route and canonical query redirect.
- Required matrix: enabled, unassigned, disabled, unavailable, saved direct report, stale
  `?flow=legacy`, and fresh OAuth with no Causent workspace cookie.

### Multi-action handoff

- Producer: current report activation plus normalized action-to-metric binding.
- Contract: the registered prediction remains the only causal outcome; supporting action metrics are
  monitoring-only context.
- Consumers: Actions page assembly and the Claude/Codex manual handoff dialog for every eligible
  current action.
- Required matrix: primary action on primary metric, supporting action on primary metric, supporting
  action on secondary metric, and missing/duplicated/stale/foreign bindings.

## Required evidence

- Focused rollout, handoff, and report-project tests.
- Complete library suite, TypeScript, full zero-warning lint, load-contract tests, dashboard build
  contract, Next.js 16 webpack build, clean diff, and untouched `plugins/`.
- Fresh hosted CI and Vercel checks on the final pushed commit.
- No Supabase migration or worker deployment; recheck 42/42 and the promoted worker identities.
- Immutable application candidate public/auth redirects and empty error logs.
- Authenticated candidate acceptance: create/autosave/reload/direct-open a report; select two metrics;
  include primary and support actions; assign the support action to the secondary metric; assert one
  Claude and one Codex control on every eligible action; verify monitoring-only language; and verify
  Data, Reports, Actions, and Impact continuity.
- Pre/post counters proving action navigation and clipboard preparation do not activate again or kick
  recompute.
- Mobile interaction and clean browser console for the changed screens.
- Alias identity proof and the smallest repeated authenticated acceptance after promotion.

## Open gates that this release does not convert to passes

- External staging session broker and protected load evidence.
- Initially unassisted partner validation.
- Terminal causal resolution before the real due date and observation floor.
- Private-image and provider-specific connector production canaries unless explicitly completed in
  this release.
- Supabase leaked-password protection and any later primary database-password rotation.

## Release progress

- Baseline captured: complete.
- Local focused tests: 28/28 passed before the final release commit.
- Complete library suite: 687 total; 621 passed; 66 intentional skips; 0 failed.
- TypeScript, zero-warning lint, load-contract 15/15, Next.js 16 webpack build, dashboard contract,
  local stale-query redirect, 390 px layout, clean new-tab console, diff check, and plugin check:
  complete.
- Final release commit/push: authorized; exact result is recorded in the Git/PR evidence.
- Hosted CI: pending on the final commit.
- Immutable app candidate: pending.
- Authenticated candidate acceptance: pending.
- Alias promotion: pending.
- Post-promotion acceptance: pending.

## Verdict

`BLOCKED` until the final source gates, hosted CI, immutable candidate, and authenticated fresh-user
plus all-action acceptance pass. A Ready deployment alone is not promotion evidence.
