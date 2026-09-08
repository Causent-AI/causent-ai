# T05–T10 overnight progress

## 2026-09-07 05:35 UTC — plan established

- User confirmed one task with separate build/test phases, same overnight process and engineering review style as T01–T04.
- Verified PR #33 merged as `6ac65116d0cdd7a28bbc7331a1ca86c743025efd`; fetched main and created `codex/t05-t10-measurement` from it in the existing isolated worktree.
- Read technical review, earlier implementation record, current backlog, engineering review skill and prior overnight brief. T05–T10 are now in scope; all P2 remains deferred.
- Preserved earlier broad implementation and shared databases. Stopped the owned T01–T04 review app before switching branch; its isolated sample database remains intact.
- Plan and acceptance matrix: `T05_T10_PLAN.md`. No implementation changes, tests or new completion claims yet.

Next: inspect actual T05–T10 producers/consumers and earlier reference differences; establish isolated test database; implement explicit definitions/measurement identity foundation and downstream flows. Read current progress before any scheduled continuation.

## 2026-09-07 05:51 UTC — build foundation

- New branch: `codex/t05-t10-measurement`; disposable Supabase `causent-t05-t10` uses ports 57420–57429. Shared and prior review databases remain untouched.
- Implemented explicit immutable metric definitions and import confirmation, removed percent-magnitude and business-direction guesses from selected display/prediction paths.
- Implemented RLS-backed customer workspace discovery, exact operator provisioning receipts and archival write boundaries.
- Trial T08/T10 DDL compiles in the disposable database; migration is still being assembled and has not been recorded as a final replay.
- 21 focused application checks passed; typecheck passed. New real member/operator tenancy tests written but not yet run. Full app/engine/security/build/browser suites pending.
- T05/T06/T07/T09 measurement plan, exposure, worker evaluation identity and interpretation work remains. No commit, push, PR, deployment or production migration.
- Local environment and launchers (secrets excluded from artifacts) are under `/private/tmp/causent-t05-t10-tools`; tests must target port 57422.

## 2026-09-07 06:09 UTC — integrated build under verification

- Added prospective plans and actual exposure records, bound to immutable activation/primary metric. Registered windows exclude lag days; unsupported or incomplete contracts produce typed refusal/waiting states.
- Live recompute and resolution now use the registered family and runtime/data/definition/exposure manifest. One valid outcome with 250 unrelated actions passes. Statistical detection remains observational; resolution never confirms work or AI attribution.
- Added editable Data Workshop plan/exposure forms and explicit observational/refusal displays. Legacy scientific sweep remains explicitly named for historical/demo audit tests only.
- Customer provisioning/member separation tests: 5 passed. Registered measurement tests: 13 passed with real worker logins. Full engine last completed run: 1310 passed, 2 compatibility expectation failures, since corrected; next full run pending.
- App database-enabled run: 688 passed, 1 import fixture failure, since corrected; 23 skips (19 optional live model calls; 4 legacy demo scorecards without seed). Typecheck and ESLint passed before final presentation/packaging edits. Final suite still pending.
- Local Supabase image hit documented permission-denied hint SIGSEGV (supabase/supautils issue 214). Disabled only `supautils.hint_roles` in disposable container configuration and restarted that container. RLS and privileges remain enabled; actual denial tests then passed. Missing service-role USAGE on private provisioning schema fixed in migration.
- Worker deployment scripts now include the new measurement module. No deployment performed. Need stage-bundle verification, full fresh/upgrade replay, browser acceptance, final review, draft PR and engineering artifacts.

## 2026-09-07 06:25 UTC — local acceptance passed

- Final engine suite: 1,315 passed. Seeded application suite: 697 passed, zero failed, 19 optional live-model skips. Twenty-one focused measurement/tenancy tests include real member/worker logins, viewer denial, separate organizations, archived service-role connector writes and a fixed-horizon queue wakeup with no busy loop.
- Fresh replay, merged-schema upgrade and error-level schema lint passed. Historical evaluation manifest/hash/model/timestamp were unchanged; zero invented definitions. Reset restores the Supabase hint bug; the CI/local workaround now runs after reset and disables only permission hints. Actual denials remain tested.
- Typecheck, zero-warning ESLint, webpack production build, dashboard route and load harness contracts pass. Staged worker imports pass with 22/20/20 files for drift/recompute/resolve.
- Real authenticated local browser submitted a prospective plan, saved actual exposure and showed explicit 0.5-point data as 0.5%. The synthetic sign-in harness is not Google OAuth/provider acceptance. Desktop inspected; mobile remains unverified.
- A local production-server probe correctly rejects localhost Supabase and development flags under the existing release gate. No production configuration guard was relaxed. The successful browser mutation run used development mode with real local Supabase authentication.
- Final diff reviewed; runbook records contracts, omissions, upgrade and rollback. Next: explicit-path commit/push, draft PR, exact-head hosted checks, then editable illustrated engineering report. No merge or release.

## 2026-09-07 06:41 UTC — browser findings corrected

- Draft PR #34 opened at bc98e2169eea8323711767fa5a37c45f2de2c155; hosted CI 34090969877 and both Vercel preview builds passed for that initial commit. Preview access redirects to Vercel SSO.
- Full browser loop exposed old causal/contribution labels, an unknown-scale fallback, and workspace summary aggregation that bypassed the new definition/provenance gate. Corrected those paths; distinct registered windows are no longer summed as a net effect. Unknown direction remains neutral in summary/export cards.
- Completed both synthetic actions through the real UI, processed only that fixture's worker job, and verified the changed-exposure refusal in Impact. Fixed successful scientific refusals appearing as exhausted retries; error codes now mean worker failures, while scientific reasons remain on immutable evaluations.
- Final local app suite: 702 passed, 19 optional live-model skips, zero failures. Engine: 1,316 passed. Typecheck, zero-warning lint, webpack/dashboard build, diff check and refreshed 22/20/20 worker imports pass. Schema is unchanged from the fresh/upgrade-verified migration.
- Next: commit/push these review fixes, verify the new exact head, finish the illustrated engineering report and pause the overnight heartbeat. Production and mobile/provider acceptance remain separate.
