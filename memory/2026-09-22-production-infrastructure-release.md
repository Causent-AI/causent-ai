# Production infrastructure release · 2026-09-22

The user authorized production deployment and merged #35. Its automatic Vercel build
initially failed against the old schema; applying the rehearsed migrations restored the
existing signed-in app. Production now has 47 migrations and matching drift, recompute
and resolve deployments from runtime source `906dd7a`. Migration-boundary report/audit/
membership digests are unchanged. No seed, membership or Google setup mutation occurred.

The final #37 app candidate is Ready but unpromoted. The user completed Vercel and
Causent login; the actual remaining sign-in defect was an outdated Supabase redirect
allowlist pattern. Only the exact candidate callback was added, preserving every other
setting. Fresh OAuth now returns to the candidate; existing-account navigation, all six
handoff previews, GA4 placeholder, clean error logs and unchanged counters pass.
Fresh-account/new-activation acceptance is still unverified and an explicit scope
exception is pending. #36 merged as `87d3128` after fresh CI; #37 runtime code remains
identical to reviewed `906dd7a`. Do not merge #37 for the user.

Use the [release manifest](../docs/releases/2026-09-22-production.md) for exact deployment
IDs, security findings, rollback and cleanup. Preserve the current workers/additive
schema during app rollback. The new rehearsal branch was removed after its aggregate evidence was saved;
the older preflight branch remains untouched. Google Analytics stays off and
Proposal D remains a prototype.
