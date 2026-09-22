# Production release · 2026-09-22

Status: **READY_TO_PROMOTE — candidate acceptance passed for existing and fresh accounts. The user can merge #37 after its final documentation checks pass; production alias verification remains required.**

## Scope and source

Authorized: required migrations, matching workers, candidate verification and production promotion/rollback. Google Analytics stays disabled with its setup placeholder. No Google Analytics setup, provider import, production seed, or Proposal D replacement of the live interface. Acceptance tests added two isolated synthetic workspaces with operator/test memberships; the original workspace was preserved.

Application candidate source: `e6fe2c80641389f9ea683db73ad4524ad8e13e1d` adds explicit Google account selection and includes the earlier Reports metric-label fix (`239a245`). Local verification passed: 678 app tests with 67 environment/optional skips, typecheck, zero-warning lint, Node 22 webpack build and the dashboard build contract. [Hosted CI on `e6fe2c8`](https://github.com/Causent-AI/causent-ai/actions/runs/35696751128) and both previews passed: 726 app tests, 19 optional live-model skips, 1,338 engine tests, 12 prototype tests, 15 load contracts, schema/worker gates and production build. Worker source remains `906dd7ab2b2f57e33e1db7367b256b735d1ebd11`. The unrelated untracked `ai-instances-desktop.png` is excluded.

The user merged [#35](https://github.com/Causent-AI/causent-ai/pull/35) as `3b25913c0a2ce699157f734d08fc77673e2e6e30`. [#36](https://github.com/Causent-AI/causent-ai/pull/36) was retargeted to main; merge commit `961025a` resolves the squashed-parent conflicts with a tree identical to reviewed `01535f2`. [Fresh checks](https://github.com/Causent-AI/causent-ai/actions/runs/35680481325) passed and #36 merged as `87d3128d04bd0e93a618d40400ff9b4af84cf564`. [#37](https://github.com/Causent-AI/causent-ai/pull/37) targets main. Main merges trigger Vercel automatically; no manual production pull is needed.

## Released infrastructure

| Component | Current state |
| --- | --- |
| Database | `royftsqyawtyfjolfabd`: **47 migrations**, latest `20260922000213` |
| Drift | `dpl_CdKNvUQVm2RiGhH6tdQXyxhS8KBm` — promoted, runtime source `906dd7a` |
| Recompute | `dpl_DYLPHBPEF2ch7Xm8BNuj9PW6wgk4` — promoted, runtime source `906dd7a` |
| Resolve | `dpl_9HkWwZKHZkkzb61a1z7gvW5iK3pt` — promoted, runtime source `906dd7a` |
| Live app | `app.causent.ai` → `dpl_9Grirzn3BB6NDVXjPnbKjbmmFsUy`, source **#36 / `87d3128`**; alias and signed-in Impact verified |
| Final app candidate | `dpl_B4zioUX25QJiujFjPvty4eD8aew1`, runtime source **#37 / `e6fe2c8`**, Ready but not promoted |
| GA4 | Candidate build/runtime flag explicitly `0`; production has zero connections and credentials |
| Report exposure | Existing `default-on-with-explicit-rollback` resolver; one enabled assignment, no assignment changes |

Candidate: [immutable preview](https://causent-2oidideiw-adamdavidowens-1984s-projects.vercel.app). Earlier candidates `906dd7a` and `239a245` supplied existing-account activation, corrected-label and paid-generation evidence. The final candidate adds only the login account prompt; its fresh-account generation, uploads, activation, eight handoffs and route continuity now pass. The live alias is still on #36.

## Database and security evidence

A completed physical backup at `2026-09-21T12:00:32.291Z` was verified; PITR is disabled. The five migrations were rehearsed on a new private with-data branch, `causent-release-20260922` / `akmsvvpnsvdjbeeztjez`, then applied to production in order: T01–T04, T05–T10, generation admission, resolution fairness, GA4 core metrics. Both copies passed error-level schema lint.

Before/after migration: 7 reports, 22 revisions, 6 activations, 4 memberships, 1 workspace, 11 metrics, 1,504 observations, 17 predictions and 244 evidence objects. Report revision, activation and membership digests matched exactly. No production seed or semantic backfill ran. Normal scheduled workers can subsequently update operational state; these counts describe the migration boundary.

Production catalog checks: every public table has RLS; public views use security-invoker; privileged functions have fixed search paths; no non-trigger public definer is callable anonymously. The GA4 worker has no login, inheritance, superuser or RLS bypass; ordinary clients and its direct role cannot read private credentials/state. The image bucket remains private, PNG/JPEG only, 5 MiB.

Hosted advisors: zero errors, **33 existing warnings** (32 authenticated-executable definer RPCs and disabled leaked-password protection), seven intentional default-deny table notices. The 32 RPC definitions were reviewed against membership/actor checks and the guarded report/import helpers; no blanket revocation was applied. Hosted email/password authentication is enabled despite the Google-only app UI; leaked-password protection remains an explicit hardening item. API exposure, live Storage delivery and fresh-account acceptance are not proven by catalog checks.

## Runtime checks and limits

All four protected remote build configuration gates passed. Worker builds used Python 3.12 and the explicit Python framework; build-time probes connected as each exact project-qualified worker role and exercised the real handler against an empty scope. Every deployed worker rejected a request without its shared secret with 401.

Live drift and recompute deployments received successful authenticated scheduled requests (HTTP 200). App cron routes for drift, recompute, resolve and connector inbox returned 200 after the database update. A separate protected verification build used the stored resolver secret to send an empty-scope request to its live canonical endpoint: HTTP 200 at `2026-09-22T02:53:14Z`, confirmed in the promoted deployment logs. The canonical alias remained on `dpl_9HkWwZKHZkkzb61a1z7gvW5iK3pt`. Real retry/queue processing is not claimed from an empty scope.

The #35 automatic deployment initially failed because the old database lacked `workspaces.archived_at`. Applying the rehearsed schema restored the existing signed-in Data, Reports, Actions and Impact routes. All three existing action rows expose both Claude and Codex controls. No report was edited or activated during this read-only check. After #36 merged, its automatic deployment was verified on the custom alias and the existing signed-in Impact route. Its runtime application files match #35. This is existing-account continuity, not fresh-user or secondary-metric activation acceptance.

The final candidate passes deployed security-header checks (frame/object/base restrictions, nosniff, referrer and device permissions). After the user signed in, the remaining blocker was reproduced as an OAuth redirect configuration mismatch: the existing allowed preview pattern began `causent-ai-`, while this candidate begins `causent-`. Supabase fell back to the live site. Added only this immutable candidate's exact `/auth/callback` URL to `uri_allow_list`; a read-after-write comparison confirmed every other auth setting was unchanged. The production Site URL remains `https://app.causent.ai`. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

Fresh OAuth for the existing account now returns to the **candidate** at `/onboarding?flow=decision-report`. Candidate Data, Reports, direct saved-report reopen, Actions and Impact pass. Google Analytics shows **Setup required** with no Connect control. All three existing action rows open both Claude and Codex preview dialogs with the correct action identity; no private brief was exported. Impact retains the primary-outcome/monitoring distinction. At this read-only checkpoint the captured candidate error log was empty, and pre/post report, revision, activation, membership, metric, observation, prediction and evidence counts/digests were unchanged. The subsequent generation/activation test below has separate evidence and durable synthetic records.

### New report and multi-metric activation

Using the confirmed existing account, created the isolated **Synthetic acceptance / PR 37 activation check** workspace. The browser saved and reopened a new synthetic report; title and paragraph edits persisted. Two CSV uploads supplied 50 observations each. The report selected both metrics, assigned two actions to the primary setup-completion metric and a supporting action to the secondary support-request metric, then activated all three through **Start**.

All six Claude/Codex handoff previews opened with the correct action identity. Impact showed one registered prediction, secondary monitoring context and no invented measured outcome. No external handoff was exported. Repeated navigation and all six previews left the test workspace at one report, eight revisions, one activation, three actions, one prediction, five funnel events, zero transitions and zero recompute jobs; its activation digest also matched. Browser warning/error logs were empty.

The workspace is now archived, preserving its audit history and 100 synthetic observations. The original workspace selection was restored. Counts and revision/activation/membership digests for all pre-existing production data match the pre-test baseline. No reset, seed or hard delete ran.

The test found a Reports index display defect: it showed the original draft's metric name after activation. The follow-up fix resolves the label from that report's canonical active metric under the existing scope/RLS checks; it preserves the draft projection and uses an unavailable label if the activated metric cannot be read. Verified on the updated `239a245` candidate: the label is **Synthetic Setup Completion**. Fresh OAuth, saved report reopen, Data/Reports/Actions/Impact, all six handoff previews and unchanged navigation counters pass there; the browser console is clean. Only the new immutable callback was added, preserving other auth settings. The later paid-generation check below also passed on this exact candidate.

### AI generation after credit top-up

The owner added Gateway credits and confirmed Sonnet 5 should remain the default. At
`2026-09-22T05:06:15Z`, the candidate completed live generation in one application attempt
(18.365 seconds; 5,134 input and 1,286 output tokens). The receipt is completed with its
concurrency slot released. Gateway request `gen_01M33R3DYF7AYN5899F0T65RQT` returned **200**
through Bedrock at a displayed cost of **$0.0231**. The earlier two free-plan 403 responses
are retained as historical evidence, not an open billing blocker.

The generated synthetic draft has three actions, leaves unknown impact unset and retains
the no-customer-rollout limit. It autosaved and reopened after reload. No new activation
ran. The archived test workspace now contains two reports, nine revisions, one activation,
three canonical actions, one prediction and nine funnel events; its activation digest,
zero transition/recompute-job counts and all pre-existing production invariants are unchanged.

**Reliability follow-up:** Gateway recovered after three provider routing attempts. Claude
Platform on AWS and direct Anthropic returned 400 because the structured-output grammar was
too large; Bedrock accepted the same Sonnet 5 request. Simplify and test the model schema
before claiming those two provider routes are compatible. This check proves successful
end-to-end generation through the recovered Bedrock route, not success on every provider.
No model, routing rule or budget setting was changed.

### Fresh-account signup and account selection

A previously unused address completed real Google signup in Chrome at `2026-09-22T06:20:36Z`.
The invitation produced exactly one member grant to a new isolated organization, with zero
explicit rollout assignments. The new workspace is `ef921cfb-87ed-4669-9047-c108ef38e5a6`
(**Fresh signup / PR 37 fresh-account check**); it was provisioned empty through the operator
workflow. Pre-existing data counts and report/activation/membership digests are unchanged.
The existing owner retains an administrative membership for test cleanup.

The connected browser initially reused the original Google session. Source `e6fe2c8` adds
`prompt=select_account` to the existing Supabase OAuth request. The chooser works, and the
new member completed normal OAuth back to the candidate with access only to the isolated
workspace. No credentials, auth bypass or model settings were changed. The exact candidate
callback is allowed; the production Site URL and other auth settings are unchanged.

The first agent-run generation returned malformed structured output and safely preserved
the brief as an editable fallback. A normal retry completed live with Sonnet 5 in 10.204
seconds: 4,876 input / 1,080 output tokens, one application attempt, released request slot
(`c2563150-ba97-4aa7-84fd-35111a237c5f`). This proves recovery, not elimination of the earlier
schema-validation failure; improving structured-output reliability remains a follow-up.

Report `0c694a3e-1adf-4035-b8eb-d7eb2f3b5a55` preserved the edited title, selected metrics,
action bindings and commitment across reload/direct reopen. Two normal CSV uploads added
100 synthetic observations. **Start** activated all four actions, including the support
action assigned to the secondary metric. All eight Claude/Codex previews showed the correct
action; nothing was exported. Data, Reports and Impact showed the same report and metrics,
the correct canonical metric label, a planned target and no measured outcome. Browser
warning/error logs were empty; the final 100 candidate log records were informational.

Navigation and preview checks left three reports, seven revisions, one activation, four
actions, one prediction, 16 funnel events and zero transition/recompute jobs unchanged.
The activation digest also matched. The test workspace is archived, retaining both metrics,
all 100 observations, the user's earlier draft and the fallback report. All pre-existing
production counts and revision/activation/membership digests match the pre-test baseline.
Automated tests additionally cover disabled/unavailable exposure and stale/foreign bindings.
Real Google Analytics property acceptance remains deferred while GA4 stays disabled.

## Rollback and next steps

Keep the additive database schema, audit records and current worker set. The retained #35 application is a verified read-only continuity fallback against migration 47, not proof of the full activation matrix. If a later app promotion fails, restore it with `vercel promote https://causent-61nrlxiq1-adamdavidowens-1984s-projects.vercel.app --scope adamdavidowens-1984s-projects --yes` and verify the custom alias. The older August app/worker artifacts are not verified against this schema; do not blindly restore them or run destructive down-migrations.

The new rehearsal branch was deleted after its aggregate [evidence](2026-09-22-evidence.json) was retained. The older preflight branch was left untouched.

Next: the user merges #37 after final checks. Verify the resulting automatic deployment,
exact source and production alias, then repeat signed-in checks. No manual production pull
is needed. Founder/partner and representative-load validation remain separate gates.

Remove all three temporary exact preview callbacks after release acceptance and any rollback retest are complete; preserve the pre-existing allowlist entries. Final PR merge and application promotion remain with the user/operator.
