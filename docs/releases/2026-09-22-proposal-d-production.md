# Proposal D production rollout

Status: PR #38 candidate verification in progress. Google Analytics remains disabled. Production still runs PR #37.

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

## Hosted acceptance

- [PR #38](https://github.com/Causent-AI/causent-ai/pull/38), initial source `eced99b`: CI passed, including application, engine, RLS and bridge gates.
- Initial candidate `dpl_5WNGA1zick92t4CAh7YngZ7VRawT` is Ready with production configuration and GA4 explicitly disabled. The CLI lost its polling connection; deployment inspection confirmed success. The live `app.causent.ai` alias was not moved.
- Authentication uses the existing allowed `causent-ai-adamdavidowens-1984s-projects.vercel.app` address, verified against the candidate ID. No authentication settings changed.
- Fresh-account sign-in reaches onboarding. Existing active report opens with both metrics, four actions, saved commitment and immutable state. All eight Claude/Codex handoff previews pass without copying or executing. Data, Reports, Actions, Impact and Graph load; mobile is 390px without document overflow. Core Metrics drawer, Ask navigation and user-entered cost calculation pass.
- Graph keyboard selection, metric filtering and zoom pass. Pointer testing found a gap between the node and label; the follow-up adds one continuous hit area. Lint, types, graph tests and clean production build pass after the fix. A replacement candidate must verify pointer selection.
- Automatic approval review blocked synthetic report generation because it creates persistent records and paid AI requests. Approval is pending for bounded acceptance in the two existing isolated test workspaces; promotion remains gated on completion. Those workspaces were temporarily restored using the existing operator archive RPC; no membership or rollout assignments changed.
