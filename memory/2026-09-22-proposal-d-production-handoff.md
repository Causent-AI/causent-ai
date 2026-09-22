# Proposal D rollout handoff

[PR #38](https://github.com/Causent-AI/causent-ai/pull/38) contains the actual authenticated application design. Production is still PR #37 (`9dcc20b`, `dpl_8erw9kJrgjcWyo5CqpFy5cCYxDoD`). GA4 stays disabled; no schema/worker change is required.

Local application/integration, engine/RLS/bridge, types, lint, schema and production-build gates pass. Candidate read-only acceptance covers both Google accounts, saved reports, all fourteen Claude/Codex previews, mobile, graph filters/selection, AI cost calculation and unchanged navigation counters. Original data digests match; both isolated acceptance workspaces are archived again. Follow the [release manifest](../docs/releases/2026-09-22-proposal-d-production.md) for candidate IDs and exact remaining gates.

Automatic approval review rejected new synthetic report generation because it writes persistent records and incurs AI charges. The pending question requests up to four AI calls and create/edit/reload/activation tests in the two existing isolated workspaces, followed by archiving. Do not treat elapsed time as consent or promote before this acceptance completes.

Candidate sign-in works through the existing allowed `causent-ai-adamdavidowens-1984s-projects.vercel.app` address. Verify its immutable deployment ID before testing. No auth configuration was changed; do not retry the rejected credential/callback mutation. The owner account can use the normal login screen and Google chooser. Production promotion remains authorized after the test gate is satisfied.
