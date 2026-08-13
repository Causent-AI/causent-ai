# Decision Report review release preflight — 2026-08-12

## Request and release posture

The founder requested that the current Decision Report review changes be pushed to production and
that progress be documented while review continues. The reviewed candidate is committed as
`5a67a6f` and pushed on `codex/decision-report-review-round-1`. Vercel created Ready Preview
deployment `dpl_GdYnCg7FoUpFevfTPPbeWVowuXRB` at
**https://causent-oq0hqe1gm-adamdavidowens-1984s-projects.vercel.app**. The installed GitHub
integration denied PR creation, so no PR or hosted PR CI result is claimed. This report does not
claim a merge, production migration, environment mutation, production promotion, or authenticated
canary.

The production web app is Vercel project `causent-ai`, served at
**https://app.causent.ai**. The existing production app remains the prior deployed baseline until
the exact review candidate passes hosted CI, is merged, deploys, and passes live verification. The
branch Preview is reviewable but is not production.

## Release-candidate hardening completed locally

The explicit sample now uses a deterministic, server-validated, activation-ready fixture and the
visible badge is **Full-plan example**. The client sends an allowlisted sample identity only while
the exact prompt is unchanged and no additional source is attached; the server repeats those checks
and rejects forged IDs or changed inputs before fixture mode. The result still travels through the
normal typed report, readiness, receipt, save, and activation boundaries.

The exact local gate is green: all 31 migrations reset cleanly; TypeScript and full ESLint pass; the
serialized Node/Supabase/RLS/Storage run reports 556 tests, 537 passed, 19 intentional live-model
skips, and zero failures; schema lint at error level passes; all 1,217 engine/bridge/isolation/
recompute tests pass; the audited recompute staging bundle contains 18 files; and the Next.js
16.2.11 webpack build plus request-bound dashboard manifest guard pass.

Focused browser acceptance selects **Full-plan example**, renders the deterministic Northstar
report, autosaves it to a stable report URL, preserves three confirmed actions, the explicit primary
lever, and the +37.5% prediction, and produces no console errors. Activation remains disabled until
the reviewer confirms a real workspace metric, as intended.

The completed Northstar dataset contains 122 synthetic observations and exists only to demonstrate
the intended mature loop during founder review. It must never be loaded into production, represented
as a real customer outcome, or counted as a production canary or partner session.

## Read-only production findings

### Database

- The Supabase CLI is not authenticated and this checkout is not linked to the production project.
- Remote migration history could not be freshly verified and `db push --dry-run` was not run.
- Treat these seven migrations as pending until authenticated history inspection proves the exact
  subset: `20260723053444`, `20260723061012`, `20260723061925`, `20260723064500`,
  `20260723151939`, `20260810005135`, and `20260810044832`.
- After history comparison, dry-run and deliberately apply only the verified pending subset. Do not
  reset the production database and do not include any seed or fixture data.

### App environment

- `causent-ai` production lacks `SUPABASE_SERVICE_ROLE_KEY`, `CAUSENT_RECOMPUTE_URL`, and
  `CAUSENT_RECOMPUTE_SECRET`.
- Vercel's environment-name list confirms `CRON_SECRET`, `CAUSENT_RESOLVE_URL`, and
  `CAUSENT_RESOLVE_SECRET`. Vercel does not expose their encrypted values through the local
  pull/run context, so the empty local values do not prove production absence. Verify the injected
  values during deployment and through authenticated canaries.
- `CAUSENT_DEMO_TODAY` remains present and stale. Remove it because the hardened production runtime
  rejects it, and verify that every local demo, seed, fixture, and local-rollout flag is absent.
- The hardened app release check requires `CRON_SECRET`, `CAUSENT_RESOLVE_URL`, and
  `CAUSENT_RESOLVE_SECRET`; run it only in a secure context that supplies their actual values.
- Run `npm run check:release-config` against the actual production values without printing secrets.

### Stateful workers

- Vercel project `causent-recompute` does not exist, so automatic causal recomputation has no
  deployed worker. Create/link it only from the audited stage, configure session-pooler
  `DATABASE_URL` plus `CAUSENT_RECOMPUTE_SECRET`, deploy, and test wrong-secret denial and bounded
  queue draining.
- `causent-resolve` exists but lacks production `DATABASE_URL`. Add the session-pooler credential,
  retain `CAUSENT_RESOLVE_SECRET`, pass `npm run check:resolve-config`, redeploy, and verify the
  authenticated app-to-resolver request.

## Ordered release gates

1. Create the PR from pushed commit `5a67a6f`; obtain green hosted CI and Vercel checks for that
   exact revision; merge through the reviewed path. Branch publication and its Ready Preview are
   complete, but PR creation remains an operator step because the installed integration lacks
   permission.
2. Authenticate/link Supabase, verify history, dry-run, apply the exact pending migrations, and run
   authenticated schema/RLS/Storage/provenance/recompute-status probes.
3. Complete `causent-ai` production configuration and remove stale/local-only values.
4. Create, configure, deploy, and canary `causent-recompute`; arm/redeploy/canary
   `causent-resolve`.
5. Confirm the git-connected `causent-ai` deployment, then run an authenticated clean-account live
   canary across URL/PDF generation, save/activation, three successor iterations, direct historical
   links, private-image reattachment, metric import, three action completions, recomputation,
   resolution, deletion rollback, feature-flag rollback, and production log review.

## Human gates that remain open

- Founder UI/workflow review continues after the operator-directed release.
- The three initially unassisted partner sessions are still missing. At least two must pass four of
  the five recorded usefulness checks. The product-direction override and this release request do
  not satisfy that evidence gate.
- The manual Claude/Codex handoff remains a bounded copy/paste preview. Authenticated MCP/API context
  delivery, reviewed writes, and durable attribution remain deferred until after partner review.
