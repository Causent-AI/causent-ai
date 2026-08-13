@AGENTS.md

# Causent repository guide

## Product

Causent connects evidence, decisions, predictions, implementation actions, and measured impact. The active product plan is the approved AI-assisted Decision Report onboarding wedge in `docs/designs/ai-assisted-decision-report.md`.

## Current stack

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS 4
- Supabase PostgreSQL/Auth/RLS/Storage
- Vercel AI Gateway and the AI SDK behind narrow typed generation seams
- Python/NumPy causal engine plus separately deployed stateful resolution/recompute workers

## Actual repository layout

- `app/` — App Router pages, layouts, server actions, auth, webhooks, and cron routes
- `components/` — UI grouped by product surface
- `lib/` — typed domain logic, data access, connectors, auth, generation, and tests
- `engine/` — pure-NumPy causal engine, persistence bridge, resolution, and pytest suite
- `api/` — deployable Python Vercel functions
- `scripts/` — local verification and separately staged worker deployment helpers
- `supabase/migrations/` — schema, RLS, and grants
- `docs/` — product designs, status, and verification evidence

There is no `/src` tree, LangGraph layer, Recharts/Tremor dependency, or TanStack Table dependency in the current implementation.

## Conventions

- Read the relevant guide in `node_modules/next/dist/docs/` before changing Next.js code.
- Prefer Server Components. Use Client Components only for interaction or browser APIs.
- Keep page files thin; put domain behavior in typed `lib/` modules and UI behavior in focused components.
- Preserve the existing injected-client pattern for database domain logic so it remains integration-testable.
- All user data must stay scope-bound and RLS-protected. Never expose a service-role credential to the client.
- Dashboard reads/writes use the caller's Supabase session. Restrict service-role clients to named server-only provisioning, receipt, webhook, cron, and backfill paths.
- Keep the credential-free stateless engine separate from database-owning resolution/recompute workers; worker secrets and `DATABASE_URL` belong only in server deployment environments.
- Preserve the honesty boundary: AI may structure or suggest, but cannot invent evidence, metric observations, owners, prediction magnitudes, or causal claims.
- Human users enter prediction direction, magnitude, and resolution date.
- Prefer deterministic validation and fallbacks around every model call.
- New report/action materialization must be idempotent and covered by integration tests.

## Active Decision Report boundary

- The pending review release starts at `/onboarding?flow=decision-report` with a casual business-challenge prompt. `components/decision-report/` renders one dynamic Decision / Supporting Evidence / Implementation editor; `lib/decision-reports/` owns the versioned schema, validation, provenance, persistence, activation, iteration, and tests.
- Generation runs server-side through Vercel AI Gateway. Model output contains no trusted IDs, exact evidence excerpts must match bounded source chunks, and unsafe or failed output becomes an editable fallback. Supporting evidence is optional and must never be invented.
- Source ingestion accepts at most one public HTTPS page and one text-based PDF. Preserve its SSRF, redirect, content-type, byte/page/time, active-content, and digest guards. It is not a crawler or OCR pipeline, and raw URL/PDF bytes are not retained.
- The draft may hold 1–25 actions. Background, Problem, Decision, the Action Plan summary, and one titled action gate readiness; evidence, metric rationale, owners, customers, stakeholders, governance, and supplied visuals remain optional.
- Draft changes, including metric selection, one-to-three activation selections, primary lever, prediction, and resolution date, autosave through the existing checked append-only revision contract. Preserve exact-retry reuse and stale-base conflicts.
- Activation is the sole canonical materialization boundary. It creates the decision, human prediction, selected actions, links, one primary manual lever, and activation audit, then enqueues recomputation. Activated report revisions and prior canonical/audit rows are immutable.
- Post-activation edits start one checked successor in the same linear series. There is one explicit current active report, no branching/merge behavior, and no timestamp/sort-order inference. The predecessor remains operational until successor activation moves the pointer atomically. Private asset IDs and paths never copy forward.
- Actions & Decisions, Data Workshop, Core Metrics, and Impact must resolve the explicit current report. Current-report metric writes and primary-action completion may enqueue the private stateful recompute worker; historical/superseded graphs must not be rewritten.
- The Claude/Codex controls are a bounded manual clipboard preview only. They perform no provider login, MCP call, automatic send, durable paste-back, or mutation.
- Current preview auth is invite-only Google OAuth through Supabase with a Before User Created allowlist. Email/password, GitHub login, SSO, account-level connector OAuth, and member-management UI are not implemented.
- The current branch is pending founder review and release. Do not claim partner evidence passed, production migrations/configuration are armed, the Northstar local fixture exists in production, or deployment completed unless verified in that release run.
- Inline gap questions replace a general chatbot. Deferred scope includes URL crawling, OCR/scanned-PDF support, multiple documents, general chat history, authenticated MCP/API delivery, provider OAuth, hard deletion, revision diff/restore/export UI, and numeric completion probability.

## gstack skill routing

- Product discovery → `/office-hours`
- Strategy/scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- UI/UX plan → `/plan-design-review`
- Bugs → `/investigate`
- QA → `/qa` or `/qa-only`
- Code review → `/review`
- Shipping/deployment → `/ship` or `/land-and-deploy`
