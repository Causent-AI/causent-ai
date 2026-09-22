# Proposal D release handoff

[PR #38](https://github.com/Causent-AI/causent-ai/pull/38) contains the accepted design and records subsequent promotion. Candidate `dpl_AiqPYUy1eFqYCvFpbvwACVMvfiYH`, source `1ee763e41ebd444544c790956c05d7165479a76d`, is ready to promote. The closing source change is documentation only.

All source gates pass: 743 application/database tests, 19 optional paid-model skips, full engine/RLS/bridge CI and both previews. Both accounts pass editing/reload, sections, notes/charts, two metrics, three-action activation and every Claude/Codex preview. Final live generation took 9.053s and rewriting 4.471s, each in one attempt with saved reload. Ten admitted checks cost $0.1920 including retries. A further request was blocked before inference by the unchanged daily budget.

Both isolated scopes are archived; original production counts and revision/activation/membership digests match. No auth configuration, credentials, memberships, assignments, schema or workers changed. GA4 remains disabled. Preserve unrelated prototype evidence and `plugins/`.

Merge and promotion are authorized after checks. Recheck the exact candidate, promote it, verify `app.causent.ai`, authenticated routes, all-action controls and logs, then record the outcome in PR #38. Rollback remains `dpl_8erw9kJrgjcWyo5CqpFy5cCYxDoD` (`9dcc20b`). The [release manifest](../docs/releases/2026-09-22-proposal-d-production.md) contains exact infrastructure identities and the rollback command. Do not retry previously rejected credential or auth-callback mutations.
