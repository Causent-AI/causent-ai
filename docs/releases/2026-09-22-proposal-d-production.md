# Proposal D production rollout

Status: **held for live AI acceptance**. [PR #38](https://github.com/Causent-AI/causent-ai/pull/38) implements the approved design. Production still runs PR #37. Google Analytics stays disabled.

## Release identity

| State | Verified value |
| --- | --- |
| Branch | `codex/proposal-d-production`, based on main `9dcc20b5c74ae0633f88fe077aacec6c93ed2638` |
| Production / rollback | `app.causent.ai` → `dpl_8erw9kJrgjcWyo5CqpFy5cCYxDoD`, source `9dcc20b` |
| Rollback URL | `https://causent-izflytjml-adamdavidowens-1984s-projects.vercel.app` |
| Last tested candidate | `dpl_3Lb92ScWUqwVBX86TjuPJVbtt1Xf`, source `ab606bd9ed19c53f3a4fe128d09915fc364a6093` — live generation failed |
| Candidate URL | `https://causent-dsz9tpqnm-adamdavidowens-1984s-projects.vercel.app` |
| Review alias | `causent-ai-adamdavidowens-1984s-projects.vercel.app`; verify the exact deployment before acceptance |
| Supabase | `royftsqyawtyfjolfabd`, 47 migrations; no schema changes |
| Workers | Source `906dd7a`; drift `dpl_CdKNvUQVm2RiGhH6tdQXyxhS8KBm`, recompute `dpl_DYLPHBPEF2ch7Xm8BNuj9PW6wgk4`, resolve `dpl_9HkWwZKHZkkzb61a1z7gvW5iK3pt` |
| Exposure | Existing authenticated default-on with explicit rollback; no membership or assignment changes |

The owner authorized implementation, PR updates, candidates and production rollout after verification. Synthetic acceptance was limited to two isolated workspaces and six normal AI requests. All six have run; no further AI requests are authorized. Both test workspaces are archived. Unrelated prototype evidence and `plugins/` remain untouched.

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

- **Local:** 742 application/database tests pass, with 19 optional paid-model tests skipped; no database skips. The prior full design run passed 1,338 engine/RLS/bridge and 27 prototype/load cases. Types and changed-file lint pass. Hosted CI on `ab606bd` passed all app/engine/RLS/bridge gates and both Vercel builds: [run 35784300322](https://github.com/Causent-AI/causent-ai/actions/runs/35784300322). The compact-response follow-up needs its own hosted checks.
- **Both accounts:** normal Google sign-in, create/edit/autosave/reload/direct reopen, synchronized title, section rename, added note, observed chart, two selected metrics, three actions, activation and every Claude/Codex preview pass. Each account has one registered primary action, one supporting primary-metric action and one secondary monitoring action. No external handoff was executed.
- **UI:** all five routes, source/upload dialogs, graph pointer/keyboard selection, metric filter and Fit pass. Data, Reports, onboarding and Graph were inspected at 390px without document overflow. Mobile viewport override was reset.
- **Navigation invariants:** owner remained at 3 reports / 20 revisions / 2 activations / 6 actions / 2 predictions / 16 telemetry events. Fresh account remained at 4 / 12 / 2 / 7 / 2 / 22 during its navigation-only comparison. Both had zero recompute jobs and transitions; activation digests matched. Later explicit generation requests added only synthetic drafts/receipts.
- **Original data:** counts and revision/activation/membership digests match before/after the entire run, excluding only the two authorized test scopes: 8 reports, 23 revisions, 6 activations, 17 predictions, 11 metrics, 1,504 observations, 244 evidence rows, 4 memberships and 1 active workspace. Both synthetic scopes are confirmed archived through the existing archive RPC; their audit records remain intact.

## AI release blocker and correction

Six user-triggered requests cost **$0.1129 total**. Requests 1–3 returned malformed structured output. Request 4 successfully rewrote a paragraph on `6a4041c`; Keep and reload passed. Request 5 still failed full-report validation. Request 6 on `ab606bd` failed before generation: Claude Platform on AWS and Anthropic rejected the compiled grammar; Bedrock rejected forced native output and Vertex returned 400. Its existing automatic retry also failed; both gateway attempts cost $0. No failed response was represented as a successful AI result, and every brief was preserved.

The final correction uses a **1,404-byte flat transport schema** instead of the original 6,666-byte nested provider schema. It describes a single repeated claim shape. A server adapter checks field names, action indexes, duplicates, cardinality and original value bounds, then constructs the unchanged canonical report. Existing materialization still verifies exact source quotes, removes invented numeric evidence and leaves unsupported owners/customers missing. The adapter does not alter persistence, auth, model choice, generation budgets or retry policy. Default provider mode is restored so Gateway can choose a compatible route.

Six transport tests cover mapping, provenance, malformed bindings, bounds, grammar size and an actual AI SDK mock-response conversion. These are local contract evidence, **not live Sonnet acceptance**. Full generation and rewriting must pass on the compact-schema candidate before release.

## Remaining release steps

1. Finish CI/build for the compact-schema commit and record its immutable candidate ID/source.
2. Obtain a new bounded AI-request allowance; the six-request limit is exhausted. Restore only an isolated scope for normal generation/rewrite, confirm live mode, autosave and reload, then archive it again and compare invariants.
3. Recheck exact source, candidate, production alias, unchanged database/workers, GA4-off setting and exposure. Merge #38 and explicitly promote only after acceptance passes.
4. Verify the public alias and signed-in routes, all-action controls, error logs and worker health. Retain the baseline artifact for rollback; preserve schema and audit records.

[Engineering review](../reviews/2026-09-22/PRODUCTION_DESIGN_REVIEW.md) · [GA4 handoff](../handoffs/ga4-core-metrics.md) · [prior production infrastructure record](2026-09-22-production.md).
