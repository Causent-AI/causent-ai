# Decision Report review round 1

## Baseline and scope

- PR #29 merged expanded Slice 10 into `main` as `690e196` with its hosted application/engine/RLS/bridge and Vercel checks green.
- Work continues on `codex/decision-report-review-round-1` without changing migrations, RLS, RPCs, Storage, or the explicit current-report contract.
- The partner-session gate remains open. This local product review is not evidence that a partner passed the five-part rubric.

## Implemented presentation changes

- Onboarding now leads with Project Description, optional URL/PDF inputs, two explicit sample reports, and provider authorization on the Generate action.
- The full report is a three-section document: Overview, Analysis, and Implementation Plan. It includes a planning-scenario visual and optional priority, tags, skills, time, and cost per action.
- Actions & Decisions has a Project Summary, exact-report edit link, execution metadata, blue evidence bullets, and a clearly manual Claude/ChatGPT/Codex copy/paste seam.
- Core Metrics starts closed, displays one chosen metric, and combines level bars with a zero-centered WoW/MoM change view.
- Data Workshop focuses on metric name, unit, connection, and import status. Impact places activated prediction context between the aggregate and the measured metric/action views.

## Full-loop fixture

`test-fixtures/gummy-alpha-full-loop.csv` contains 122 daily Adoption Rate observations from
2026-04-01 through 2026-07-31. Seventy-five points precede the 2026-06-15 intervention and 47 are on
or after it. Browser acceptance updated the active report metric, completed the active report action
on June 15, and drained the local queue with `scripts/run-local-recompute.sh`. Impact rendered one
confident current-report readout at +14.7pp and a current queue receipt.

The helper refuses every non-loopback `DATABASE_URL`. It is a reproducible local review path, not a
hosted MCP, worker deployment, or production automation claim.

## Verification

- TypeScript and focused lint pass.
- The serialized Node/Supabase/RLS/Storage suite passes with 483 tests and 19 intentional live-model skips.
- Schema error lint passes; the engine/bridge/isolation/recompute suite passes 1,210 tests.
- A clean Node 22 Next.js 16.2.11 webpack build and its dashboard manifest guard pass.
- Final browser acceptance confirms +14.7pp, percentage-point axes, the completed action, one Core Metrics control set, and zero console warnings or errors.
- `git diff --check` passes and this round contains no migration, RLS, RPC, or Storage change.

## Still human-only

- Finish the founder's first-round review and likely second UI/workflow review.
- Run three initially unassisted partner sessions and record the five-part rubric.
- Apply/configure Slice 10 in the partner environment, deploy the recompute worker deliberately, and run authenticated canaries only with explicit authorization.
- MCP/API authentication, provider OAuth, automatic context delivery, trusted write tools, and durable artifact attribution remain post-partner-review work.
