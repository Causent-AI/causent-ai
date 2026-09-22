# Google Analytics

Implementation: GA01–GA04 on `codex/ga4-core-metrics-security`. Disabled by default. [Review and acceptance status](../reviews/2026-09-21/GA4_ENGINEERING_REVIEW.md).

## Setup pending

Google account creation is deferred at the user's request. Keep the existing **Setup required** card as the placeholder and leave `CAUSENT_GA4_ENABLED` unset or `0`. Do not populate account/property IDs or credentials with dummy values. No live Google data has been imported.

- [ ] Create the Google account when ready.
- [ ] Set up a GA4 property with observed data and the connector OAuth client described below.
- [ ] Complete real-property acceptance and the hosted security checks before enablement.

These steps are deferred release prerequisites; they do not block review of the disabled connector.

## Product flow

A workspace owner/admin opens Data Workshop → Google Analytics → Connect, approves read-only Google access, then chooses a property, previews a metric, and confirms Import. After sync, the metric appears in Workspace Metrics and can be selected as a Core Metric. Existing report bindings and measurement plans consume its daily observations. Viewers can inspect connection health but cannot configure it.

One connection holds one property and up to three immutable mappings: `sessions`, `engagedSessions`, and `eventCount` (optionally one named event). To change a property, event filter, timezone, or direction, create a new connection. Importing another supported metric adds a mapping. Names remain editable. These count metrics use daily totals; unique-user and rate metrics are outside this release.

## Operator setup

1. Apply the preceding branch migrations and `20260922000213_ga4_core_metrics.sql` to staging through the normal migration release process. This adds five connector tables, a worker role/RPC, provider-write guards, health/readout gates, and property-timezone support. It performs no customer backfill. Deploy the updated recompute worker with the application: its measurement loader now reads connector metadata.
2. Enable the Google Analytics Data and Admin APIs. Register a **web application** OAuth client, its consent screen/test users, and the exact HTTPS callback `https://<application-host>/api/ga4/callback`. Connector consent is separate from Causent login. Requested scopes are `analytics.readonly` and `openid`; identity is used only to preserve a refresh token for the same Google account. Complete any Google verification required before public access.
3. Configure the variables below as server-only values, with separate staging/production credentials. Keep the flag off until configuration, permissions and acceptance checks pass.

| Variable | Contract |
|---|---|
| `CAUSENT_GA4_ENABLED` | `1` enables routes/UI/sync; otherwise disabled. Local demo/seed modes cannot enable it. |
| `GA4_CLIENT_ID`, `GA4_CLIENT_SECRET` | Connector OAuth client, separate from Supabase login. |
| `GA4_REDIRECT_URI` | Exact callback above; no query/fragment. HTTP loopback is allowed only in development. |
| `GA4_ENCRYPTION_KEY` | Cryptographically random 32-byte key, standard base64. Back up in the secret manager. |
| `GA4_WORKER_JWT` | Expiring JWT trusted by this Supabase project, with `role=causent_ga4_worker`. Never an anon, authenticated, or service-role token. |
| `GA4_OVERLAP_DAYS` | Optional integer 7–180; default 7. |
| `CRON_SECRET` | Existing strong cron secret; the GA4 endpoint uses the same authentication boundary. |

Issue the worker token through the project's controlled signing process. Supabase supports [externally minted JWTs using an imported signing key](https://supabase.com/docs/guides/auth/jwts#using-custom-or-third-party-jwts). Keep the signing key outside the app; deploy only the scoped token, and arrange renewal before `exp`. Local verification used the disposable project's HS256 key. Hosted signing-key compatibility and rotation must be verified on staging. Test that `ga4_worker_v1` works and direct table reads fail; do not grant the worker direct table access to solve a configuration error.

The Vercel schedule invokes `/api/cron/ga4` every 15 minutes; a connection becomes due daily. Confirm the hosting plan supports that schedule and a 300-second function. Each invocation claims at most four connections with a 220-second provider budget. Import/Sync also requests a bounded post-response drain. Publication durably queues recompute even if the immediate worker wakeup fails.

## Data and trust boundaries

The initial import covers up to 180 completed property-local days. Later runs refresh the overlap and catch up after downtime, capped at 180 days. Pages are bounded and validated before one atomic transaction replaces each fetched window. Missing rows remain gaps, including when Google removes a previously returned day. There is no synthetic zero fill.

`public.ga4_connections`, `ga4_metric_mappings`, and `ga4_sync_receipts` contain workspace-readable metadata. `private.ga4_credentials` holds AES-256-GCM ciphertext bound to workspace/connection; `private.ga4_oauth_states` holds ten-minute, single-use state hashes. Browser clients receive neither token material nor Google account identifiers. OAuth state also requires the initiating browser's HttpOnly cookie.

Receipts record range, timezone, row count, missing days, quality, fetch time, generation and a database-computed SHA-256 digest. Analysis manifests retain property, mapping/filter and receipt provenance. Thresholded, sampled, restricted and other-row results are withheld. Disconnected, unauthorized, stale (>3 days behind), and newly revised-but-not-recomputed inputs cannot display an older confident result. Existing prospective registration, exposure records and 45–180-day windows still apply; imported history alone does not prove impact.

## Acceptance before enablement

Use one consenting customer's staging property. Verify consent → property discovery → preview → import; compare several dates and totals against a matching GA4 query, including property timezone and event filter. Select the imported Core Metric and verify report/measurement input provenance. Confirm a second sync revises observations without duplicates, missing/quality-limited data stays withheld, and disconnect stops a pending sync. Keep evidence redacted. Automated fixtures do not complete this acceptance.

Also verify hosted RLS/advisors, private-schema exposure, Storage/auth settings, worker-token expiry/rotation, preview/production secret separation, cron authentication and deployed response headers. See [SEC01 findings](../reviews/2026-09-21/SECURITY_REVIEW.md).

## Operations and rollback

Connection state and sanitized error codes appear in Data Workshop. `reauthorize` requires Reconnect; quota/unavailable/invalid-response failures retry with a 15-minute to 24-hour backoff. Sync is rate-limited after a recent successful run. Logs contain `[ga4] sync` with processed/failed counts or `sync unavailable`; no account IDs, request payloads or tokens are logged by the connector. Inspect receipts through an authorized workspace session for detailed provenance.

Disconnect commits local generation invalidation and deletes credentials before attempting Google revocation; a provider outage cannot keep collection running. Stored metric/evaluation history remains. If Google revocation fails, the UI asks the user to remove Causent access in their Google Account. Revocation can also affect other connections sharing that Google grant; reconnect those with explicit consent.

For rollback, disconnect affected connections while the configured app remains available, then disable `CAUSENT_GA4_ENABLED` and remove the worker token from the deployment. If an emergency requires disabling first, invalidate connections/delete credentials through the reviewed database operator path before permitting any restart; disabling the flag alone does not cancel an already running function. Preserve tables, receipts and the updated analysis gate. Do not roll back to an older worker that would analyze retained GA4 metrics without these safeguards. Encryption-key replacement requires coordinated re-encryption or disconnect/reconsent; simply changing the key makes stored tokens unreadable.
