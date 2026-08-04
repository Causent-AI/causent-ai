# Decision Report Slice 10 — expanded MVP implementation report

## Product-direction override

The user explicitly authorized Slice 10 implementation before the normal Slice 9 partner-session
gate. This is an implementation override only. The three initially unassisted partner sessions have
not occurred and are not claimed as passed. The same direction expanded this local MVP slice to
bounded URL/PDF ingestion and automatic causal recomputation; it did not authorize production
deployment or the broader deferred roadmap.

## Regression diagnosis and repair

- Onboarding exposed `decision_report_series_scope_id_fkey` after the local database was reset
  without restoring the demo workspace. The report insert trigger attempted to create a series for
  that missing scope. The trigger now checks the workspace first and returns the same closed,
  non-enumerating authorization error as other checked report writes.
- Actions & Decisions appeared two iterations old because `loadDashboardData()` silently returned
  `lib/seed.ts` whenever a database read failed. Seed data now loads only behind
  `CAUSENT_USE_SEED=1`; database failures surface instead of disguising current-report errors.
- Workspace selection previously depended on inferred recency. The schema now owns
  `workspaces.current_decision_report_series_id` as well as each series' current report pointer, and
  Actions & Decisions, Data Workshop, Impact, imports, completion, and recomputation use those
  explicit identities.
- A repeatable local reset/demo command restores the required workspace after clean resets.

## Delivered: immutable linear report iterations

- Workspace-bound linear series, explicit workspace/current-report pointers, backfill, constraints,
  RLS, and grants. No branches or merges are inferred from order or timestamps.
- Checked successor start with a required reason, report → series → workspace locks, exact-retry
  reuse, changed/stale conflict, stable logical IDs, and private `assetIds` stripping.
- Atomic canonical activation plus pointer movement. The predecessor remains operational until the
  successor's new decision, prediction, actions, activation audit, and pointers commit together.
- Historical reports, revisions, activations, canonical graphs, evidence, impact, and private assets
  remain unchanged. Current removal rolls back only to the nearest live active predecessor in the
  same series.
- Private `xid8` one-use capabilities guard workspace pointer movement, legacy activation wrapping,
  report-native action completion, and primary-lever mutation. Callers cannot forge them with a GUC
  or reuse them after the checked transaction.
- Reports groups and links iterations; the editor can start, edit, save, activate, view, and safely
  remove a successor. Private images must be reattached through the existing sanitized image path;
  no asset ID or object path is copied across reports.

## Delivered: bounded URL/PDF sources and provenance v2

- Generation accepts the project brief plus at most one public HTTPS page and one text-based PDF.
- URL retrieval requires HTTPS/443, forbids credentials, rejects any private/special DNS or IP
  result, pins the validated address, revalidates up to three redirects, accepts only UTF-8
  HTML/plain text with identity encoding, and caps the response at 1 MiB and 10 seconds. Query
  strings, fragments, credentials, cookies, and response bytes are not retained.
- PDF extraction accepts one file up to 5 MiB and 40 pages in a worker capped at 12 seconds and
  128 MiB old-generation heap. It rejects invalid signatures, encryption, active content, embedded
  files, malformed input, and documents without readable text. There is no OCR or crawl behavior.
- Each extracted source is capped at 48,000 characters; the combined corpus is capped at 72,000 and
  chunked at 2,000 characters. Schema-v2 revision snapshots retain bounded chunk text, sanitized
  locators, and SHA-256 digests so evidence remains auditable without retaining raw source bytes.
- Database validation recomputes source/chunk digests and rejects malformed summaries, duplicate
  IDs, and `sourced` claims that reference missing chunks. A private 24-hour, one-use receipt is
  minted only by the trusted generation path and binds scope, actor, exact source summaries, and the
  sourced-claim multiset. First save consumes it atomically; exact lost-ack replay reuses the result,
  changed replay conflicts, and later revisions freeze the corpus while allowing claims only to
  remain or be removed. Authenticated consistently rehashed forgeries fail closed. Source-free
  reports with no sourced claims need no receipt. Historical v1 remains readable; newly authored
  content is v2, and a legacy-derived successor must be explicitly saved as v2 before activation.

## Delivered: automatic current-report causal recomputation

- Activation v2 requires one selected action as the primary manual lever and enqueues work for the
  immutable activation. Current-report metric observation inserts/updates and primary-action
  completion enqueue the same target.
- `private.causal_recompute_jobs` coalesces requests by activation with monotonic generations,
  reason sets, stable input hashes, attempts, backoff, and processed receipts. Application roles
  have no queue privileges.
- The stateful worker holds report → series → workspace → activation locks through graph write and
  receipt commit. It records superseded work without touching a historical graph when either
  current pointer moved.
- Exact unchanged input is a no-op. Failures use a savepoint plus generation-guarded retry/failure
  receipts. BH-FDR is calculated over the complete eligible workspace action family, but only the
  current activation's selected action/metric rows are persisted.
- Immediate wake-up is best-effort after the source transaction commits. A five-minute authenticated
  cron is the durable fallback. The 45-day-per-side confident ITS floor remains unchanged.
- `scripts/deploy-recompute.sh --stage-only`, `api/DEPLOY.md`, and `.vercelignore` produce a tested
  18-file Python 3.12 worker stage with exact NumPy/psycopg versions and `maxDuration=300`. Nine
  function tests pass. No Vercel project was linked and nothing was deployed.

## Verification recorded in this run

- Clean local Supabase reset: passed with every migration applied.
- Supabase schema lint at error level: passed.
- Serialized Node library/Supabase/RLS/Storage suite: 471 total, 452 passed, 19 intentional live-polish
  skips, zero failed. The serialized aggregate is the authoritative database result.
- Complete engine, bridge, RLS, recompute, function, and concurrency suite: 1,200 passed.
- TypeScript, focused application lint, dependency audit, and `git diff --check`: passed.
- Next.js 16 webpack production build: passed. The bounded PDF worker uses a runtime literal
  `require("pdf-parse")` plus route-specific output tracing; the emitted trace includes the parser,
  PDF worker, and native canvas binary.
- Browser acceptance created and activated the initial report plus two successors, verified current-
  only Actions & Decisions/Data Workshop/Impact content, grouped lineage, a direct historical link,
  current-removal rollback to iteration 2, and decision-report feature-flag rollback to legacy.
- A real one-page text PDF was parsed in the production server, saved through the one-use receipt,
  and reopened by direct report URL. A real public HTTPS page was fetched, generated, and saved. The
  browser console was clean. This pass found and fixed Node 26's all-address custom-DNS callback
  shape while preserving the validated public-address pin.
- Database integration covers the longer report 1→2→3→4 sequence, exact retries, stale/changed
  conflicts, deletion rollback, forged/cross-workspace identities, private asset stripping and
  reattachment isolation, and historical graph immutability.

## Still open at this handoff

- Run the three real initially unassisted partner sessions and record the five-part rubric; the
  product-direction override did not satisfy this human gate.
- Apply the four 2026-07-23 migrations to the partner Supabase project, then configure the stateful
  recompute function with `DATABASE_URL` and `CAUSENT_RECOMPUTE_SECRET`. Configure the app with
  `CAUSENT_RECOMPUTE_URL`, the matching secret, and `CRON_SECRET`; deploy only with explicit approval
  and run authenticated migration/RLS/Storage/recompute/browser canaries.
- No commit, push, pull-request mutation, deployment, production migration, or `plugins/` change is
  part of this implementation report.

## Deliberately still outside the MVP

OCR, URL crawling, multiple documents, authenticated-page retrieval, broad file ingestion or
malware quarantine, account-level connector OAuth, warehouse connectors, conversational delivery,
autosave, hard deletion, automatic action cancellation, historical graph rewriting, lower
statistical floors, Completion Outlook, and revision diff/restore/export UI remain deferred.
