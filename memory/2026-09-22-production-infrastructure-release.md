# Production infrastructure release · 2026-09-22

The user authorized production deployment and merged #35. Its automatic Vercel build
initially failed against the old schema; applying the rehearsed migrations restored the
existing signed-in app. Production now has 47 migrations and matching drift, recompute
and resolve deployments from runtime source `906dd7a`. Migration-boundary report/audit/
membership digests are unchanged. No seed or Google setup mutation occurred at that boundary.

The final #37 app candidate is Ready but unpromoted. The user completed Vercel and
Causent login; the actual remaining sign-in defect was an outdated Supabase redirect
allowlist pattern. Only the exact candidate callback was added, preserving every other
setting. Fresh OAuth now returns to the candidate; existing-account navigation, all six
handoff previews, GA4 placeholder, clean error logs and unchanged counters pass.
A later bounded test used the confirmed existing owner to provision one isolated synthetic
workspace and membership. New-report autosave/reopen, two normal CSV uploads (100 rows),
three-action activation and all six handoff previews passed, including a secondary-metric
support action. Navigation counters stayed unchanged. The workspace is archived and the
original selection restored; all pre-existing production counts/audit digests match.

AI generation is blocked by Gateway plan access: Claude Sonnet 5 is excluded from this
team's free tier, despite free credit being available. Two attempts returned 403 with zero
usage/charge; safe fallback preserved the brief. Keep the default model and wait for the
owner to add Gateway credits before retrying. Do not purchase credits or retrieve privileged
keys. The Reports metric-name fix is verified on candidate `239a245`, with saved content, all six handoffs and unchanged counters; production still serves #36. Fresh-account
acceptance is still unverified and unwaived. #36 merged as `87d3128`; do not merge #37 for the user.

Use the [release manifest](../docs/releases/2026-09-22-production.md) for exact deployment
IDs, security findings, rollback and cleanup. Preserve the current workers/additive
schema during app rollback. The new rehearsal branch was removed after its aggregate evidence was saved;
the older preflight branch remains untouched. Google Analytics stays off and
Proposal D remains a prototype.
