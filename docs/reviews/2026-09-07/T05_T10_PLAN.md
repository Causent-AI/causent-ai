# Remaining P1 implementation plan

## Authority and baseline

The user requested the same overnight process as T01–T04, with planning, build and test phases in this task and a morning engineering review. Scope is T05–T10; P2 findings remain deferred. Target handoff: September 7, 2026, 7am America/Los_Angeles. This is a delivery target, not a claim of completion.

PR #33 is merged as `6ac65116d0cdd7a28bbc7331a1ca86c743025efd`. Work begins at that exact `origin/main` commit on `codex/t05-t10-measurement` in `/Users/adamowens/.codex/worktrees/b3ce/causent`. The tree was clean. The earlier broad implementation at `/Users/adamowens/.codex/worktrees/06a8/causent` is read-only reference; its coupled T01–T10 patch and test results are not acceptance for this branch.

Authorized delivery: scoped implementation, disposable local database tests, browser checks, explicit-path commits, push, draft PR, exact-head hosted CI/preview verification, and editable engineering report. No merge, production migration, live configuration change, worker deployment, production promotion, or customer provisioning is included. Existing shared local databases and unrelated work remain untouched.

## Product and scientific contract

Support a versioned, prospectively specified observational measurement around one coherent documented exposure. A numerical time-series break is an observational estimate; significance alone cannot identify the effect of a PR, an entire staged package, or AI assistance. Missing or unsupported design inputs produce an actionable cannot-attribute state. Do not invent controls, exposure evidence, metric definitions, or historical registration.

Retain the report-native workflow, explicit user activation, scope isolation, immutable evaluations, canonical source identity, and conflict-safe ingestion added by T01–T04. Reuse existing dependencies. New controls must fit existing Data, Actions, and report flows rather than creating a parallel product.

## Plan phase

1. Revalidate T05–T10 against merged source, current design/PRD, deployment contracts and tests. Trace every changed contract from input and persistence through computation, presentation, resolution and handoff export.
2. Inspect the earlier implementation for reusable bounded components and failure cases. Record differences from the stronger merged T01–T04 contracts before adaptation.
3. Write the acceptance matrix and migration/rollback sequence before changing schema. Read installed Next.js guides and applicable Supabase/Postgres guidance.

## Build phase

| ID | Required behavior | Key acceptance |
|---|---|---|
| T08 | Immutable explicit metric definitions: unit, percentage scale, denominator/population, aggregation, daily timezone and desired direction. Confirmation during import/selection; consistent display, prediction and export. Legacy unknowns remain unconfirmed. | A 0.5 percent-point series and 0.1-point lift remain 0.5% and +0.1pp; ratio inputs convert only when declared; unknown desirability stays neutral; definitions cannot be silently edited. |
| T09 | Evaluation identity covers consumed observations, metric definition, intervention/exposure, hypothesis family, method/configuration, policy and code/runtime version. Preserve superseded results. | Identical inputs and version skip safely; changed code/config/definition/exposure does not reuse an old result; failed/stale generations do not replace current evidence. |
| T05 | Define a frozen bounded family and analysis window before fitting. Unrelated workspace history must not exhaust the 200-action engine bound. Preserve multiplicity semantics; never split independent batches to evade correction. | More than 200 unrelated actions do not break an eligible primary evaluation; undeclared targets and oversized unsupported families fail explicitly; deterministic family identity. |
| T07 | Store planned and actual first exposure, rollout/coherence, completion and lag separately. Baseline ends before first exposure, with the lag excluded. GitHub merge is not fabricated customer exposure. | Coherent exposure can evaluate; staged/missing/mismatched exposure refuses; earlier treated days cannot enter baseline; prospective registration cannot be backdated over observed outcomes. |
| T06 | Distinguish observational measurement from causal attribution. State estimand, horizon, decision threshold and concurrent-change assumptions; preserve unsupported/cannot-attribute outcomes throughout the UI and resolver. | External-shock counterexample cannot become a causal success solely through significance; no unsupported work/AI-effect claims in display or exports; supported data still yields an explicitly observational estimate. |
| T10 | Discover real workspaces from membership and RLS; keep fixture restriction only in explicit local demo mode. Operator provisioning creates isolated organization/project/workspace/owner atomically and idempotently; scoped connectors and lifecycle respect membership. | Two separate organizations, arbitrary workspace IDs, membership removal, viewer denial, tampered/stale selection and provisioning retries; archived state handled explicitly without claiming data erasure. |

Build order: definitions and identity foundation, measurement plan/exposure/family, worker and UI propagation, then customer discovery/provisioning. Changes may be split into owned commits but must form one reviewable branch.

## Test phase

- Use a new independently named local Supabase stack and pinned Node 22/Python 3.12 toolchains. Never reset or migrate shared/production databases.
- Reproduce each material defect and include positive controls. Run complete application and engine suites with real database roles, RLS, fresh migration replay and upgrade from the merged schema. Do not inherit broad-reference test counts.
- Exercise authorization with actual member/worker logins, across distinct organizations. Verify old evidence retention and exact current evaluation semantics.
- Run type checking, zero-warning lint, production webpack build, dashboard contract, applicable load contracts, schema lint/advisors, and worker bundle checks. Avoid unnecessary reruns after passing unchanged gates.
- Exercise real form submissions and the new product path in the browser, including a mobile viewport. Mock rendering alone does not establish acceptance. Keep authenticated/local-demo/hosted results distinct.
- Review the final diff and fix actionable findings, then push a draft PR. Verify hosted CI and preview build results on the exact head; retain the known preview configuration/authentication limitations as unresolved unless actually verified.

## Engineering review and morning handoff

Use `adam-review-summary`: Overview → Executive Summary (exactly one outcome per T05–T10) → Next Steps → Analysis (including Build and verification method) → Appendix. Include one editable diagram per task, changed schema/product boundaries, runtime/logging inventory, acceptance evidence, reproducible commands, migration/backfill/rollback guidance, PR and exact commit references, and the source technical review.

Deliver editable Markdown, rendered and page-inspected DOCX/PDF, and diagram sources in a review package. Native Google Docs import is best-effort through the supported connector; prior import/approval failures must not block local delivery or be reported as success. Do not change sharing.

Maintain `T05_T10_PROGRESS.md` with completed work, next steps and evidence. Continue this task through the existing hourly heartbeat. Notify only on completion, failure or required user action. At completion or 7am Pacific, provide the actual result, unfinished acceptance and blockers, then pause the heartbeat. Leave any incomplete PR draft.
