# GA4 implementation plan

Baseline: `01535f2`, following draft PR #36. Scope: GA01–GA04 and SEC01 from the [handoff](../../handoffs/ga4-core-metrics.md). Existing analysis models remain unchanged.

## Build

1. GA01: admin-only connector authorization, browser-bound single-use OAuth state, fixed redirect, accessible-property discovery, preview and confirmation. Keep connector consent separate from Causent login.
2. GA02: private encrypted credentials; scoped public metadata, immutable mappings and receipts; a dedicated PostgREST worker role with RPC access only. Browser users cannot write provider observations or read credentials.
3. GA03: bounded provider requests, daily backfill/overlap, connection leases and generations, atomic replacement of completed date windows, retry/revocation handling, durable scheduled sync.
4. GA04: create confirmed connector metrics, retain property-local dates/timezone, expose core selection and provenance, and queue existing analysis. Withhold unsafe/stale provider input; preserve prospective registration and model rules.

## Test and review

- Provider/crypto unit tests: scopes, payload validation, dates/timezones, pagination, quality, refresh and error redaction.
- Real local database tests: role/tenant denial, state replay, stale leases, removed membership, revocation, atomic imports and idempotency.
- Application/engine regression suites and browser review; full hosted CI on the submitted commit.
- SEC01: source review, dependency scan, local grants/RLS/storage/advisors and accessible deployed configuration. Record inaccessible surfaces rather than implying they passed.
- Live acceptance requires an authorized Google OAuth client/property. Local configuration currently contains no GA4 credentials; build and automated tests can proceed independently.

## Delivery

Concise engineering/security review, operator setup and rollback instructions, canonical documentation updates, then a draft PR based on #36. No production migration, connector enablement, merge or release is part of this step.
