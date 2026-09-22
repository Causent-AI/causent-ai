# Proposal D production rollout

Verdict: **READY_TO_PROMOTE**. [PR #38](https://github.com/Causent-AI/causent-ai/pull/38) implements the approved design and records the subsequent merge/promotion result. This document records acceptance of the immutable candidate below; Google Analytics stays disabled.

## Release identity

| State | Verified value |
| --- | --- |
| Branch | `codex/proposal-d-production`, based on main `9dcc20b5c74ae0633f88fe077aacec6c93ed2638` |
| Pre-release production / rollback | `app.causent.ai` → `dpl_8erw9kJrgjcWyo5CqpFy5cCYxDoD`, source `9dcc20b` |
| Rollback URL | `https://causent-izflytjml-adamdavidowens-1984s-projects.vercel.app` |
| Accepted candidate | `dpl_AiqPYUy1eFqYCvFpbvwACVMvfiYH`, source `1ee763e41ebd444544c790956c05d7165479a76d` |
| Candidate URL | `https://causent-5xn23m6sr-adamdavidowens-1984s-projects.vercel.app` |
| Review alias | `causent-ai-adamdavidowens-1984s-projects.vercel.app`; verify the exact deployment before acceptance |
| Supabase | `royftsqyawtyfjolfabd`, 47 migrations; no schema changes |
| Workers | Source `906dd7a`; drift `dpl_CdKNvUQVm2RiGhH6tdQXyxhS8KBm`, recompute `dpl_DYLPHBPEF2ch7Xm8BNuj9PW6wgk4`, resolve `dpl_9HkWwZKHZkkzb61a1z7gvW5iK3pt` |
| Exposure | Existing authenticated default-on with explicit rollback; no membership or assignment changes |

The owner authorized implementation, PR updates, candidates and production rollout after verification. Continued synthetic testing was explicitly authorized after the initial six requests. Both isolated test workspaces are archived; audit history is retained. Original data, memberships, rollout assignments, schema and workers are unchanged. Unrelated prototype evidence and `plugins/` remain untouched.

## Product changes

| Surface | Implemented design | Retained behavior |
| --- | --- | --- |
| Shell | Approved logo, five pills, regular type, blue Create, yellow Ask, synchronized folder title, bottom Core Metrics | Verified account/workspace access |
| Reports / onboarding | Pageless paragraphs, one formatting/chart/rewrite toolbar, editable section names, added notes, Brief/Review flow | Autosave, append-only revisions, explicit AI review and immutable active plans |
| Data | Single metric library, L28 average and WoW, upload dialog, bottom history drawer; Connections and AI Harnesses/Cost | Actual imported observations, semantic definitions, core selection and supplied-rate estimates |
| Actions / Impact | Compact expandable actions, PR links, four impact tiles and results table | Claude/Codex handoffs, completion and existing guarded ITS models |
| Graph | Full dark Decision Network, core metric/project/decision nodes, chronological lanes, filters, pan/zoom/Fit | Authorized records and explicit version links; no invented aggregate effect |

Calendar summaries require complete windows. GA4/BigQuery setup, custom saved harnesses, automatic partner execution, portfolio creation and combined attribution are not simulated. GA4 provider acceptance remains deferred.

## Acceptance evidence

- **Source gates:** 743 application/database tests pass; 19 optional paid-model tests are skipped, with no database skips. The full design run passed 1,338 engine/RLS/bridge and 27 prototype/load cases. Types, lint, schema checks, dashboard gate and production build pass. Final implementation CI and both Vercel previews pass: [run 35788196916](https://github.com/Causent-AI/causent-ai/actions/runs/35788196916). The closing commit changes documentation only.
- **Both accounts:** normal Google sign-in; create/edit/autosave/reload/direct reopen; synchronized title; section rename; added note; observed chart; two selected metrics; three actions; activation; every Claude/Codex preview. Each account exercises a registered primary action, a supporting primary-metric action and a secondary monitoring action. No external handoff was executed.
- **Final live AI:** new-report generation completed in one attempt, 9.053s, and rewriting in one attempt, 4.471s. Both receipts report `live`; generated text, title, selected metrics and the kept rewrite survive reload. Final-build activation and all six generated-action handoff previews also pass. Candidate logs contain no errors or warnings after these checks.
- **UI:** all five routes, source/upload dialogs, graph pointer/keyboard selection, metric filter and Fit pass. Data, Reports, onboarding and Graph fit 390px without document overflow. Mobile viewport override was reset.
- **Navigation:** owner counters remain unchanged across its read-only pass. On the final build, fresh-account navigation remains at 7 reports / 19 revisions / 3 activations / 10 actions / 3 predictions / 38 telemetry events, with zero jobs/transitions and an unchanged activation digest. Explicit report generation and editing are excluded from navigation comparisons.
- **Original data:** counts and revision/activation/membership digests match the pre-test baseline, excluding only the authorized scopes: 8 reports, 23 revisions, 6 activations, 17 predictions, 11 metrics, 1,504 observations, 244 evidence rows, 4 memberships and 1 active workspace. Both synthetic scopes are confirmed archived through the existing archive RPC.

## AI reliability decisions

The original nested response schema exceeded provider grammar limits. A **1,404-byte flat transport schema** replaces the 6,666-byte provider schema. A server adapter validates claim field names, action indexes, duplicates, cardinality and original value bounds before constructing the unchanged canonical report. Existing materialization still checks source quotes, removes unsupported numeric evidence and leaves unknown facts missing.

Empty metadata strings receive explicit missing-state labels; wrong types and missing required fields still fail validation. Low reasoning effort preserves room for report text within the unchanged 2,200-token output limit. Sonnet 5, retry policy, budgets, authorization and persistence remain unchanged. Seven transport tests cover mapping, provenance, malformed bindings, bounds, empty labels, grammar size and actual AI SDK mock-response conversion. The live results above separately verify provider acceptance.

Ten admitted checks across the correction sequence cost **$0.1920** including automatic retries. The final generation cost $0.0161 and rewrite $0.0068. One additional fresh-account attempt was blocked by the existing daily reservation budget before a provider call; limits were not raised. Earlier invalid results preserved the brief and did not silently replace edited text.

## Release and rollback

1. Merge only with all required checks green. Promote the accepted immutable candidate explicitly, retaining its source identity even though the closing commit contains documentation updates.
2. Confirm `app.causent.ai` resolves to that candidate. Repeat signed-in route checks, confirm all-action controls, inspect logs and worker health. Record deployment evidence in [PR #38](https://github.com/Causent-AI/causent-ai/pull/38).
3. Keep existing authenticated default-on exposure with explicit rollback. GA4 remains off; custom connectors, saved harnesses and portfolio attribution remain separate work.
4. If needed, restore the prior application with `vercel promote https://causent-izflytjml-adamdavidowens-1984s-projects.vercel.app --yes --scope adamdavidowens-1984s-projects`, then verify the public alias. Preserve schema and append-only audit records.

Automated acceptance does not establish unassisted partner validation or a measured causal outcome before the registered observation window completes.

[Engineering review](../reviews/2026-09-22/PRODUCTION_DESIGN_REVIEW.md) · [GA4 handoff](../handoffs/ga4-core-metrics.md) · [prior production infrastructure record](2026-09-22-production.md).
