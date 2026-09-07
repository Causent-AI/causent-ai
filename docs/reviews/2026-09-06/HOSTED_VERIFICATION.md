# Hosted verification

Verified September 7, 2026 UTC. [Draft PR 33](https://github.com/Causent-AI/causent-ai/pull/33) targets main. Its implementation commit is `98f8697e347a74fcf243eab5f502f9c9de6aacf6`; hosted status and deployment identifiers were checked against that exact SHA.

[CI run 34083916927](https://github.com/Causent-AI/causent-ai/actions/runs/34083916927) completed successfully: clean dependency installation, disposable Supabase migration/reset/seed, application contracts/integration, schema lint, full engine/RLS/bridge suite, release configuration, staged worker bundles and production webpack/dashboard checks. Live-model tests remain explicitly opt-in skips. A later documentation-only commit must retain green PR checks; the PR shows the current head status.

| Preview | Build state | Browser result |
|---|---|---|
| [causent](https://vercel.com/adamdavidowens-1984s-projects/causent/3A5YkzwpqyUGnvcQ5cRFeBkkKQr4) | READY, preview target; commit status success | `/impact` returns the existing load-error boundary. Deployment logs confirm `Missing NEXT_PUBLIC_SUPABASE_URL in the server environment`, digest `2288208265`, before a database query. |
| [causent-ai](https://vercel.com/adamdavidowens-1984s-projects/causent-ai/GDnJXwc49MpXHMKHnraSUxv5msRb) | READY, preview target; commit status success | Sign-in page loads without browser warnings/errors. Authenticated acceptance was not performed. |

Both Vercel success statuses are attached to the implementation SHA. Ready builds do not establish runtime or schema compatibility. No production alias, live migration or worker deployment was changed. No actionable inline review comments or submitted reviews were present at inspection.

## Remaining acceptance boundary

Configure an approved isolated preview database and required environment values, apply the additive schema there, deploy compatible workers through a separately authorized release and complete authenticated end-to-end acceptance. Do not copy production credentials into the unconfigured project or connect tests to a shared database as a shortcut. Existing hosted schema parity was not inspected; a missing view is not the observed failure in this run.

The PR remains draft. Local integration acceptance is complete; hosted authenticated acceptance and partner validation remain incomplete. See [operations guidance](T01_T04_MIGRATION.md) and [implementation evidence](T01_T04_IMPLEMENTATION.md).
