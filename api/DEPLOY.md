# Production schema activation — 2026-08-18/19; application rollout stopped

The production Supabase project `royftsqyawtyfjolfabd` is now at **42/42 migrations**. This is a
database and configuration checkpoint, not an application release: the public app alias still serves
the verified rollback artifact, and no worker/app candidate, canary, promotion, or rollout occurred.

- Phase A applied 20 migrations from the production baseline of 11. Eight parent/hot indexes were
  then built concurrently outside migration transactions; every index is ready, valid, and live.
- Phase B1 applied six migrations. Phase B2's owner drain returned exactly
  `(processed_count=0, last_activation_id=NULL, has_more=false)`. Phase B3 validated all 17 targeted
  constraints and left zero invalid. Phase B4 left one callable overload each of activation v1, v2,
  and v3 and removed the rollout-only backfill function.
- `20260819044116_harden_security_definer_function_acl.sql` and the dedicated worker-role migration
  applied in production. A serialized post-42 dry-run reports the remote database up to date; the
  production role catalog and error-level schema lint also pass.
- Production has 37 public SECURITY DEFINER functions: `anon` can execute 0/37, and 37/37 have the
  fixed empty search path. The ACL migration also closes future `postgres` function defaults,
  restores only intended authenticated/service grants, and limits `handle_new_user()` to
  `supabase_auth_admin`.
- No `decision_report_rollouts` assignment was created, so the controlled partner rollout was not
  enabled. No production seed was loaded during schema activation, and no database password rotation
  was performed.
- Vercel projects `causent-drift`, `causent-recompute`, and `causent-resolve` now exist. Matching
  high-entropy Sensitive worker secrets are configured on each worker and on `causent-ai`; the three
  app-side worker URLs are configured; and `CRON_SECRET` was rotated. The root app also has Sensitive
  `SUPABASE_SERVICE_ROLE_KEY`, and stale `CAUSENT_DEMO_TODAY` remains removed. Each worker now has its
  own exact role-specific Supavisor `DATABASE_URL` stored Sensitive. The serving rollback artifact
  has not consumed the repaired app environment.
- Migration 42 passed a full local reset, an isolated disposable-clone Supavisor login rehearsal,
  and production apply. Clone credentials were disabled afterward. In production, all three roles
  have separate generated credentials and exact attributes, memberships, grants, and target-specific
  `aws-1` session-pooler access were verified. Local worker-role tests pass 8/8; local and production
  error-level schema lint pass.
- The refreshed local gate reports 671 credentialed Node tests total (652 passed, 19 intentional
  live-model skips, zero failures) and 1,290/1,290 engine/bridge/isolation tests passed. These local
  results and database catalog checks do not replace hosted deployment canaries.
- Release checks now reject weak, repetitive, or placeholder drift/recompute/resolve/cron secrets and
  accept the documented high-entropy random forms without echoing values. The deploy gate and each
  Python runtime also validate the exact target-specific role/ref Supavisor DSN before database work;
  owner, `service_role`, cross-worker, direct-host, and malformed DSNs fail closed. Worker production
  deploys still use `--skip-domain` and require separate promotion after immutable-URL canaries.
- Production resolution discovers only due workspaces, chooses an explicit write-capable actor under
  inherited membership semantics, and sends both scope and actor to the resolver. The cron caps each
  invocation at 20 workspaces/four concurrent calls, repeats every five minutes to drain backlog,
  preserves the 15:00 UTC decision-day cutoff, and returns identity-free production summaries; only
  local demo retains the fixed fixture registry and fallback actor.
- The staging-load source now requires an authenticated external broker configured through
  `CAUSENT_STAGING_SESSION_POOL_URL` and a high-entropy
  `CAUSENT_STAGING_SESSION_POOL_TOKEN`. Each broker response must bind a durable allocation set and
  profile lease to distinct, disjoint, single-use sessions with real Supabase auth-session lineage.
  The complete `release_gate` matrix includes the adversarial profile, which retains a separate
  foreign-owner positive control outside every load pool. Clean runners create `load/results`, and a
  missing profile artifact fails rather than merely warning.
  The broker itself has not been implemented, audited, or configured, so live staging load is
  operator-blocked and no protected profile has run.

Open operator gates are: decide whether a later primary database-password rotation is desired; enable
Supabase leaked-password protection (still reported as a warning); implement, audit, and configure the staging
session broker; run the exact hosted source gate and protected staging profiles; deploy no-alias
worker/app candidates; canary the complete authenticated loop; then promote explicitly. Delete the
billable with-data rehearsal branch after its evidence is no longer needed.

## Release secret contract

`CAUSENT_DRIFT_SECRET`, `CAUSENT_RECOMPUTE_SECRET`, `CAUSENT_RESOLVE_SECRET`, and `CRON_SECRET`
must pass the network-free strong-secret gate on their worker/app targets. `openssl rand -hex 32`
produces an accepted shape; similarly dense URL-safe encodings of at least 32 random bytes are also
accepted. Short, repetitive, low-diversity, or known placeholder/password strings fail with only the
variable name and `weak_secret` code—never the value. Existing encrypted Vercel values are not
attested until `check:release-config` and the target-specific check run in a secure context that
supplies them.

The current operator inventory records matching strong Sensitive app/worker secrets and the three
app worker URLs as configured, with `CRON_SECRET` rotated. That configuration is not deployment or
canary evidence; every target-specific check still must pass with its protected values before a
candidate is created.

## Dedicated worker database identities — migration 42 applied

`20260819053842_provision_causent_worker_roles.sql` passed a full local reset, a disposable-clone
rehearsal, and production apply. The migration itself creates three passwordless `NOLOGIN` identities
with bounded grants:

- `causent_drift_worker` can claim only the drift queue, read detector inputs, and replace the
  current derived drift projection.
- `causent_recompute_worker` can claim only the recompute queue and lock the immutable current-report
  target; it receives SET-only, non-inherited membership in `authenticated` for stored-actor RLS
  graph work.
- `causent_resolve_worker` has no direct application-table or private-schema grant; it receives only
  SET-only, non-inherited membership in `authenticated` for the supplied actor's RLS sweep.

No worker is a member of `service_role`. The local catalog regression suite passes 8/8. The
disposable-clone Supavisor rehearsal passed and its credentials were disabled afterward. Production
release operations enabled `LOGIN` with a separate generated password for each role without widening
attributes, memberships, or object grants; exact access was verified through the `aws-1` session
pooler. The matching DSNs are stored only as Sensitive `DATABASE_URL` values on their worker
projects. Their required shapes are (replace only the password):

```text
postgresql://causent_drift_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
postgresql://causent_recompute_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
postgresql://causent_resolve_worker.royftsqyawtyfjolfabd:<NONEMPTY_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

For another Supabase target, substitute that target's exact 20-character project ref and matching
`*.pooler.supabase.com` host; retain port `5432`, database `postgres`, and the sole query parameter
`sslmode=require`. The username must be the target worker role followed by `.<project-ref>`. Never
use `postgres.<project-ref>`, `service_role.<project-ref>`, an empty password, the direct database
host, port `6543`, or a DSN shared by two workers. The production role catalog, pooler logins,
local/production lint, and serialized post-42 migration dry-run pass.

## Stateful worker release sequence — no implicit alias movement

Use the same sequence for `drift`, `recompute`, and `resolve`. `--stage-only` is network-free.
`--prod` creates a production-environment candidate with `--skip-domain`; it does **not** promote the
project domain. `VERCEL_ORG_ID` must name the exact owning team.

```bash
# 1. Audit the exact stage and validate the target environment.
stage_dir="$(mktemp -d)/causent-drift"
scripts/deploy-drift.sh --stage-only "$stage_dir"
npm run check:drift-config

# 2. Create an immutable production candidate without moving an alias.
scripts/deploy-drift.sh --prod

# 3. Canary the exact URL printed by the prior command. Missing/wrong secret
#    must fail closed; the valid bounded drain must match the expected queue.
WORKER_DEPLOYMENT_URL='https://<returned-deployment>.vercel.app'

# 4. Only after the canary and logs pass, promote deliberately.
npx --yes vercel@56.0.0 promote "$WORKER_DEPLOYMENT_URL" --scope "$VERCEL_ORG_ID"
```

Substitute `deploy-recompute.sh` plus `check:recompute-config`, or `deploy-resolve.sh` plus
`check:resolve-config`, for the other workers. Do not point the app at an unpromoted worker alias.
After every worker is canaried, run `npm run check:release-config` with the actual protected app
values before creating the no-alias app candidate and promoting it through the same canary boundary.

## Protected staging-load authentication contract

Remote load no longer accepts a shared session or operator-supplied JSON pool. Configure the
protected `staging-load` environment with an external HTTPS broker URL in
`CAUSENT_STAGING_SESSION_POOL_URL` and a high-entropy bearer credential in
`CAUSENT_STAGING_SESSION_POOL_TOKEN`. The source gate rejects local or credential-bearing URLs and
weak, repetitive, or placeholder tokens without printing them.

For each profile, the workflow POSTs a lease request containing `profile`, a durable
`allocationSetId` of `github:<run-id>:<run-attempt>`, a profile-specific `leaseId`, and allocation
policy `single-use-supabase-session-per-vu-profile-disjoint-v1`. The broker response must be a
version-1 envelope that echoes those fields and adds canonical `issuedAt`/`expiresAt` timestamps plus
exactly the required sessions: `smoke=1`, `steady=400`, `burst=1200`, `hot_workspace=200`,
`mixed_write=500`, `soak=400`, and `adversarial=50`. Every session entry binds its lease and VU ID to
the parsed Supabase `session_id` and user subject. The preflight validates access-token session ID,
refresh-token lineage, expiry, capacity, and within-lease uniqueness without printing cookies.

The external broker owns the durable cross-profile invariant: sessions allocated anywhere in one
allocation set must be disjoint and single-use, including retries, so no auth-cookie fingerprint,
Supabase `session_id`, or refresh token is leased twice. A transient JSON generator is not sufficient.
The repository contains only the client/request/envelope validation contract; the broker has not
been implemented, audited, or configured. Therefore the protected live staging workflow is
operator-blocked and must not be reported as run or passed.

The `adversarial` profile additionally requires `CAUSENT_LOAD_FOREIGN_SESSION_COOKIE` for an owner of
the forbidden workspace, `CAUSENT_LOAD_FORBIDDEN_WORKSPACE_ID`, and a bounded
`CAUSENT_LOAD_FORBIDDEN_TENANT_MARKER` visible on that workspace's Actions page. Setup must first
prove the foreign session can see the marker. Only then does the load-user pool forge the foreign
workspace cookie and assert the marker remains absent. This positive control prevents a broken or
empty fixture from being reported as tenant-isolation success. The foreign session must have real
Supabase auth-session lineage and remain disjoint from every broker lease. The source-side contract
is implemented; the broker and protected live staging run remain pending.

# Historical production release preflight — 2026-08-12

The founder requested publication of the current Decision Report review candidate, but this
read-only preflight found blockers and performed no environment mutation, project creation,
migration, merge, deployment, or canary:

- Root app at that checkpoint: Vercel project `causent-ai`, live baseline at
  **https://app.causent.ai**. Production lacked `SUPABASE_SERVICE_ROLE_KEY`,
  `CAUSENT_RECOMPUTE_URL`, and `CAUSENT_RECOMPUTE_SECRET`. The environment-name list confirmed
  `CRON_SECRET`, `CAUSENT_RESOLVE_URL`, and `CAUSENT_RESOLVE_SECRET`; Vercel did not expose their
  encrypted values through the local pull/run context, so empty local values did not prove production
  absence. The historical procedure was to verify them during deployment/canaries, remove stale
  `CAUSENT_DEMO_TODAY`, and confirm every local-only flag was absent.
- Database: the Supabase CLI is neither authenticated nor linked. Authenticate, link the intended
  production project, compare migration history, run `supabase db push --dry-run`, then apply only
  the verified pending migrations. Never include local seed data or the synthetic 122-row Northstar
  review fixture.
- Recompute at that historical checkpoint: Vercel project `causent-recompute` did not exist and no
  worker was deployed. The project now exists; this bullet preserves only the 2026-08-12 finding.
  The historical procedure was to create it from the audited staging bundle, add the session-pooler
  `DATABASE_URL` plus shared secret, deploy, and run fail-closed and queue-drain canaries.
- Resolve at that historical checkpoint: `causent-resolve` existed, but production `DATABASE_URL`
  was absent. It is now configured; this bullet preserves only the 2026-08-12 finding. The historical
  procedure was to add it, redeploy, and canary the app-to-resolver route after
  `npm run check:resolve-config` validates its `DATABASE_URL` and `CAUSENT_RESOLVE_SECRET`.
- App release: the deterministic, server-validated activation-ready sample fix and
  **Full-plan example** label pass the complete local release gate. Obtain green hosted CI for the
  exact revision; merge through review;
  then verify the git-connected app deployment and complete authenticated clean-account canaries.

Founder review and three initially unassisted partner sessions remain open. Production release does
not convert the local synthetic completed-loop result into partner evidence.

# Deploying the causal engine function (`api/engine.py`)

A stateless Vercel Python Serverless Function that wraps the causal engine's
`batch_readout`. It holds **no** database credentials — the Next.js app passes an
already-RLS-scoped daily series in as data and gets back per-`action × method` rows.

## What ships

| File | Role |
| --- | --- |
| `api/engine.py` | The function. `handler` (BaseHTTPRequestHandler) is the Vercel entrypoint; `handle_request()` is the pure, testable core. |
| `engine/causal/**` | The numpy-only engine, bundled via `vercel.json` → `functions.includeFiles`. |
| `requirements.txt` (repo root) | Python deps for the function. `numpy>=1.26` only (the engine is numpy-pure; scipy/psycopg are test-only and are **not** installed at runtime). |
| `vercel.json` | Pins `memory`, `maxDuration` (timeout guard), and `includeFiles` for `api/engine.py`. |

## Request contract

`POST /api/engine` with header `x-causent-engine-secret: <shared secret>` and a JSON body:

```json
{
  "series": [{ "date": "2025-01-01", "value": 12.3 }, "... daily, sorted, unique ..."],
  "action_dates": ["2025-02-20"],
  "methods": ["ITS", "BEFORE_AFTER_14D"]
}
```

- `series` — daily observations, strictly ascending dates; `value` may be `null` (→ NaN). Cap: **3650** points.
- `action_dates` — ship dates; each maps to an ITS intervention split. Cap: **200** actions.
- `methods` — optional; defaults to both. `ITS` (authoritative) + `BEFORE_AFTER_14D` (descriptive).

Response `200`: `{ "rows": [...], "n_actions": N, "methods": [...] }`, one row per
`action × method`. Degenerate/flat/collinear/below-floor data returns a defined
`inconclusive` row (null lift + CI, belief withheld) — never a 500, never a fabricated CI.

Guard responses: `401` (missing/wrong/unset secret), `413` (body/series/action cap),
`400` (malformed input / unknown method), `405` (non-POST).

## Deploy steps — AS DEPLOYED 2026-07-11 (standalone project `causent-engine`)

**LIVE:** `https://causent-engine.vercel.app/api/engine` (production). Smoke-tested:
GET → 405, POST without secret → `401 {"error":"unauthorized"}` (fail-closed), POST
with secret + a 120-day synthetic series → 200; ITS recovered a +50 step as lift
50.46 CI [49.3, 51.6] and correctly capped belief at 0.5 / AUTOCORRELATION on the
serially-correlated synthetic noise. The honesty guards fired on request one.

**Why standalone, not inside the Next.js app project:** deploying the repo as one
project sweeps the remote build's `node_modules` + `.next` into the Python function
bundle (378MB > the 225MB function cap), and the Python builder ignored
`excludeFiles` in that hybrid setup (verified byte-identical bundles across three
config variants). The engine therefore deploys from a minimal staged copy as its own
Vercel project — which also gives it separate scaling, logs, and secrets.

1. **Deploy** (stages api/engine.py + engine/causal + a minimal vercel.json +
   pyproject.toml, links project `causent-engine`, deploys):
   ```
   scripts/deploy-engine.sh          # preview (NOTE: behind the team SSO wall)
   scripts/deploy-engine.sh --prod   # production (publicly reachable, fail-closed)
   ```
   The `pyproject.toml` carries `[tool.vercel] entrypoint = "api.engine:handler"`
   (required by the current Python builder for BaseHTTPRequestHandler functions).
2. **Shared secret** (already set 2026-07-11): `CAUSENT_ENGINE_SECRET` lives on the
   `causent-engine` project (production + preview, Sensitive) AND on the app side in
   `.env.local` so the Next.js caller can send the header. Rotate with
   `openssl rand -hex 32` + `npx vercel env add` in a staged dir linked to
   `causent-engine` + update `.env.local`.
3. **Preview URLs are SSO-walled.** Vercel Deployment Protection covers team preview
   deployments — requests get a 302/401 to `vercel.com/sso-api` before reaching the
   function. Smoke-test against production (fail-closed by design) or use a
   protection-bypass token.
4. **Smoke-test** the live URL:
   ```
   curl -s -X POST https://causent-engine.vercel.app/api/engine \
     -H "x-causent-engine-secret: $CAUSENT_ENGINE_SECRET" \
     -H "content-type: application/json" \
     -d '{"series":[...],"action_dates":["2025-02-20"]}'
   ```
   Expect `200` with `rows`; a wrong/absent secret must return `401`.

The root Vercel project (`causent-ai`) is the Next.js app only — `.vercelignore`
excludes `api/` + `engine/`, and the root `vercel.json` carries no function config.

## Local verification (no creds needed)

```
cd engine && CAUSENT_ENGINE_SECRET=dev .venv/bin/python -m pytest tests/test_engine_function.py -q
```

---

# Deploying the resolution function (`api/resolve.py`)

The **stateful sibling** of the engine function. It runs the resolution sweep —
`persistence/resolve.py::resolve_due_predictions` — over HTTP so the app's
`/api/cron/resolve` route works in a serverless runtime (Vercel's Node runtime has
no Python venv, so it can't `spawn` the runner in prod). The verdict machine is
**not** re-implemented here; this is a thin HTTP wrapper over the exact code path
`run_resolution.py` and the pytest DB suite already exercise.

Unlike the engine function it **holds one credential** — a Postgres DSN it connects
**RLS-scoped** through (`SET ROLE authenticated` + a `request.jwt.claims` sub, the
same contract as `run_resolution.py`). It is therefore its **own** Vercel project
(`causent-resolve`), never folded into the credential-free engine.

The app cron discovers production targets server-side from currently due predictions, verifies a
write-capable inherited membership, and supplies both `scope_id` and `user_id`. It processes at most
20 workspaces per cron invocation with concurrency four, repeating every five minutes while retaining
the 15:00 UTC decision-day cutoff. Caller input cannot select these targets; the fixed demo actor is
retained only in explicit local-demo mode.

## What ships

| File | Role |
| --- | --- |
| `api/resolve.py` | The function. `handler` is the Vercel entrypoint; `handle_request(raw_body, secret, *, sweep=...)` is the pure, testable core (the `sweep` seam is injected so guard tests need no DB). |
| `engine/persistence/**`, `engine/causal/**` | The bridge + verdict machine + numpy engine, bundled via `vercel.json` → `includeFiles`. |
| `psycopg[binary]` + `numpy` | Runtime deps (generated into the staged `requirements.txt`/`pyproject.toml` by the deploy script). |

## Request contract

`POST /api/resolve` with header `x-causent-resolve-secret: <shared secret>` and an
optional JSON body:

```json
{ "today": "2025-05-23", "scope_id": "<uuid>", "user_id": "<uuid>" }
```

All fields optional. Empty body → resolve today's due predictions for the default
demo scope (env `CAUSENT_RESOLVE_SCOPE` / `CAUSENT_RESOLVE_USER`, seeded demo
owner). `today` overrides the boundary (the seeded demo lives in the past).

Response `200`: `{ "ok": true, "processed": N, "total": M, "by_verdict": {...},
"results": [{prediction_id, status, verdict, detail}], "truncated": bool }`.
Guards: `401` (missing/wrong/unset secret), `413` (body cap), `400` (bad JSON /
date / uuid), `500` (a genuine DB/driver fault — type name only, no message leaked),
`405` (non-POST).

## Deploy steps (project `causent-resolve`) — CONFIGURED; REDEPLOY PENDING

The project exists, its matching strong Sensitive secret is configured on the worker and app, and
the app URL is configured. Its exact `causent_resolve_worker.royftsqyawtyfjolfabd` production
Supavisor DSN is stored Sensitive and the role login/catalog contract passed. Treat the resolver as
unavailable until a new candidate is deployed and the authenticated route is canaried. Before
deployment, load the intended resolver environment and run `npm run check:resolve-config`; it
requires both `DATABASE_URL` and `CAUSENT_RESOLVE_SECRET`. No resolver candidate, canary, or promotion
occurred in this release run.

1. **Deploy** (stages the audited import closure, links the exact team/project, and creates a
   candidate; production mode does not move an alias):
   ```
   scripts/deploy-resolve.sh --stage-only /new/path/causent-resolve
   scripts/deploy-resolve.sh          # preview (SSO-walled, like the engine)
   scripts/deploy-resolve.sh --prod   # production candidate, --skip-domain
   ```
   Canary the immutable URL, then explicitly run
   `npx --yes vercel@56.0.0 promote <url> --scope "$VERCEL_ORG_ID"`.
2. **Secrets on `causent-resolve`** (production + preview):
   - `CAUSENT_RESOLVE_SECRET` — the already configured matching strong Sensitive shared secret.
   - `DATABASE_URL` — the configured exact Supabase **session-pooler** DSN for
     `causent_resolve_worker.<20-character-ref>`, with a nonempty password, matching
     `*.pooler.supabase.com` host, port `5432`, `/postgres`, and only `?sslmode=require`. Never use
     `postgres.<ref>` or `service_role.<ref>`.
   - Optional `CAUSENT_RESOLVE_SCOPE` / `CAUSENT_RESOLVE_USER` to point the default
     sweep at a non-demo scope + acting owner.
3. **Verify the app wiring** (`causent-ai` project): `CAUSENT_RESOLVE_URL` and the same
   `CAUSENT_RESOLVE_SECRET` are configured and are required by the production app release check.
   With both set, `/api/cron/resolve` POSTs the function;
   without them it falls back to the local runner (dev only) and degrades loudly.
4. **Smoke-test**:
   ```
   curl -s -X POST https://causent-resolve.vercel.app/api/resolve \
     -H "x-causent-resolve-secret: $CAUSENT_RESOLVE_SECRET" \
     -H "content-type: application/json" -d '{"today":"2025-05-23"}'
   ```
   Expect `200` with `by_verdict`; a wrong/absent secret must return `401`.

## Local verification (no creds needed)

```
cd engine && .venv/bin/python -m pytest tests/test_resolve_function.py -q
```

---

# Deploying the automatic causal recomputation worker (`api/recompute.py`)

The stateful queue worker behind automatic Decision Report recomputation. The
Next.js app commits source changes and activation transitions to the private
Postgres queue, then makes a best-effort immediate request to this worker. The
root app's `/api/cron/recompute` route repeats that request every five minutes,
so a missed immediate wake-up does not lose committed work.

The worker re-resolves the workspace's explicit current report pointer while
holding the queue and target locks, switches to the job's stored member identity,
and runs the same `persistence.bridge.persist_metric_readouts` code covered by the
engine integration suite. Its generation receipt and graph writes commit
atomically. It never accepts a report ID, action IDs, or an acting user from the
caller; optional workspace and metric IDs only narrow which already-queued job
may be claimed.

Like `causent-resolve`, this function holds a Postgres DSN and therefore deploys
as a separate Vercel project (`causent-recompute`). It must not be folded into
the credential-free engine or the root Next.js app.

## What ships

| File | Role |
| --- | --- |
| `api/recompute.py` | Secret-guarded HTTP entrypoint and bounded queue drain (`limit` 1–20). |
| `engine/persistence/recompute.py` | Transactional claim, current-pointer validation, stored-actor switch, retry/receipt logic. |
| `engine/persistence/bridge.py` | RLS-scoped causal graph materialization. |
| Required `engine/causal/**` readout modules | Numpy causal engine dependency chain; drift, demo, and resolution runners are excluded. |
| `numpy==2.5.0`, `psycopg[binary]==3.3.4` | Reproducible Python 3.12 runtime dependencies generated in the staging directory. |

## Request contract

`POST /api/recompute` with header
`x-causent-recompute-secret: <shared secret>` and an optional JSON body:

```json
{ "limit": 20, "scope_id": "<uuid>", "metric_id": "<uuid>" }
```

Empty body drains up to 10 due jobs. `limit` is capped at 20. The optional IDs
are queue filters only and cannot redirect work to a caller-selected report.
Response `200` summarizes `processed`, `unchanged`, `superseded`, and scheduled
retries when no terminal job failed. A batch containing a terminal `FAILED` job
returns `500` with the same bounded summary and `ok: false`, so both the app cron
and platform monitoring see a failure. Guards: `401` (missing/wrong/unset secret),
`413` (body cap), `400` (bad JSON / unknown fields / invalid limit or UUID), `503`
(missing `DATABASE_URL`), `500` (terminal job or non-sensitive exception class
only), and `405` (non-POST).

## Deploy steps (project `causent-recompute`) — CONFIGURED; DEPLOYMENT PENDING

The Vercel project exists. Its matching strong Sensitive secret is configured on the worker and app,
and the app URL is configured; `CRON_SECRET` has been rotated. The worker `DATABASE_URL` is
configured with `causent_recompute_worker.royftsqyawtyfjolfabd`, and its role login/catalog contract
passed. No recompute candidate, deployment, canary, or promotion occurred in this release run.
The following steps are the deployment procedure, not evidence of a deployment.

1. **Stage and deploy** the minimal standalone project. Production mode creates an immutable
   no-alias candidate:
   ```
   scripts/deploy-recompute.sh            # preview
   scripts/deploy-recompute.sh preview    # explicit preview
   scripts/deploy-recompute.sh --prod     # production candidate, --skip-domain
   ```
   The script links only the staging directory to `causent-recompute`; it does
   not alter the root app's `.vercel/project.json`. For a network-free content
   audit, use `scripts/deploy-recompute.sh --stage-only <new-directory>`.
   Canary the returned URL, then explicitly run
   `npx --yes vercel@56.0.0 promote <url> --scope "$VERCEL_ORG_ID"`.
2. **Set worker env** on `causent-recompute` for preview and production:
   - `DATABASE_URL` — the configured exact Supabase **session-pooler** DSN for
     `causent_recompute_worker.<20-character-ref>`, with a nonempty password, matching
     `*.pooler.supabase.com` host, port `5432`, `/postgres`, and only `?sslmode=require`. Never use
     `postgres.<ref>` or `service_role.<ref>`; store the DSN only in Vercel's Sensitive environment.
   - `CAUSENT_RECOMPUTE_SECRET` — the already configured matching strong Sensitive shared secret.
   - With those values exported locally, run `npm run check:recompute-config`.
     The worker no longer falls back to a localhost database when the DSN is
     missing.
3. **Verify app env** on the root `causent-ai` project:
   - `CAUSENT_RECOMPUTE_URL` and the matching `CAUSENT_RECOMPUTE_SECRET` are configured.
   - Rotated `CRON_SECRET` protects `/api/cron/recompute` and remains distinct from the worker
     secret.
   - The app also requires `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only
     `SUPABASE_SERVICE_ROLE_KEY` for Decision Report source-receipt minting.
     Export the production values and run `npm run check:release-config`; all
     local demo/fixture/seed/rollout flags must be absent.
4. **Smoke-test after an authorized deploy:** an absent/wrong worker secret must
   return `401`; a correct secret and `{ "limit": 1 }` must return `200` with a
   bounded summary. Then enqueue a current-report generation and confirm the
   app cron drains it exactly once.

The root `.vercelignore` intentionally excludes `/api` and `/engine`: all Python
functions are deployed from minimal standalone stages, avoiding the hybrid
Next/Python bundle-size failure and keeping stateful DB credentials out of the
credential-free engine project. The root `app/api/**` Next.js routes are not
matched by the anchored `/api` pattern and remain in the app deployment.

## Local verification (no network or credentials needed)

```
bash -n scripts/deploy-recompute.sh
stage_dir="$(mktemp -d)/causent-recompute"
scripts/deploy-recompute.sh --stage-only "$stage_dir"
find "$stage_dir" -type f | sort
cd engine && .venv/bin/python -m pytest tests/test_recompute_function.py -q
```

---

# Deploying the baseline-drift materialization worker (`api/drift.py`)

The drift worker drains the private coalesced workspace refresh queue and atomically replaces the
bounded `current_prediction_drift` projection. It holds a Postgres DSN and therefore deploys as the
standalone `causent-drift` project. It must never be folded into the app or credential-free engine.

## Deploy steps (project `causent-drift`) — CONFIGURED; DEPLOYMENT PENDING

The Vercel project exists. Its matching strong Sensitive secret is configured on the worker and app,
the app URL is configured, and `CRON_SECRET` is rotated. Its exact
`causent_drift_worker.royftsqyawtyfjolfabd` Supavisor `DATABASE_URL` is stored Sensitive and its role
login/catalog contract passed. No drift candidate, deployment, canary, or promotion occurred in this
release run.

1. Audit or deploy the narrow pinned stage:
   ```
   scripts/deploy-drift.sh --stage-only /new/path/causent-drift
   scripts/deploy-drift.sh               # preview
   scripts/deploy-drift.sh --prod        # production candidate, --skip-domain
   ```
2. Verify the configured `DATABASE_URL` uses the exact Supabase session-pooler identity
   `causent_drift_worker.<20-character-ref>`, a nonempty password, matching
   `*.pooler.supabase.com:5432/postgres?sslmode=require`, and no other query parameter. Never use
   `postgres.<ref>` or `service_role.<ref>`. Then run `npm run check:drift-config` with the worker's
   configured strong Sensitive `CAUSENT_DRIFT_SECRET`. Verify the already configured matching app
   URL/secret and rotated `CRON_SECRET` through the app release check.
3. Canary missing/wrong-secret denial, bounded drain, stale-generation suppression, retry/terminal
   behavior, and the app recovery cron against the immutable URL. Only then run
   `npx --yes vercel@56.0.0 promote <url> --scope "$VERCEL_ORG_ID"` and update the app worker URL.

No drift worker candidate, alias promotion, or production queue drain occurred in the 2026-08-18
rehearsal.
