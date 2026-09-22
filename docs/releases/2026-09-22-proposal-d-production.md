# Proposal D production rollout

Status: implementation in progress. Google Analytics remains disabled.

## Authority and baseline

The owner requested the approved Proposal D design in production, preserving the backend and deferring Google Analytics. This authorizes implementation, checks, a release PR, candidate deployment and production rollout. Production data is preserved; acceptance uses isolated synthetic records.

- Branch: `codex/proposal-d-production`, based on merged main `9dcc20b5c74ae0633f88fe077aacec6c93ed2638` (#37).
- Live baseline: `app.causent.ai` → `dpl_8erw9kJrgjcWyo5CqpFy5cCYxDoD`, source `9dcc20b`.
- Database: `royftsqyawtyfjolfabd`, 47 migrations. Existing workers from `906dd7a` remain.
- Exposure: existing authenticated default-on with explicit rollback; no assignment changes planned.
- Preserve unrelated untracked `docs/reviews/2026-09-07/ui-proposals/d/evidence/ai-instances-desktop.png` and `plugins/`.

## Build plan

1. Shared branded shell: five pill tabs, folder/title synchronization, compact blue Create, yellow Ask, bottom Core Metrics and regular typography.
2. Pageless reports and onboarding: existing protected persistence, section naming/addition, paragraph tools, charts, metric selection, impact commitments and editable draft actions. Active decisions retain immutable version history.
3. Data Workshop: Metrics, Connections and AI; AI contains Connections, Harnesses and Cost. Keep unsupported providers visibly unconnected and GA4 disabled.
4. Decision Network: real authorized project/decision nodes, linear dates, metric/period filters, zoom/pan and decision details. Never sum decision lifts into invented portfolio impact.
5. Preserve Actions handoffs, completion/PR context and existing Impact models; keep all backend authorization and measurement contracts.

## Verification and release

Run focused contract tests, complete app/engine/integration gates, typecheck, lint and production build. Inspect desktop/mobile UI and real authenticated candidate flows with both existing and fresh accounts, two metrics, supporting actions and every Claude/Codex control. Compare navigation counters and existing-data digests. Publish concise PR/docs evidence, confirm the exact candidate, promote, verify the live alias and signed-in pages, and retain the baseline rollback artifact. Google Analytics provider acceptance remains deferred.

## Local evidence

- Application/integration: 731 passed, 19 optional paid-model tests skipped. All database cases ran against the isolated 47-migration stack; no database skips. The saved-layout metadata round trip is covered by the append-only persistence integration test.
- Engine/RLS/bridge: 1,338 passed against the same isolated database.
- Focused document/graph/source-link contracts: 36 passed. Types, lint, 12 prototype and 15 load-contract tests pass.
- Browser: actual saved report opens in the pageless editor; title-to-folder sync, section rename, note addition and observation chart survive reload. Graph filtering, keyboard node details and zoom work. Phone onboarding at 390px revealed a navigation overflow; compact icon tabs with accessible names fix it.
- Compatibility: the exact PR37 report validator accepts and preserves the additive top-level `documentLayout` field. Existing rich-text `presentation` stays unchanged. No database migration or worker redeployment is needed.
- Scope: custom harness/runtime persistence, automatic partner execution and combined portfolio attribution remain future backend work and are visibly unconfigured. Existing manual handoffs and default Impact models are retained.

[Engineering review](../reviews/2026-09-22/PRODUCTION_DESIGN_REVIEW.md).

- Final local schema lint passed. The clean Node 22 webpack build and dashboard manifest check passed for all six authenticated routes, including Graph and onboarding; PDF worker files are traced in both report entry points. Reusing an old Next.js cache caused the first build failure; a clean generated cache resolved it.
- Phone checks at 390 × 844: onboarding input, navigation, Core Metrics drawer, AI tabs and task-cost calculation pass; document and main width remain 390px. Temporary viewport override reset afterward.
