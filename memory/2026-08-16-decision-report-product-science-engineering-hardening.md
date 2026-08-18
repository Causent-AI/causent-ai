# Decision Report product/science/engineering hardening — 2026-08-16

## Why this round exists

The founder selected concrete responses from the product-manager, data-scientist, and engineering
reviews after the two-canvas/multi-metric UX pass. This round implements those choices without
claiming that the missing partner evidence, staging capacity, production migration, or deployment
gates passed.

## Product contract

- One footer advances through **Finish report -> Set commitment -> Start an action**.
- The commitment chart follows the current primary metric and activation draft.
- The complete default-included action/metric plan is visible before Start.
- Report-native Actions retains outcome, commitment, resolution, registered primary action, state,
  and Data/Impact paths.
- Global navigation remains **Data -> Reports -> Actions -> Impact**.

## Scientific contract

- Current-report selected metrics and action bindings come only from normalized activation audit
  relations; inconsistent state fails closed.
- The stored prediction remains percent-of-mean. Native baseline/delta/target are transparent derived
  displays, not another prediction.
- Metric readiness is descriptive and leaves the 45-day-per-side ITS floor unchanged.
- Supporting bindings may store monitoring direction/check date but are not causal predictions.
- For a multi-action activation, all included actions must complete before causal measurement. The
  included action with the latest effective completion date becomes the **Decision package**
  intervention while the originally registered primary action remains preserved. Immutable report
  order breaks same-day ties; completion-entry order is irrelevant.

## Engineering contract

- Drift is asynchronously materialized; dashboard reads no longer spawn Python. Hosted drift worker
  configuration/deployment is pending.
- CSV imports are capped at 2,000 rows and resume through digest-bound 250-row receipts.
- Verified GitHub/Jira events enter a transactional service-only inbox with retry/dead-letter state.
- Authorized private images redirect to 60-second signed Storage URLs after exact metadata checks.
- Hot-path indexes and authenticated plan scripts were added.
- Multi-metric rollout is split into expand, bounded backfill, validate, and contract phases with a
  production online-index runbook.
- A guarded k6 staging matrix and deterministic scale-fixture planner define initial SLO checks but
  have not produced staging or capacity evidence.

## Explicitly deferred

- Unbounded dashboard/history read-model replacement.
- Production automatic causal-recompute capacity and instrumentation.
- Separate-tenant production provisioning.
- MCP/provider synchronization until after partner review.
- Any production migration, deployment, or 10,000-active-users/hour claim.

## Resume / verification state

The exact local combined gate passed on 2026-08-17: clean reset; warning-level schema lint with four
pre-existing advisories; TypeScript; full ESLint; 641/660 Node tests passed with 19 intentional
live-model skips; all 1,251 Python tests passed; authenticated deterministic-fixture EXPLAINs; a
1.19 GiB fixture plan; Next.js 16.2.11 webpack build and dashboard guard; and desktop/390 px browser
acceptance with an empty warning/error console. The browser pass activated Northstar from a support
action while preserving the registered primary, verified two metric bindings and all four product
tabs, and caught/fixed a collapsed Actions commitment card plus sub-44 px mobile links.

Still pending: protected staging load artifacts, representative-volume plans, production-clone
migration rehearsal, publication/hosted CI, production worker/secrets configuration, migrations,
deployment, canaries, founder sign-off, and the unassisted partner sessions. The local result is not a
10,000-users/hour capacity claim.

Detailed decision/evidence map:
`docs/reviews/2026-08-16-product-science-engineering-hardening-follow-up.md`.
