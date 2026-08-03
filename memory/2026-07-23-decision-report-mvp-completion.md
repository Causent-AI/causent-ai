# Decision Report MVP completion report — 2026-07-23

## Outcome

The bounded Decision Report MVP implementation now includes the post-Slice-10 completion contracts
for blank onboarding, explicit provider egress consent, content-free lifecycle measurement,
future-date enforcement, sanitized automatic-recompute visibility, recoverable error surfaces, and
production/CI guardrails. PR #28 later merged the Slice 8/9 baseline into `main` on 2026-08-03; this
completion work is packaged separately on `codex/decision-report-slice-10`. Publication does not
deploy the app or worker, apply migrations to the partner Supabase environment, or satisfy the
remaining human release gates.

Slice 10 and the later MVP expansions were implemented under the user's deliberate product-direction
override before the normal Slice 9 partner-session gate. That authorization allowed implementation;
it is not evidence that the three initially unassisted partner sessions passed.

## Completed product contracts

### Blank-first onboarding and provider confirmation

- The project brief, URL, and PDF inputs start blank. Gummy Alpha is loaded only through an explicit
  example action.
- Generation requires a separate confirmation that the brief and extracted URL/PDF text may be sent
  to the configured AI provider. Changing any source clears the confirmation.
- A provider or transport failure preserves the user's inputs and leaves a bounded editable fallback
  or actionable retry state. No source is sent before the confirmation and input checks pass.

### Content-free lifecycle telemetry

- The lifecycle records report landing, generation start/editable/failure, save/failure, and
  activation/failure as best-effort events. Telemetry failure never blocks the product action.
- The payload is limited to a server-minted `dr-` UUID session key, elapsed time, bounded edit,
  focused-answer, and remaining-gap counts, plus URL/PDF/fallback/exact-retry booleans.
- Report and prompt text, source content/locators, report/revision/canonical identities, receipts,
  private asset data, raw observations, clipboard packets, and error strings are excluded.
- Aggregation reports distinct-session stage counts and drop-off, median time to editable/save/
  activation, median edit/focused-answer counts, and failure events plus affected sessions.
- Authenticated table privileges are explicitly `SELECT`/`INSERT` only. `UPDATE`, `DELETE`, and
  `TRUNCATE` are revoked so the append-only contract does not rely on RLS for table-wide operations.

### Activation and automatic recompute visibility

- The prediction resolution date must be strictly after the current UTC date in the activation form,
  the shared runtime validator, and the database trigger on activation insert.
- Data Workshop and Impact expose only the explicit current report's sanitized recompute state:
  `idle`, `queued`, `retrying`, `failed`, or `current`, with safe request/processed timestamps.
- The viewer-scoped RPC fails closed without existence leaks. Private queue rows, attempts, hashes,
  raw reasons/errors, actor IDs, and report/activation identities are not exposed.
- Queued, retrying, or failed recomputation leaves the prior causal readouts and immutable report/
  activation history unchanged.

### Recovery boundaries

- Inline generation, save, and activation failures preserve the user's input or exact durable report
  revision and do not create a partial canonical plan.
- Route-level error boundaries cover the app, onboarding, and Data Workshop. They state which saved
  data was not changed and offer retry plus safe navigation to Reports/onboarding.
- Report-native database errors remain visible and actionable; they do not silently substitute legacy
  fixture data.

### Runtime and CI hardening

- Node is pinned to `22.23.0`; the CI workflow pins Python 3.12 and Supabase CLI 2.98.1.
- Production app startup requires an HTTPS Supabase URL, anon key, and server-only
  `SUPABASE_SERVICE_ROLE_KEY`. The service role is required because trusted report generation mints
  the private one-use provenance receipt and ordinary authenticated callers cannot invoke that RPC.
- Release checks additionally require the app recompute URL/secret and cron secret, and the worker
  session-pooler `DATABASE_URL` plus matching recompute secret.
- `CAUSENT_LOCAL_DEMO`, `CAUSENT_USE_SEED`, `CAUSENT_DECISION_REPORT_FIXTURE`, and
  `CAUSENT_DECISION_REPORT_LOCAL_ROLLOUT` must be absent in production. Invalid production runtime
  configuration returns a no-store `503`; logs contain variable names and issue codes, not values.
- The expanded CI workflow starts a clean Supabase stack and runs TypeScript, full lint, the
  serialized Node/Supabase/RLS/Storage suite, schema lint, the complete engine/bridge suite,
  recompute bundle staging, and the Next.js 16 webpack production build.
- The shared dashboard layout is explicitly request-bound with `dynamic = "force-dynamic"`, so a
  production build cannot freeze seed or pre-activation state into current-report surfaces.
  `check:dashboard-build` inspects the build manifests and fails unless Actions, Data Workshop,
  Impact, and Reports exist and remain outside the prerender manifest. It passes locally and CI runs
  it immediately after the webpack build.

## Confirmed verification for this completion pass

- Clean local Supabase reset: **PASS**
- Error-level schema lint: **PASS**
- Serialized Node library/Supabase/RLS/Storage suite: **499 total; 480 passed; 19 intentional
  live-model skips; zero failures**
- Focused integration verification: **9/9 passed**
- Complete engine/bridge/isolation/recompute/function/concurrency suite: **1,204/1,204 passed**
- TypeScript: **PASS**
- Full application lint: **PASS**
- Next.js `16.2.11` webpack production build: **PASS**. Actions, Data Workshop, Impact, onboarding,
  and Reports all build as dynamic routes.
- Post-build dashboard manifest guard: **PASS** for Actions, Data Workshop, Impact, and Reports.
- Browser/console acceptance: **PASS** through Iteration 4. Blank-first onboarding, explicit Gummy
  example loading, provider confirmation, generation/save/activation, three sequential successors,
  predecessor-current behavior, four-item Reports lineage, original read-only direct-link access,
  current-only Actions/Data Workshop/Impact views, sanitized `queued` recompute status, honest
  no-evidence Impact, and legacy-flow rollback were verified. The browser warning/error log was empty.

The local worker endpoint was intentionally absent, so immediate kicks recorded only the sanitized
server-side `not_configured` deferred outcome while source writes stayed durable. The expanded hosted
CI workflow has not run for this working tree.

## Exact remaining release gates

1. Finish one final deep UI/workflow review across blank onboarding, source consent, report editing,
   activation, Reports iterations, Actions & Decisions including manual AI copy/paste, Data Workshop,
   Impact, recovery states, and responsive/accessibility behavior.
2. Run at least three initially unassisted partner sessions; at least two must pass four of five:
   decision accurate, problem accurate, evidence traceable, metric mechanism plausible, next action
   usable. Record intervention, abandonment, and time to completion.
3. Require a green hosted CI run for the exact release revision.
4. Apply `20260723053444`, `20260723061012`, `20260723061925`, `20260723064500`, and
   `20260723151939` to the partner environment, then rerun schema lint and authenticated
   RLS/Storage/recompute-status probes.
5. Configure the production app's Supabase URL, anon key, server-only service-role key, recompute
   URL/secret, and cron secret; configure the worker's session-pooler `DATABASE_URL` and matching
   recompute secret; verify the four local-only flags are absent.
6. Deploy deliberately and run one authenticated clean-account canary covering URL/PDF generation,
   protected first save, activation, three successor cycles, exact retries and stale conflicts,
   direct historical links, private-image reattachment without cross-report reuse, current-report
   isolation, observation/action recompute triggers and status, deletion rollback, and rollout
   disablement.

## Deferred beyond partner review

The authenticated Claude/ChatGPT MCP/API loop remains deferred until after the partner review. Its
future contract still needs scoped OAuth, explicit read/write tools, reviewed mutations, and durable
PR/artifact attribution. The shipped manual copy/paste preview is transient and advisory; it is not a
partial MCP and has no report, action, recompute, or attribution write path.

Also still deferred: OCR, URL crawling, multiple documents, authenticated-page ingestion, broader
file quarantine, lower statistical floors, autosave, hard deletion/restoration, richer revision/
export UI, model chat/regeneration, and numeric Completion Outlook.
