# Decision Report Slice 7 — report-native metric CSV ingestion

## Status

Implemented on `codex/ai-decision-report` on 2026-07-22. Changes remain uncommitted as requested.

## Contract

- One `.csv`, at most 256 KB and 10,000 observations.
- UTF-8, optional BOM, LF or CRLF, exact `date,value` header, exactly two unquoted and unpadded fields per row.
- Dates are strict calendar `YYYY-MM-DD` values and normalize to the Postgres daily `date` key. Values are finite plain numbers capped at magnitude `1e15`.
- Duplicate dates inside the file reject the entire import. Any invalid row rejects the entire import and writes zero observations.
- Existing rows for the same metric/date are updated intentionally; new dates are inserted; observations on dates absent from the file are preserved.

## Isolation and persistence

The browser supplies only the file. The server resolves the authenticated workspace's newest activated Decision Report and its confirmed metric. The `import_active_report_metric_csv_v1` database function re-checks scope, report status, active metric pointer, member authorization, daily granularity, and declared/CSV source under report and metric locks. It performs one atomic primary-key upsert and changes the confirmed metric source from `declared` to `csv`. It never creates a second metric or accepts an arbitrary report/metric target from the client.

Report-created metric names outside the deterministic demo catalog now receive a neutral display configuration only while an activated report selects them. Workspaces without an activated report still receive the exact legacy configured metric catalog.

## UI

Data Workshop now supports browse and drag/drop, pending state, actionable parser/database errors, and a success summary containing accepted/rejected rows, date range, inserted rows, updated rows, and an explicit statement about whether existing observations changed. A successful action revalidates Data Workshop and the shared dashboard layout so Core Metrics refreshes immediately.

The browser pass also exposed and fixed an empty-series regression in the Slice 6 Core Metrics drawer: an activated report metric now shows the intentional “no data” handoff instead of asking the chart/delta helpers to read a missing latest observation.

## Tests and boundaries

Coverage includes pure parser cases, repository packet/result validation, invalid identity short-circuiting, database retry/idempotency, forged report/metric combinations, cross-workspace denial, and authenticated member-versus-viewer RLS behavior.

No warehouse connector, spreadsheet format, file storage, background job, causal recomputation, evidence object, or deletion/replacement of unrelated dates was added. The untracked `plugins/` directory and all Slice 6 work were preserved.

## Verification

- TypeScript and focused ESLint passed.
- Full library suite: 393 tests, 374 passed, 19 live/environment skips, 0 failed.
- Local authenticated Supabase RLS suite: 24 passed.
- Supabase schema lint: no errors.
- Next.js 16 webpack production build passed.
- `git diff --check` passed.
- Browser acceptance passed against the production build: a valid three-row upload rendered the series immediately in Data Workshop and Core Metrics; malformed-header and duplicate-date files each showed actionable atomic no-write errors; browser console stayed clean and requests completed successfully. The three test observations were then removed and the local metric restored to its declared/no-data state.
