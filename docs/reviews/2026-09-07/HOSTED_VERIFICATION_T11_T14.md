# T11–T14 submission evidence

Baseline: `dd1901db247d5ca824d0a8419497d94113d13127` (merged PR #34).
Branch: `codex/p2-and-ux-review`.

Implementation commit: `a46fe0fa912916718393d702ec79e9168df866df`.
Draft PR: [#35](https://github.com/Causent-AI/causent-ai/pull/35).

## Implementation checkpoint

All four hosted checks passed for that implementation commit on September 7 Pacific / September 8 UTC:

| Gate | Evidence |
|---|---|
| Application, engine, RLS, bridge, fresh migrations, schema lint, worker configuration/bundles, webpack/dashboard build | [CI run 34193693141](https://github.com/Causent-AI/causent-ai/actions/runs/34193693141), success; 5m44s |
| Causent preview | [Deployment 8PwJc3N8iGNEbCGSmxafPvWWPN5E](https://vercel.com/adamdavidowens-1984s-projects/causent/8PwJc3N8iGNEbCGSmxafPvWWPN5E), success |
| Causent AI preview | [Deployment 6RxoHdAUX5MQoy1RHxT5CcZVPSEP](https://vercel.com/adamdavidowens-1984s-projects/causent-ai/6RxoHdAUX5MQoy1RHxT5CcZVPSEP), success |
| Vercel Preview Comments | Success |

The follow-up commit adds only this verification record and matching documentation updates. Its own current-head checks are linked from [PR #35](https://github.com/Causent-AI/causent-ai/pull/35/checks); the implementation checkpoint above is intentionally tied to an immutable source commit.

The [engineering review](T11_T14_ENGINEERING_REVIEW.md) and [runbook](T11_T14_RUNBOOK.md) record the local checkpoint: 710 application tests passed with 19 optional live-model skips; 1,324 engine tests passed. The new migration definitions also passed fresh application in hosted CI, beyond the local transaction replay. A successful preview build does not establish authenticated acceptance, provider behavior, or production schema parity.

No merge, production schema change, worker deployment, or application promotion was performed. The UI redesign remains a proposal.
