# Production schema activation and release rehearsal — 2026-08-18/19

## Outcome

Production Supabase `royftsqyawtyfjolfabd` advanced from 11 to **42/42 migrations** through the
rehearsed phased run plus the dedicated worker-role apply. The database schema and worker
configuration are deployed; the application and workers are not. The public app alias still serves the verified rollback artifact,
and no worker/app candidate, canary, rollout assignment, or promotion occurred. Causent is not
declared production-ready, scale-proven, founder-approved, or partner-validated by this work.

## Source, app, and rollout state

- The release source began from the reviewed `codex/decision-report-review-hardening` tree, whose
  content matched `origin/main` before this hardening work.
- The public app remains on the pre-guard rollback artifact. No new Vercel app deployment or domain
  promotion occurred.
- `causent-drift`, `causent-recompute`, and `causent-resolve` Vercel projects now exist. Matching
  high-entropy Sensitive secrets are configured on each worker and on `causent-ai`; all three app
  worker URLs are configured; and `CRON_SECRET` was rotated. The app also retains Sensitive,
  server-only `SUPABASE_SERVICE_ROLE_KEY`, and stale `CAUSENT_DEMO_TODAY` remains removed. Every
  worker has its own exact role-specific Supavisor `DATABASE_URL` stored Sensitive.
- No `decision_report_rollouts` row was inserted. The schema apply did not enable Decision Report
  onboarding for a partner account.
- No production seed was loaded and no database password rotation occurred.
- No credential value is recorded in this report.

## Production Supabase apply

The exact production sequence was:

1. Confirm the production baseline at 11 migrations.
2. Apply 20 Phase A migrations, reaching 31.
3. Build eight parent/hot indexes concurrently, one statement at a time outside migration
   transactions. All eight report ready, valid, and live; the three identity indexes remain unique.
4. Apply six Phase B1 migrations, reaching 37 while the contract transition remained controlled.
5. Apply Phase B2 and drain the owner-only multi-metric backfill. Its exact final result was
   `(processed_count=0, last_activation_id=NULL, has_more=false)`.
6. Apply Phase B3. All 17 targeted constraints are validated and zero remain invalid.
7. Apply Phase B4. One callable overload each of activation v1, v2, and v3 is present; the rollout-
   only backfill function is gone.
8. Apply `20260819044116_harden_security_definer_function_acl.sql`, reaching 41/41.
9. Apply `20260819053842_provision_causent_worker_roles.sql`, reaching 42/42. Verify the exact
   production role attributes, memberships, grants, and three `aws-1` session-pooler logins.

Migration 42 apply/catalog checks and error-level lint for `public`, `private`, and `storage` pass.
A serialized post-42 dry-run reports the remote database up to date.

## Privileged-function security result

The earlier production-data branch audit found 17 public SECURITY DEFINER functions effectively
executable by `anon`, primarily because owner/default privileges survived older schema-local revokes.
No present cross-tenant row leak or write bypass was demonstrated, but the privileged RPC surface was
a release blocker and future regression risk.

The applied ACL migration:

- revokes function execute from PUBLIC and `anon` for future `postgres`-owned functions globally and
  in `public`;
- revokes PUBLIC/anonymous execution from every current public SECURITY DEFINER function;
- restores authenticated/service execution only for the eight self-gating RLS helpers;
- sets `role_rank(text)` to an empty search path and denies anonymous execution;
- grants `handle_new_user()` only to `supabase_auth_admin` among application/auth roles;
- creates/drops a transactional probe to prove the future-function default is closed; and
- aborts if any public SECURITY DEFINER function remains executable by `anon`.

Production now has 37 public SECURITY DEFINER functions. `anon` executes 0/37 and 37/37 use the fixed
empty search path. Regression tests in `engine/tests/test_rls_isolation_adversarial.py` and
`engine/tests/test_auth_allowlist.py` lock the catalog invariant, future owner default, comparator
search path/ACL, and auth-hook ACL. Supabase still reports leaked-password protection as disabled;
that platform setting remains an operator task.

## Applied dedicated worker roles

Migration 42 defines three passwordless `NOLOGIN`, `NOINHERIT` identities and clears any rehearsal
memberships/grants before installing bounded privileges:

- `causent_drift_worker`: drift queue claim plus detector reads and replacement of the derived drift
  projection only;
- `causent_recompute_worker`: recompute queue claim and immutable target locks, then SET-only,
  non-inherited `authenticated` membership for the stored actor's RLS graph work; and
- `causent_resolve_worker`: no direct application/private grants, only SET-only, non-inherited
  `authenticated` membership for the supplied actor's RLS sweep.

None can assume or inherit `service_role`. A dedicated catalog test file covers exact attributes,
memberships, grants, effective access, queue separation, and auth/storage denial. The full local
reset passes, those role tests pass 8/8, and the disposable-clone Supavisor rehearsal passed before
its credentials were disabled. Production migration/catalog checks pass, and three separate
generated login passwords were attached without widening the source contracts. The exact production
Supavisor DSN shapes are:

```text
postgresql://causent_drift_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
postgresql://causent_recompute_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
postgresql://causent_resolve_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

The username must be the exact target role plus the 20-character project ref, the password must be
nonempty, and the host/port/path/query must remain
`*.pooler.supabase.com:5432/postgres?sslmode=require`. Never use `postgres`, `service_role`, a direct
database host, port `6543`, or one DSN for multiple workers. All three Sensitive worker
`DATABASE_URL` values are configured on their matching projects and verified through the `aws-1`
session pooler. No deployed worker has consumed them yet.

The refreshed local gate reports a full reset, 8/8 worker-role tests, local error-level schema lint,
671 credentialed Node tests total (652 passed, 19 intentional live-model skips, zero failures), and
1,290/1,290 engine/bridge/isolation tests passed. Production error-level lint and role catalog checks
also pass. These results are database/source evidence, not worker or app deployment canaries.

## Query-plan and scale boundary

The production-data clone used for preflight was only about 13 MiB. Authenticated hot-read probes used
the expected indexes on three of five paths. Postgres chose sequential scans for the actions and
evidence reads; the evidence path took roughly 60–87 ms in the observed runs. The production apply
does not convert that result into representative-volume evidence. No 10,000-users/hour or gigabyte-
scale claim is supported, and the protected remote k6 matrix remains unrun.

## Release-tooling hardening in source

- Drift, recompute, and resolve have symmetric stage-only deployment scripts with narrow import
  closures, Python 3.12, exact NumPy/psycopg versions, Vercel CLI `56.0.0`, and exact team/project
  link assertions.
- Worker and app release checks reject weak, repetitive, and placeholder drift/recompute/resolve/cron
  secrets. The gate accepts the documented high-entropy random forms and never includes a rejected
  secret value in validation output.
- Each deploy path and Python runtime now validates the exact target-specific role/ref Supavisor DSN
  before database work. Owner, `service_role`, cross-worker, direct-host, and malformed DSNs fail
  closed with value-free error codes.
- The production resolve cron discovers only due workspaces, selects an explicit write-capable actor
  under inherited membership semantics, and caps a run at 20 workspaces/four concurrent calls. It
  repeats every five minutes to drain backlog while preserving the 15:00 UTC decision-day cutoff,
  returns identity-free production summaries, and keeps the fixed registry/actor local-demo only.
- Worker `--prod` deployment uses `--skip-domain`. It creates an immutable production-environment
  candidate; promotion is a separate
  `vercel@56.0.0 promote <url> --scope "$VERCEL_ORG_ID"` command after canaries.
- CI stages all three bundles, checks file counts/import boundaries/pins, compiles/imports staged
  functions, and runs the load-contract tests. The complete `release_gate` matrix includes the
  adversarial isolation profile, creates the ignored result directory on clean runners, and fails
  when a required k6 artifact is absent.
- The staging-load harness disables automatic redirects and rejects login results. Remote profiles
  now require an external HTTPS lease broker configured through
  `CAUSENT_STAGING_SESSION_POOL_URL` and high-entropy
  `CAUSENT_STAGING_SESSION_POOL_TOKEN`. Each request binds `github:<run>:<attempt>` as a durable
  allocation set and one profile lease; the versioned response must supply canonical issue/expiry
  timestamps and the exact profile capacity.
- The response contract parses each real Supabase access-token `session_id`, user subject, and
  refresh-token lineage. Sessions must be distinct within a lease, disjoint across every profile in
  the allocation set, and single-use across retries. A transient JSON generator cannot satisfy the
  durable broker boundary.
- The adversarial profile requires a foreign-owner session outside every load pool, a real foreign
  workspace UUID, and a bounded tenant marker. Setup first proves that the foreign session can see
  its marker. Only then may load-user sessions forge that workspace cookie and prove the marker is
  absent. Without the positive control, the isolation run fails rather than producing false evidence.

These are source and network-free contract changes. The external broker has not been implemented,
audited, or configured, so protected live staging load is operator-blocked and did not run. Worker
projects, matching strong Sensitive app/worker secrets, app URLs, and rotated cron secret exist, but
their role-specific Sensitive `DATABASE_URL` values are configured and no worker was
deployed/canaried/promoted.

## Explicitly not done

- No production seed or Decision Report rollout assignment was added during schema activation.
- No production database password rotation.
- Worker projects, matching strong Sensitive secrets, app URLs, rotated cron secret, dedicated role
  credentials, and exact Sensitive Supavisor DSNs were configured, but no worker candidate,
  deployment, canary, or promotion was added.
- No external session broker implementation, audit, configuration, or protected live staging run.
- No app candidate, worker candidate, authenticated canary, alias promotion, or rollback-pointer
  change.
- No hosted CI result for this exact release-hardening source.
- No production private-image byte-delivery canary.
- No founder sign-off or initially unassisted partner-session evidence.

## Resume order

1. Decide whether a later primary production database password rotation is desired. Dedicated worker
   credentials are already separate and configured.
2. Enable Supabase leaked-password protection.
3. Remove the billable rehearsal branch after its evidence is no longer needed.
4. Retain the verified, separate worker credentials and exact role/ref Supavisor DSNs; run every
   target release check with protected values immediately before deployment. Never use `postgres` or
   `service_role` as a worker identity.
5. Implement and security-audit the durable session broker. Configure
   `CAUSENT_STAGING_SESSION_POOL_URL` and high-entropy `CAUSENT_STAGING_SESSION_POOL_TOKEN`, then
   obtain green hosted CI and protected staging-load artifacts for the exact revision. Preserve the
   adversarial foreign-tenant positive control, retain plans/pool/lock/queue telemetry, and do not
   convert the small-clone plans into a scale claim.
6. Create worker candidates with `--prod --skip-domain`, canary immutable URLs, then promote each
   explicitly. Update and verify the app worker endpoints only after worker promotion.
7. Create a no-alias app candidate, run clean-account URL/PDF/save/activate/successor/private-image/
   import/completion/recompute/drift/resolution/rollback canaries and review logs. Add a rollout row
   only as a deliberate controlled-release step after these dependencies work.
8. Promote the app deliberately only after the exact candidate passes.
9. Continue the founder's deep UI/workflow review and the still-missing initially unassisted partner
   sessions. Neither is replaced by database schema activation.
