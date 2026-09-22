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

The owner added Gateway credits and retained Sonnet 5. Live generation passed on candidate
`239a245`: one application attempt, 18.365 seconds, 5,134 input / 1,286 output tokens and
$0.0231 displayed Gateway cost. The generated draft autosaved/reloaded with three actions
and unknown impact left unset. The synthetic workspace was archived again; its active
report, actions, prediction and all pre-existing production invariants are preserved.
Gateway recovered through Bedrock after Claude Platform on AWS and direct Anthropic
rejected the compiled output grammar. Record schema simplification as a reliability
follow-up; do not claim every provider route passed. No model or routing setting changed.
The Reports metric-name fix is verified on candidate `239a245`, with saved content, all six handoffs and unchanged counters; production still serves #36. Fresh-account
application acceptance now passes on the final candidate as detailed below. #36 merged as `87d3128`; do not merge #37 for the user.

Use the [release manifest](../docs/releases/2026-09-22-production.md) for exact deployment
IDs, security findings, rollback and cleanup. Preserve the current workers/additive
schema during app rollback. The new rehearsal branch was removed after its aggregate evidence was saved;
the older preflight branch remains untouched. Google Analytics stays off and
Proposal D remains a prototype.

The new test identity completed real Google signup in Chrome and received exactly one
member grant to isolated workspace `ef921cfb-87ed-4669-9047-c108ef38e5a6`
(organization `9f4604f4-d6f5-40e5-baa3-89f3c1ad0ecd`), with zero rollout assignments.
The connected browser retained the original Google session. Source `e6fe2c8` fixes silent
reuse by requesting `prompt=select_account`; local checks, hosted CI run `35696751128` and
both previews pass. Candidate `dpl_B4zioUX25QJiujFjPvty4eD8aew1` has verified source metadata,
passing headers and a visible Google account chooser. Its exact callback is the third
temporary allowlist entry; production still serves #36. The owner completed normal Google
OAuth, and the connected candidate session has only the isolated workspace. Generation
returned a safe fallback once, then a normal retry passed in 10.204 seconds (4,876 input /
1,080 output tokens, one application attempt, released slot). Keep the schema-validation
failure visible in the reliability backlog; no model/routing change was made.

Fresh report `0c694a3e-1adf-4035-b8eb-d7eb2f3b5a55` passed title/commitment persistence,
two CSV uploads (100 rows), four-action activation, a secondary-metric support action and
all eight Claude/Codex previews. Data/Reports/Actions/Impact and the canonical metric label
pass; no measured outcome or external export is claimed. Browser logs are clean. Navigation
left three reports, seven revisions, one activation, four actions, one prediction, 16 funnel
events and zero transitions/recompute jobs unchanged; activation digest matched.
Both synthetic workspaces are archived with audit history intact. All pre-existing production
counts and revision/activation/membership digests still match. Candidate acceptance is complete;
the user merges #37 after final checks. Verify the automatic deployment and signed-in alias
before removing the three temporary callbacks. No merge or promotion was performed here.

Operational note: a failed archive export briefly created an empty Vercel project named
`app-account-chooser`; it was removed completely. The final export excludes repository
tooling links and is pinned to the existing verified Causent project.
