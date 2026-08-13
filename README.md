# Causent

Causent is a decision-intelligence product that connects evidence, decisions, human predictions, shipped actions, and measured impact on one causal graph.

The product has two existing loops:

- **Retrospective:** ingest a shipped action, connect it to a metric, and produce an honest Interrupted Time Series readout.
- **Prospective:** record a decision and human prediction before shipping, watch the implementation lever, and resolve the prediction against measured evidence.

The active product plan adds an **AI-assisted Decision Report** as the onboarding wedge. A casual, challenge-first prompt produces one editable Decision, Supporting Evidence, and Implementation document. Causent fills only what the supplied material supports, highlights missing required details, and keeps supporting evidence optional. A draft may contain up to three sourced proof claims, one metric hypothesis/chart, 1–25 editable actions, and one optional sanitized private chart or graph. This is structured generation, not a general chatbot.

See [docs/STATUS.md](docs/STATUS.md) for the current build state and [docs/designs/ai-assisted-decision-report.md](docs/designs/ai-assisted-decision-report.md) for the approved active plan.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- Supabase PostgreSQL, Auth, RLS, and Storage
- Vercel AI Gateway and the AI SDK for bounded Anthropic structured generation; Anthropic for summary polishing
- Python/NumPy causal engine deployed as Vercel functions
- Vercel application hosting

The application lives at the repository root rather than under `src/`.

## Product surfaces

- `/onboarding` — challenge-first Decision Report generation, optional URL/text-PDF sources, a single dynamic editor, serialized autosave, and metric/prediction/primary-lever activation
- `/reports` — saved Decision Reports grouped into immutable linear iteration series, with explicit successor creation and recoverable removal from visible history
- `/actions` — report-native Project Summary, expandable actions, manual completion, one explicit primary lever, on-demand metric history, and bounded Claude/Codex clipboard handoff
- `/data-workshop` — named daily CSV import plus the workspace metric catalog and core selection
- `/impact` — plan-versus-outcome charts, action-to-metric trace, causal readouts, and clearly labeled preliminary descriptive evidence when history is short

## Local development

Use the repository's pinned Node version (`.node-version`, Node 22) and reset the
entire local database before exercising Decision Report persistence:

```bash
npm ci
supabase start
npm run db:reset-demo
CAUSENT_LOCAL_DEMO=1 npm run dev
```

Open `http://localhost:3000`.

`db:reset-demo` reapplies every migration, seeds the canonical workspace, and
restores the local Decision Report rollout. `CAUSENT_LOCAL_DEMO` is a local-only
escape hatch and must be absent from production, along with the fixture, seed,
and local-rollout flags.

Open `http://localhost:3000/onboarding?flow=decision-report`, describe the business challenge in ordinary language, and choose **Turn this into a Decision Report**. You may also supply one public HTTPS page and one text-based PDF. The URL path performs no crawl, and the PDF path performs no OCR; raw fetched/uploaded bytes are not retained. Generation uses the Vercel AI Gateway through the core AI SDK. Authenticate locally with `VERCEL_OIDC_TOKEN` or `AI_GATEWAY_API_KEY`; override the default `anthropic/claude-sonnet-5` model with `CAUSENT_DECISION_REPORT_MODEL`. Set `CAUSENT_DECISION_REPORT_FIXTURE=1` only for deterministic local Gummy Alpha review.

The model supplies untrusted content and exact evidence excerpts, never trusted IDs. Unknown scalar claims return as `null` and unknown lists as `[]`; the server assigns IDs, verifies evidence against the brief, and materializes editable missing states for owners, customers, stakeholders, governance, and metric values. Provider failures preserve the brief in a safe editable fallback rather than dead-ending onboarding.

The editor applies direct edits and focused answers through one typed reducer. Background, Problem,
Decision, the Action Plan summary, and at least one titled action are required; supporting evidence,
metric rationale, owners, customers, stakeholders, governance, and supplied visuals are optional.
Valid drafts autosave after a short delay as scope-bound, append-only full revisions. Reload restores
the exact report, activation draft, and metric projection; identical retries reuse the current
revision, while a stale tab stops with a conflict instead of overwriting newer work.

Activation is deliberately separate from autosave. The user confirms one existing workspace metric,
enters a human prediction direction/magnitude/future resolution date, selects one to three of the
draft's 1–25 actions, and marks one selected action as the primary lever. One checked transaction
creates the canonical decision, prediction, selected manual actions, decision links, primary lever,
and append-only activation audit, then enqueues causal recomputation. Exact retries reuse canonical
IDs; changed retries fail with HTTP 409. The activated report and its canonical intent rows become
immutable. Further refinement starts an explicit successor in the same linear series; the prior
active report remains current until successor activation and pointer movement commit atomically.

The exact current activated report carries across Actions & Decisions, Data Workshop, Core Metrics,
and Impact. Daily CSV import is strict and atomic. Workspace metrics may be created and selected for
shared charts without changing the report's confirmed prediction metric. A report may attach one
sanitized private PNG/JPEG while editable, but a successor never copies its asset ID or Storage path.
Report actions can be manually completed with an audited date/explanation, and current-report
observation changes or primary-action completion enqueue the private recompute worker. Short-history
before/after evidence remains descriptive; authoritative ITS belief still requires at least 45 days
on both sides.

To exercise Decision Report activation and iteration locally, use the clean reset
instead of applying only new migrations:

```bash
supabase start
npm run db:reset-demo
CAUSENT_LOCAL_DEMO=1 npm run dev
```

Generate or reload a report, complete the highlighted required fields, wait for **All changes saved**, choose a real workspace metric, enter the team prediction, select one to three actions, choose the primary lever, and select **Activate decision**. The illustrative report chart is never copied into the human prediction or stored as metric observations.

Before changing Next.js behavior, read the relevant bundled guide under `node_modules/next/dist/docs/`; this repository uses Next.js 16 conventions that may differ from older App Router documentation.

## Verification

```bash
# TypeScript, lint, and library/integration tests
npm run typecheck
npm run lint -- --max-warnings=0
npm test

# Reproducible Next.js 16 production build
npm run build:webpack

# Python engine tests
cd engine
.venv/bin/python -m pytest -q
```

Database-backed engine/RLS/bridge tests require the local Supabase stack:

```bash
supabase start
npm run db:reset-demo
```

Before a deliberate release, export the target's production environment into
the shell and run the network-free checks below. They print variable names and
error codes only, never values:

```bash
# Next.js project `causent-ai`
npm run check:release-config

# Standalone project `causent-recompute`
npm run check:recompute-config
```

The app check requires the server-only `SUPABASE_SERVICE_ROLE_KEY` because new
Decision Reports mint a single-use provenance receipt before their first save.
It also checks the automatic-recompute URL/secrets and rejects every local-only
flag. The worker check requires its own session-pooler `DATABASE_URL` and shared
recompute secret.

## Documentation

- [Build status and resume guide](docs/STATUS.md)
- [Active Decision Report design](docs/designs/ai-assisted-decision-report.md)
- [Prospective prediction loop](docs/designs/prospective-prediction-loop.md)
- [Decision graph](docs/designs/decision-graph.md)
- [Original retrospective wedge](docs/designs/did-it-ship-did-it-work.md)
- [Security and authentication](docs/designs/security-and-auth.md)
- [Active backlog](TODOS.md)

Historical `OVERNIGHT_REPORT*` documents are point-in-time build evidence and are intentionally not rewritten when the active plan changes.
