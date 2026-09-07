# T01–T04 implementation progress

## Contract

Worktree: `b3ce/causent`; branch: `codex/t01-t04-integrity`.
Baseline: `2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f`, verified against remote main on September 6, 2026.
Authorized: T01–T04 implementation, local verification, explicit-path commit, push, draft PR, hosted checks and actionable fixes. No merge, deployment, live migration, T05–T10 or P2 expansion. Original checkout and `06a8` reference implementation remain untouched. Morning target: September 7, 7am Pacific. The source task owns scheduling.

## Progress

- Read the overnight brief, technical review, prior broad implementation record, current status/backlog and CI contract. Read requested review-summary and applicable Supabase skills.
- Confirmed remote main is unchanged and PR #32 merged with successful CI and preview checks. Fresh worktree started clean and detached at that commit.
- Confirmed all four defects remain in source. Prior migration couples T01/T02 with deferred metric definitions and attribution; selectively reconstruct an independent contract.
- Shared Supabase stack exists at ports 54321/54322; prior broad test containers are stopped. Neither will be reset or modified. Create a separate disposable stack.
- Installed app dependencies match the lockfile; reuse them through a local symlink. Pinned Node 22.23 and Python 3.12 availability still being established.

## Next work

1. Implement independent trusted evaluation/read projection and bounded metric reads (T02/T01).
2. Implement canonical GitHub identities, alias reconciliation and targeted atomic batches (T03/T04).
3. Replay migrations, adversarial role/concurrency/API tests, full suites, typecheck/lint/build and browser acceptance.
4. Review scoped diff, produce engineering docs and editable/rendered review summary, commit/push/draft PR, then inspect exact-commit hosted checks.

## Evidence

Logs and acceptance matrix will be linked as checks complete. No implementation or verification gate is claimed passed yet.

## September 6 evening checkpoint

- Implemented independent evaluation authority and scoped manual-evidence path, immutable node/edge identity, SQL current-evaluation projection, complete bounded keyset readers, stable GitHub repository identity, explicit conflict counts, and legacy reconciliation.
- Generated `20260907035048_t01_t04_integrity.sql` with local schema pull; reviewed it into concise imperative SQL, restoring explicit ACLs and the data backfill omitted by schema differencing. No deferred measurement/tenancy migration copied.
- Disposable full Supabase stack: `/private/tmp/causent-t01-t04-stack`, project `causent-t01-t04`, API 56421, database 56422. Shared stack remains untouched. Node 22.23.0 and Python 3.12.14 used; NumPy 2.5.0 / psycopg 3.3.4 match worker pins.
- Initial full engine suite: **1290 passed**. Existing tests now accept `CAUSENT_TEST_DATABASE_URL`; new tests use actual database login identities rather than relying on owner SET ROLE for the authenticity assertion.
- Application suite after initial changes: **682 passed / 19 intentional live-model skips / 0 failures**. New keyset and GitHub regressions pass; typecheck and zero-warning lint pass at that checkpoint.
- New real-login/integration suite: **10 passed**, including both computation workers, ordinary-member denials, manual scope, immutable history, 1501 equal-timestamp evidence rows, overlapping imports, unrelated uniqueness failure, and legacy collisions.
- Real authenticated API test: **1501 observations imported and read completely**, with a positive control proving the API clips a plain query to 1000. Inclusive date windows and cross-workspace denial pass.
- Corrected two test/setup issues: engine tests must run from `engine/`; an unrelated uniqueness fixture needed to exclude pre-existing intentionally duplicate titles. Neither change weakened assertions.
- Corrected implementation setup: the first draft's nested private helper lacked schema access. Inlined the trusted-login check within invoker triggers instead of granting broad private-schema usage. Fixed the new advisor's auth initialization-plan warning.
- Next: fresh migration replay with legacy data, broader graph/API checks, full final local gate, browser acceptance, final review, documentation/artifacts, draft PR and hosted checks.

## Final verification checkpoint

- Legacy-data upgrade replay preserved action UUIDs, backfilled unresolved aliases, retained old evidence, and withheld unverified legacy readouts. No member ingestion RPC access or service-role evaluation insertion grant.
- Authenticated API regression now exercises **1001 graph edges** as well as 1501 observations; plain-query controls confirm the 1000-row cap. Exact manual belief 0.3 remains valid; values above it and conversion to ITS are rejected.
- Browser CSV import, all-history chart, current value/date, Actions/Impact/Reports and two-workspace switching verified. Screenshots inspected. Corrected the chart's omitted start year for multi-year histories. Browser uses local demo mode; authenticated API/role tests are separate.
- Initial production build and schema lint/advisor checks passed. Stopped the development server before final full build. Replaying the final migration and rerunning all local gates after the last changes.
- Optional document template picker was declined. Continue with the requested review-summary structure and a plain, polished document.

## Fresh database regression and correction

- Final authenticated API test initially failed at a 200-edge manual insert with SQLSTATE 57014. The combined scope-validation query built hashed subplans over every action. Replaced it with explicit point lookups under the same invoker/RLS contract; no timeout or test size was relaxed.
- The next run exposed the graph view's cold-statistics plan: 500-row page took 37.7 seconds and removed 500,500 rows in a node join, while automatic analysis later yielded a 0.139-second plan. These are diagnostic fixture measurements, not production benchmarks.
- Replaced node joins in the new view with parameterized one-row lateral lookups and added `(scope_id, edge_id)` for keyset traversal. Replaying from an empty disposable database before the full final gate tests the immediate post-import state.
- Worker configuration and stage-only bundles pass: drift 21 files, recompute/resolve 19 each; all compile and import with pinned worker dependencies. No worker deployment performed.

## Local acceptance complete

- Fresh final migration replay followed by demo seeding, all application/engine tests, zero-warning ESLint, TypeScript, load-contract tests, production webpack build and request-bound dashboard check all pass.
- Final application suite: **688 passed, 19 explicitly opt-in live-model skips, 0 failed** (707 tests). Full engine/DB suite: **1300 passed**. The actual authenticated 1501-observation/1001-edge test passes without relaxing the API timeout or reducing its 200-row write batches.
- Final schema lint has no errors; security/performance advisors report no issues. Stage-only worker bundles and configuration checks pass.
- Final diff review confirmed no statistical-model, recompute-cache, exposure, metric-definition, tenancy or deferred P2 changes. Added a UI regression proving canonical same-number PRs keep distinct UUID keys and readable labels. Existing demo deep links are preserved.
- Engineering implementation, acceptance matrix, operations/rollback guidance, read-only identity audit and four editable/rendered diagrams are prepared. Superseded setup logs were retained only in the temporary working folder; published evidence retains final results and material query-plan diagnostics.
- Rechecked remote main at `2c2b1bf`. Ready for explicit-path commit, push and draft PR, followed by exact-commit hosted verification and final document delivery.

## Pushed draft and hosted findings

- Implementation commit `98f8697e347a74fcf243eab5f502f9c9de6aacf6` pushed to `codex/t01-t04-integrity`. Draft PR **33** opened against main: https://github.com/Causent-AI/causent-ai/pull/33.
- Exact-commit CI run **34083916927 passed** all application, DB, engine, worker and build gates. Both Vercel preview build statuses are successful and their deployments are READY.
- Browser acceptance is more limited: `causent` preview fails because `NEXT_PUBLIC_SUPABASE_URL` is absent (confirmed by runtime log, not an inferred schema failure). `causent-ai` preview reaches sign-in without browser errors. No live/shared schema or environment mutation was performed. Authenticated hosted acceptance remains blocked on a separately configured/migrated preview environment.
- No actionable inline comments or submitted reviews were present. PR remains draft. A documentation-only follow-up records these results and will receive the same hosted checks.
- Final editable Markdown, DOCX, inspected render, diagram sources and native Google Doc are being delivered in the task artifact folder. This progress record is linked to `HOSTED_VERIFICATION.md`; the final artifact records the final PR head and document links.
