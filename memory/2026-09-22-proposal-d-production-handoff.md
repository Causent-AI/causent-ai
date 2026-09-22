# Proposal D rollout handoff

[PR #38](https://github.com/Causent-AI/causent-ai/pull/38) contains the faithful application design. Production remains PR #37 (`9dcc20b`, `dpl_8erw9kJrgjcWyo5CqpFy5cCYxDoD`). GA4 stays disabled; schema and workers are unchanged. Merge/promotion remain authorized after release acceptance passes.

Both accounts pass report editing/reload, renamed sections, notes/charts, two-metric selection, three-action activation and all six Claude/Codex previews per account. Navigation-only counters and original production data/audit digests match. Both isolated scopes are archived. No auth configuration or credentials were changed.

All six approved user-triggered AI requests are used ($0.1129). A rewrite passed on `6a4041c`, but full-report generation failed. Last tested candidate `dpl_3Lb92ScWUqwVBX86TjuPJVbtt1Xf` (`ab606bd`) hit the provider grammar limit; its normal retry also failed at $0. CI on that commit passed, but it is not releasable.

The follow-up replaces the nested provider schema with a 1,404-byte flat transport and a validated server adapter into the unchanged canonical report. 742 local application/database tests pass, including AI SDK mock conversion and provenance/bounds tests. Live generation/rewrite still need verification; do not represent local mocks as provider acceptance or make additional AI calls without a new bounded allowance.

The review address is `https://causent-ai-adamdavidowens-1984s-projects.vercel.app`. Check its immutable candidate ID before testing. Normal Google login works; do not retry previously rejected credential or callback mutations. Restore only an existing isolated scope for any newly approved acceptance and archive it afterward. Follow the [release manifest](../docs/releases/2026-09-22-proposal-d-production.md) for exact evidence, infrastructure identities and release gates.
