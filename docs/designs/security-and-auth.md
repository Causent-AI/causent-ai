# Causent Security & Auth

Status: LIVING DOCUMENT (current implementation reviewed 2026-08-12; pending release)
Owner: founder
Related: `docs/designs/did-it-ship-did-it-work.md` (PRD), `docs/designs/decision-graph.md` (data model / RBAC tables)

Causent is trust-first and handles two classes of sensitive customer data: **private
repository metadata** (PRs, issues, timestamps) and **business metrics** (revenue,
conversion, retention). Security is a first-class deliverable, not polish.

## 1. Authentication (current design-partner preview)

The implemented login surface is **invite-only Google OAuth through Supabase Auth**.
An operator first adds the email and intended org role to `allowed_emails`. Supabase's
Before User Created hook rejects any email not on that allowlist before an
`auth.users` row is created; the post-create trigger then materializes the invited
org membership idempotently. The OAuth callback exchanges the code for a cookie-backed
Supabase session and clamps any `next` destination to a same-origin relative path.

Email magic-link/password login, GitHub login, SAML/enterprise OIDC, account-level
connector OAuth, and member-management UI are **not implemented** in the current
preview. The longer-term design still separates login identity from data connections,
but configured GitHub/Jira credentials, prefilled issue links, paste attribution, and
strict CSV upload are the current connector surfaces. Do not describe those as an
interactive OAuth connection flow.

```
CURRENT LOGIN                    CURRENT DATA INPUTS
 └─ allowlisted Google OAuth      ├─ configured GitHub/Jira credentials or issue URL
                                 ├─ strict daily CSV upload
                                 └─ one bounded public URL + one text-based PDF
```

## 2. Authorization (RBAC over the scope hierarchy)

Access control rides the **org → project → workspace** hierarchy (see
`decision-graph.md`). The `memberships` table (user × scope × role) is what makes RLS
enforceable.

| Role | Can |
|---|---|
| **owner** | billing, delete org/project, manage members, everything below |
| **admin** | manage data + connections + members (not billing/delete) |
| **member** | create/edit actions, metrics, decision rationale; run readouts |
| **viewer** | read-only |

Grants **inherit downward**: an org admin admins every project/workspace; a
workspace-scoped viewer sees only that workspace. RLS resolves access by checking for a
membership whose scope covers the row's `scope_id` at a sufficient role.

## 3. Row-Level Security (RLS)

- Every application table exposed through `public` has RLS enabled. Data API grants and
  row policies are treated as separate controls; authenticated policies combine role
  grants with membership coverage instead of relying on `TO authenticated` alone.
- Dashboard reads and writes use the cookie-bound Supabase client. Policies resolve
  `auth.uid()` through `memberships` and the org → project → workspace hierarchy.
- The network-facing **causal engine** is stateless: it receives an already scoped daily
  series as plain data and holds no database or service-role credential.
- The resolution and recompute paths are separate **stateful workers**. They own a
  server-only Postgres `DATABASE_URL`; the recompute worker claims private queue state,
  revalidates current report pointers, then switches the transaction to the queued
  actor's authenticated identity before graph reads/writes. This trusted worker boundary
  must not be described as part of the credential-free engine.
- The service-role client bypasses RLS and is therefore limited to named server-only
  provisioning, invite, provenance-receipt, webhook, cron, and backfill paths. It is not
  the production dashboard client.

## 4. Secrets & credential management

Secrets are deployment-managed environment variables today; Supabase Vault-backed
per-connection credentials are a future design, not a shipped capability. The public
Supabase URL and anon key may be browser-visible, but the service-role key and every
worker/provider/connector secret remain server-only.

| Credential/configuration | Current store | Boundary |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app environment | public client configuration; RLS still authorizes every row |
| `SUPABASE_SERVICE_ROLE_KEY` | app server environment | narrow privileged paths only; never imported by a Client Component |
| AI Gateway/OIDC or provider key | app server environment | Decision Report generation only; source material leaves Causent only after the explicit generation action |
| `CAUSENT_ENGINE_SECRET` | app + stateless engine environments | authenticates bounded compute calls; no database access |
| `DATABASE_URL`, `CAUSENT_RECOMPUTE_SECRET` | stateful recompute worker environment | private queue and graph materialization; matching secret/URL live on the app side |
| resolve-worker DSN/shared secret | stateful resolve worker environment | scheduled prediction resolution, separate from the stateless engine |
| `CRON_SECRET` | app server environment | authenticates scheduled drain/reconciliation routes |
| GitHub/Jira tokens and webhook secrets | server environment | operator-configured connector seam; no user OAuth token lifecycle yet |

Release checks validate required variable names and URL classes without printing values,
and production must not define local demo, seed, fixture, or local-rollout flags. There is
currently no end-user connector token refresh/revocation flow; rotation remains an
operator responsibility until the per-connection credential design is implemented.

## 5. Attack surface & threat model (from the reviews)

| Threat | Mitigation | Status |
|---|---|---|
| Cross-tenant data access (IDOR) | RLS via downward-inheriting memberships; checked RPCs revalidate scope/report/metric relationships | built; adversarial RLS/integration tests |
| Engine endpoint DoS / compute abuse | fail-closed shared secret plus body, series, action, and duration caps | built; external rate-limit policy remains open |
| SSRF through Decision Report URL input | HTTPS/443 only; no credentials; public-DNS validation and address pinning; redirect revalidation; byte/time/content caps | built and tested |
| SSRF through a future warehouse connector | read-only credentials plus public-host allowlisting | deferred with the connector |
| Prompt injection / fabricated provenance | all brief/URL/PDF chunks are untrusted data; sourced quotes must exactly match server-owned chunks and digests | built for Decision Report generation |
| Service-role or worker bypass | dashboard uses session RLS; service role is narrow; recompute switches to the queued actor for graph work | built; production configuration/canary pending |
| Stale or cross-report recomputation | database-owned current pointers, row locks, immutable activation target, stable input hash, superseded-work receipt | built and tested |
| Secret leakage | server-only deployment env, client-import guard, value-free release checks, local flags forbidden in production | built; managed rotation/Vault migration deferred |
| Overclaim (trust attack) | causal and descriptive evidence remain distinct; ITS floors and withheld states do not loosen for the demo | built and tested |

## 6. Data classification & audit

- **Sensitive:** report prompts/source chunks, private report assets, repository metadata,
  business-metric values, database DSNs, provider/connector tokens, and shared secrets.
- **Audit trail:** Decision Report revisions, activations, manual action completions,
  evidence objects, prediction revisions, and transition events are append-only or
  otherwise protected from authenticated destructive writes. Lifecycle telemetry is
  content-free and append-only. There is no shipped catch-all "AI Action Log" and no
  claim that every auth or connector event is recorded by the application.

## 7. v1 security task list

- [x] **SEC1 (P1)** — `memberships` hierarchy, explicit Data API grants, and RLS policies. **Built + verified** in migration, integration, and tenant-isolation suites.
- [x] **SEC2a (P1)** — Invite-only Google OAuth, pre-create allowlist rejection, cookie session exchange, and idempotent membership provisioning. **Built.**
- [ ] **SEC2b (P2)** — Email, GitHub login, SAML/OIDC, connector OAuth, and member-management UI. **Deferred.**
- [ ] **SEC3 (P1)** — Per-connection encrypted GitHub/Jira credentials plus reconnect/revocation UX. **Deferred; current connector secrets are operator-managed env.**
- [x] **SEC4 (P1)** — Cross-tenant, forged-identity, stale-write, report-series, Storage, and worker-isolation tests. **Built and run in CI.**
- [x] **SEC5a (P1)** — Public-URL SSRF/redirect/content limits and text-PDF active-content/size/page/time limits. **Built.**
- [ ] **SEC5b (P2)** — Warehouse/Postgres connector SSRF and credential boundary. **Deferred with the connector.**
- [ ] **SEC6 (P2)** — Engine/worker shared-secret authentication and compute/input caps are built; managed rotation and external rate limiting remain open.
- [x] **SEC7 (P1)** — Decision Report source text is untrusted, sourced excerpts are exact-match verified, and provenance digests are checked again at persistence. **Built.**
- [x] **SEC8 (P1)** — Automatic recompute uses a private coalescing queue, current-pointer revalidation, authenticated actor context, bounded retry/backoff, and content-free errors. **Built locally; production configuration and canary remain release gates.**

## 8. Open questions

- **Credential destination and rotation:** when connector OAuth arrives, choose the
  encrypted per-connection store, revocation behavior, and rotation cadence.
- **Auth-provider expansion:** enable email, GitHub login, or SAML/OIDC only when a
  partner requirement justifies the additional account-recovery and linking surface.
- **Invite/member management:** decide where operators manage invites, roles, and session
  revocation; the current invite path is a service-role CLI.
- **External rate limiting:** set production policies for engine, recompute, resolve,
  source ingestion, and generation in addition to existing secrets and hard caps.
- **Retention/purge:** define customer-facing retention and physical-purge policy for
  source chunks, private report assets, immutable audit rows, and soft-deleted reports.
- **GitHub application model:** current preview uses configured credentials and issue URLs;
  personal/org GitHub App installation and publish approval remain deferred.

## Change log
- 2026-08-12 — Corrected the document to the pending review release: invite-only Google
  OAuth is the only implemented login, connector secrets remain environment-managed,
  Decision Report source guards are built, and the credential-free causal engine is
  explicitly separated from database-owning resolution/recompute workers.
- 2026-07-02 — Initial. Multi-provider auth (adds email/Google/SSO, decouples GitHub as a
  data source); memberships/RBAC over the scope hierarchy; consolidated the review's
  security findings into a threat model + task list.
