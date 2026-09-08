# T11–T14 verification and release runbook

## State and scope

Baseline: merged PR #34, `dd1901db247d5ca824d0a8419497d94113d13127`. Changes include the application, recompute worker, and two additive migrations. Local integration used the existing isolated `causent-t05-t10` stack on ports 57420–57429. Its synthetic data and local credentials were retained. No production operation was performed.

## Verification checkpoint

| Check | Result |
|---|---|
| Node application suite, Node 22.23.0 | 710 passed, 19 optional live-model skips, 0 failures |
| Full Python 3.12 engine suite | 1,324 passed, 0 failures |
| New P2 database tests, included above | 8 passed; real connections and locks |
| TypeScript and ESLint | Passed; zero warnings |
| Load harness contract | 15 passed; this is not a load run |
| Schema lint, Supabase CLI 2.98.1 | Passed at error level |
| Webpack production build and dashboard build contract | Passed |
| Staged changed recompute worker | Import passed |
| Final new migration definitions | Clean replay in a transaction, then rollback, passed |
| Authenticated local UX inspection | Desktop and phone captures; interactive proposal checked at phone/tablet/desktop |

The migration replay recreated only the two new migrations' objects within a rolled-back transaction. It did not reset all historical migrations in this turn or advance production migration history. Hosted CI performs the fresh disposable reset and all three worker bundle checks. The local Supabase image still requires optional permission hints disabled for upstream `supabase/supautils#214`; grants and RLS denial tests remain active.

From a disposable Supabase test environment, load its local credentials without printing them and run:

```bash
# Node 22; the env file must contain disposable local credentials.
node --env-file=.env.local --test --test-concurrency=1 'lib/**/*.test.ts'
npm run typecheck
npm run lint -- --max-warnings=0
npm run test:load-contract
npm run build:webpack
npm run check:dashboard-build
supabase db lint --local --level error
```

From `engine`, using Python 3.12 and the disposable database URL selected by the test environment:

```bash
python -m pytest -q
```

See [CI](../../../.github/workflows/ci.yml) for exact dependency, reset, environment, worker-bundle, and no-integration-skip gates. Local full logs are ignored under `.local-review/verification/p2-*`; the table above is the sanitized durable summary. Earlier failed attempts were an unsupported `NODE_OPTIONS=--env-file` invocation and a repeat-run webhook fixture collision; corrected commands and unique fixture identity passed.

## Generation policy and operations

`20260908070000_generation_admission.sql` creates private budgets/receipts and service-only admission/state functions. Defaults: $20 reserved per organization per UTC day, $2 per paid request, three occupied organization slots, one per actor across organizations, ten starts per minute, three-minute occupancy. Reviewed fixtures reserve zero but still obey request/concurrency limits. Failed, cancelled, expired, fallback, and retry attempts receive no reservation refund.

The model allowlist accepts `anthropic/claude-sonnet-5`. The 300 KB serialized prompt/instructions/schema limit plus a 16K provider envelope, two maximum attempts, and 2,200 output tokens per attempt fit beneath the $2 reservation using a conservative $3/$15 per million input/output assumption. This is a budgeting envelope, not current invoice reconciliation. The [Vercel model announcement](https://vercel.com/changelog/claude-sonnet-5-ai-gateway) supports that conservative reference rate. A model, pricing, retry, or input-limit change requires reviewing the envelope and matching SQL allowlist; an unknown model fails closed.

Database owners can configure an organization's limits through an audited operator session. There is no customer budget settings screen. For example, with a verified organization ID bound as a SQL parameter, upsert `private.generation_budgets(org_id,daily_microusd,concurrency,requests_per_minute)`. Do not grant general table access to expose this control. Setting `daily_microusd=0` denies new paid requests; existing requests and completed replay remain possible. Provider billing controls are separate defense and were not inspected.

Requests contain private generated text and source receipts. Source capabilities expire after 24 hours; replay then requires a new request. No automatic receipt retention job or invoice reconciliation is implemented. Before broad operation, choose and implement a retention policy: expired result payloads can be cleared while retaining identity, digest, reservation, and status tombstones to prevent request-ID reuse. Do not delete the current day's reservations or refund uncertain provider work. Model-call cancellation is best effort; occupancy persists through the original lease when upstream completion is uncertain.

## Resolution and timing operations

`20260908071000_resolution_fairness.sql` creates `private.resolution_dispatch` and service-only claim/finish functions. Inspect its current attempt timestamps, failure counts, safe error codes, and retry times for operational diagnosis. A missing member is retried after an hour; restore valid membership before its next attempt. Transient failures retry with bounded backoff. Expired or mismatched claim receipts cannot complete newer work. Rows are per-workspace current state, not an event archive.

Recompute timing appears in authorized worker responses and the `causent.recompute` runtime logger. Ensure deployment logging captures info if routine sub-second samples are required; calls at or above one second use warning. The local sample was approximately 86.377 ms upper-bound duration, including 37.021 ms input loading and 43.156 ms analysis/write. It is one fixture, not a representative distribution.

Proposed engineering triggers: investigate a representative p95 lock upper bound of at least one second, or measured user-write blocking of at least 250 ms. These are proposed operating targets, not validated service objectives. If reached, design a leased claim, immutable input snapshot, computation outside the write transaction, and short compare-and-swap commit of the still-current generation. Prove stale-output discard and atomic evidence identity before replacing the current transaction.

## Release order and rollback

1. Verify the submitted commit's CI, target migration history, backups, and application/worker baseline. Rehearse the pending set in a disposable copy of that actual baseline; T05–T10 dependencies must already be present or included in the rehearsal.
2. Apply the two migrations through the normal serialized schema process. They require no report backfill and do not alter existing active commitments. Confirm private RLS, denied direct table access, fixed function search paths, and only intended service execute grants.
3. Deploy an immutable recompute worker candidate and application candidate. The resolve worker protocol is unchanged; the app's dispatcher owns the new leases. Test generation replay/cancel/denial, a failed workspace followed by valid resolution, History states, and authorized timing output.
4. Promote only within a separately authorized release. Verify the same narrow acceptance afterward. Source merge alone does not apply database migrations or establish authenticated acceptance.

Rollback the application and recompute worker to their recorded known-good artifacts if acceptance fails. Keep the additive tables/functions and audit receipts; the previous app can ignore them. Rolling back generation admission removes these new application-level limits, so pause paid generation through an independently verified existing operator control if continued paid work is undesirable. Do not drop receipt tables, reset queues, or invent an unverified kill switch as part of rollback. Destructive schema removal requires a separate dependency and data-retention review.

## Remaining product evidence

T11 representative capacity, T13 invoice/value metrics, and T14 prospective recommendation acceptance, decision change, calibration, utility, and comparable-mechanism transfer remain open. Existing History values are descriptive. UX implementation and Word/PDF export remain proposed. The [UX review](UX_REVIEW.md) supplies scope, screenshots, and acceptance criteria for the next design phase.
