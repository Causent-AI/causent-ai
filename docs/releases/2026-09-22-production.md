# Production release · 2026-09-22

Status: **existing-account candidate checks passed; fresh-account activation gate remains open**.

## Scope and source

Authorized: required migrations, matching workers, candidate verification and production promotion/rollback. Google Analytics stays disabled with its setup placeholder. No Google account, provider import, production seed, membership change, or Proposal D replacement of the live interface.

Runtime source: `906dd7ab2b2f57e33e1db7367b256b735d1ebd11`. [CI](https://github.com/Causent-AI/causent-ai/actions/runs/35676698650) passed: 726 app tests, 19 optional live-model skips, 1,338 engine tests, 12 prototype tests, schema/worker gates and production build. The unrelated untracked `ai-instances-desktop.png` is excluded.

The user merged [#35](https://github.com/Causent-AI/causent-ai/pull/35) as `3b25913c0a2ce699157f734d08fc77673e2e6e30`. [#36](https://github.com/Causent-AI/causent-ai/pull/36) was retargeted to main; merge commit `961025a` resolves the squashed-parent conflicts with a tree identical to reviewed `01535f2`. [Fresh checks](https://github.com/Causent-AI/causent-ai/actions/runs/35680481325) passed and #36 merged as `87d3128d04bd0e93a618d40400ff9b4af84cf564`. [#37](https://github.com/Causent-AI/causent-ai/pull/37) remains a draft, now targeting main. Main merges trigger Vercel automatically; no manual production pull is needed.

## Released infrastructure

| Component | Current state |
| --- | --- |
| Database | `royftsqyawtyfjolfabd`: **47 migrations**, latest `20260922000213` |
| Drift | `dpl_CdKNvUQVm2RiGhH6tdQXyxhS8KBm` — promoted, runtime source `906dd7a` |
| Recompute | `dpl_DYLPHBPEF2ch7Xm8BNuj9PW6wgk4` — promoted, runtime source `906dd7a` |
| Resolve | `dpl_9HkWwZKHZkkzb61a1z7gvW5iK3pt` — promoted, runtime source `906dd7a` |
| Live app | `app.causent.ai` → `dpl_9Grirzn3BB6NDVXjPnbKjbmmFsUy`, source **#36 / `87d3128`**; alias and signed-in Impact verified |
| Final app candidate | `dpl_4L33WGPe2DteezReXNcJg2cmBkXu`, runtime source **#37 / `906dd7a`**, Ready but not promoted |
| GA4 | Candidate build/runtime flag explicitly `0`; production has zero connections and credentials |
| Report exposure | Existing `default-on-with-explicit-rollback` resolver; one enabled assignment, no assignment changes |

Candidate: [immutable preview](https://causent-9cocvycib-adamdavidowens-1984s-projects.vercel.app).

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

Fresh OAuth for the existing account now returns to the **candidate** at `/onboarding?flow=decision-report`. Candidate Data, Reports, direct saved-report reopen, Actions and Impact pass. Google Analytics shows **Setup required** with no Connect control. All three existing action rows open both Claude and Codex preview dialogs with the correct action identity; no private brief was exported. Impact retains the primary-outcome/monitoring distinction. The captured candidate error log is empty, and pre/post report, revision, activation, membership, metric, observation, prediction and evidence counts/digests are unchanged.

This is not a new-account test or a new multi-metric activation. Those broader rollout gates remain unverified in this production candidate; an explicit scope decision is pending before #37 is cleared to merge. Automated tests cover the enabled/unassigned/disabled/unavailable rollout matrix and secondary-metric handoff assembly. Live Google account/property acceptance remains deferred while GA4 stays disabled.

## Rollback and next steps

Keep the additive database schema, audit records and current worker set. The retained #35 application is a verified read-only continuity fallback against migration 47, not proof of the full activation matrix. If a later app promotion fails, restore it with `vercel promote https://causent-61nrlxiq1-adamdavidowens-1984s-projects.vercel.app --scope adamdavidowens-1984s-projects --yes` and verify the custom alias. The older August app/worker artifacts are not verified against this schema; do not blindly restore them or run destructive down-migrations.

The new rehearsal branch was deleted after its aggregate [evidence](2026-09-22-evidence.json) was retained. The older preflight branch was left untouched.

Next: resolve the fresh-account/new-activation gate; finish #37; verify the final source, promote, prove alias identity and repeat signed-in checks. Founder/partner and representative-load validation remain separate gates.

Remove the temporary exact preview callback after release acceptance and any rollback retest are complete; preserve the pre-existing allowlist entries. Final PR merge and application promotion remain with the user/operator.
