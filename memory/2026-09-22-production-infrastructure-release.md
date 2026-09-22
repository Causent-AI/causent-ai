# Production infrastructure release · 2026-09-22

The user authorized production deployment and merged #35. Its automatic Vercel build
initially failed against the old schema; applying the rehearsed migrations restored the
existing signed-in app. Production now has 47 migrations and matching drift, recompute
and resolve deployments from runtime source `906dd7a`. Migration-boundary report/audit/
membership digests are unchanged. No seed, membership or Google setup mutation occurred.

The final #37 app candidate is Ready but unpromoted. Codex's preview still shows Vercel
login after the user's sign-in response; clarification is pending. Fresh-account and
changed-action acceptance remain open. #36's squashed-parent conflict was resolved with
an identical reviewed tree; fresh CI passed and #36 merged as `87d3128`. Its parent
history was carried into #37 without runtime changes. Do not merge
#37 or claim the final app is released until its remaining gates pass.

Use the [release manifest](../docs/releases/2026-09-22-production.md) for exact deployment
IDs, security findings, rollback and cleanup. Preserve the current workers/additive
schema during app rollback. The new rehearsal branch was removed after its aggregate evidence was saved;
the older preflight branch remains untouched. Google Analytics stays off and
Proposal D remains a prototype.
