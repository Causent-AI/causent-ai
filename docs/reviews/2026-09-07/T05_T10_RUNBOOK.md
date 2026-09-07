# Registered measurement and customer workspace delivery

## Delivery boundary

T05–T10 are implemented on `codex/t05-t10-measurement`, based on merged PR #33 at `6ac65116d0cdd7a28bbc7331a1ca86c743025efd`. This branch is for a draft PR and review. No production schema, worker, application alias, customer membership or rollout flag was changed. P2 T11–T14 remain deferred.

## Product review

1. Use an authenticated member in an isolated customer workspace. Data Workshop now requires an explicit CSV metric definition: unit, percentage scale, desired direction, daily aggregation and population. A value of 0.5 declared as percentage points must display as 0.5%; declaring ratio produces 50%. Unconfirmed historical definitions stay unknown.
2. Activate a report against that metric. Register its observational plan in Data Workshop before exposure and before importing post-exposure observations. Set one coherent planned exposure date, a 45–180-day baseline, 0–30-day lag, a fixed 45–180-day post-period, an operational reference, population, concurrent-change assessment and a positive threshold in stored metric units. The plan is immutable; revisions require a new report iteration.
3. Record actual first and full exposure for every included action. Completion and merge dates remain separate. Staged or changed dates are valid records of what happened but cannot be estimated by this design. Unknown/concurrent changes also refuse attribution.
4. The worker waits until the day after the fixed UTC horizon, excludes lag days, and requires the complete daily window. One primary hypothesis belongs to the activation; unrelated historical actions do not expand it. A valid level change remains observational, including when statistically significant. No new result confirms individual work or AI contribution. Supporting outcomes remain monitoring context.
5. Review Actions, Impact, the resolution scorecard and exported handoff for the same metric definition and interpretation. Existing terminal prediction history is retained; it is not retrospectively re-registered or silently recomputed.

## Operator workspace contract

`scripts/provision-workspace.ts` calls service-only database functions. Supply credentials through a protected environment file; never include them in a report or command history.

```
node --env-file=<protected-operator-env> --experimental-strip-types scripts/provision-workspace.ts create <request-uuid> <existing-owner-uuid> <organization> <project> <workspace>
node --env-file=<protected-operator-env> --experimental-strip-types scripts/provision-workspace.ts archive <workspace-uuid>
node --env-file=<protected-operator-env> --experimental-strip-types scripts/provision-workspace.ts restore <workspace-uuid>
```

The create operation atomically writes an organization, project, workspace and owner membership. An exact request retry returns the same workspace; changed arguments conflict. The owner must already exist. This does not create credentials, send an invitation, configure an external provider or copy demo memberships. Current allowlist/authentication setup remains a separate operator step. Archive preserves readable history and removes active workspace selection while blocking ordinary and service-role connector source writes. It is not erasure or retention expiry.

## Verification evidence

- Application: 697 passed, zero failed, 19 optional live-model skips. This is a seeded local Supabase run; live model generation is not claimed.
- Engine: 1,315 passed, including actual authenticated/worker logins, separate organizations and database concurrency. The 21 focused measurement/tenancy checks cover a 250-action history positive control, fixed horizon wakeup, policy/data invalidation, lag, changed/missing exposure, viewer denial, exact operator retries and archived connector writes.
- Typecheck, zero-warning ESLint, production webpack build, dashboard request-bound route contract and load harness contract passed. Load harness contracts are not a throughput measurement.
- Fresh migration replay and upgrade from merged schema passed. The upgrade preserved a historical evaluation's manifest, hash, model version and timestamp; no metric definitions or measurement plans were invented. Error-level schema lint passed.
- Deployment bundles staged only: drift 22 files, recompute 20, resolve 20. All three imports passed. These are local package checks, not hosted deployments.
- Browser: real local Supabase session and RLS with a synthetic customer; submitted plan and actual exposure, inspected immutable saved state and explicit 0.5% display. A local password sign-in harness supplied the session. This does not validate production Google OAuth, hosted worker invocation, live provider ingestion, mobile layout or partner acceptance.

The pinned Supabase development image crashes in its optional permission-error hint formatter on some denied function calls (upstream `supabase/supautils#214`). Local tests and CI disable only `supautils.hint_roles` after reset; grants, RLS and denial assertions remain active. This is test-environment configuration, not a production migration. Before release, determine whether the target database has the affected extension version and rehearse denial behavior on an isolated hosted clone.

Reproducible repository gates use Node 22 and Python 3.12, a reset disposable Supabase instance and its credentials: `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm test`, `python -m pytest -q` from `engine`, `supabase db lint --local --level error`, `npm run build:webpack`, `npm run check:dashboard-build`, and `npm run test:load-contract`. Never point reset or synthetic tests at production. The CI workflow contains exact dependency installation and bundle commands.

## Migration and release sequence requiring later authorization

1. Review the draft PR and its exact-head CI. Rehearse on an isolated hosted database clone, including worker-role denials and an upgrade with retained data. Configure a review environment with the same schema and application/worker contracts; production data is unnecessary.
2. Apply `20260907053500_t05_t10_measurement_and_tenancy.sql` after the merged T01–T04 migration. It adds definitions, plans, exposures, provisioning receipts, archive guards and evaluation interpretation. It does not backfill semantic guesses or rewrite historical evaluation inputs. Existing metrics require explicit confirmation or a new defined metric before new registered measurement.
3. Coordinate schema, application and all three worker bundles while scheduled measurement writes are paused. Create immutable candidates, verify the dedicated worker identities, and test a real authenticated customer loop against those candidates. Validate mobile layout and external connector behavior before widening customer exposure.
4. Promote only after explicit release authorization. Check schema version, worker versions, app alias and user rollout independently. Retain the exact prior artifacts and release manifest.

Rollback is application/worker artifact restoration with measurement scheduling and customer exposure disabled as needed, while preserving the additive tables and immutable evidence. Do not drop history or automatically replay the old all-action statistical sweep. Restoring older presentation code can restore unsupported attribution labels; a rollback must keep those results unavailable until reviewed. No destructive down migration is supplied.

## Runtime and logging

TypeScript/React execute the forms and presentation; Next.js server actions use a verified Supabase session. PostgreSQL stores contracts and applies RLS, invoker checks, immutable triggers and current-pointer validation. Python workers run NumPy segmented OLS/HAC and persist an evaluation plus evidence atomically under existing trusted computation identities. No new runtime dependency is added.

Each manifest stores consumed observations as exact float encodings, definition, plan, actual exposures, included actions, primary family, policy, source digest, Python/NumPy versions, architecture and BLAS identity. Hashes may differ across worker bundles or runtime builds; old runs remain queryable. This is input/runtime provenance, not a promise of bitwise equality across hardware.

Queue receipts retain activation, requested/processed generations, input hash, attempts, next attempt, processing time and sanitized error/refusal code in the private job table. Worker HTTP/cron logs retain their existing bounded outcome counts and class-only errors. The new plan/exposure forms add no free-text application logging; references and population are stored in the scoped database. The operator command writes operation, workspace ID and request ID to operator stdout, without credential values. Provisioning receipts are private. No new remote log sink or telemetry vendor is introduced.

## References

- [Plan and acceptance matrix](T05_T10_PLAN.md)
- [Progress record](T05_T10_PROGRESS.md)
- [Source technical review](../2026-09-06/reference/TECHNICAL_REVIEW.md)
- [Engineering handbook](../../ENGINEERING.md)
- [Approved Decision Report design and product requirements](../../designs/ai-assisted-decision-report.md)
- [Prospective prediction loop](../../designs/prospective-prediction-loop.md)
- The technical review's **Order of work** is the recommended task sequence; it does not supply a dated schedule. The current plan's September 7 handoff is the delivery target for this authorized batch.
