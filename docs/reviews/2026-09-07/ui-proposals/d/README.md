# Proposal D

[Decision Network](http://localhost:3135/ui-proposals/d/#graph) · [Connections](http://localhost:3135/ui-proposals/d/#connections) · [AI](http://localhost:3135/ui-proposals/d/#ai) · [Compare](http://localhost:3135/ui-proposals/)

Final design revision: September 21, 2026. [Delivery review](../../../2026-09-21/PROPOSAL_D_REVIEW.md) · [GA4 backend and security handoff](../../../../handoffs/ga4-core-metrics.md).

## Final direction

| Area | Behavior |
|---|---|
| Navigation | Five pill tabs: Data, Reports, Actions, Impact, Graph. Regular typography, blue actions, blue-green selection, yellow Ask. |
| Reports/onboarding | Pageless Tiptap editing, rename/add sections, local charts, Rewrite preview, metric import, core selection, estimates, and editable action review. Report title updates the folder name. |
| Actions | Editable task/owner/status, PR links, harness and instance assignment, and cost preview. Saved estimates preserve their configuration. |
| Graph | Dark Decision Network; dated blue/green decision nodes and project nodes. Filter by core metric, project/portfolio, and period. Select a node for summary, impact, and report link. |
| Portfolios | Group projects around a metric and quarter/year. Action edits update the source project. Combined impact is not calculated. |
| Connections | GitHub, BigQuery, Google Analytics, and custom configuration cards. No Metric sources section below them. |
| AI | Connections (AI partners), Harnesses, Cost. No subtitle or Instances tab. Cost covers AI usage to run tasks. |
| Impact | Existing default models retained. New project/portfolio results remain pending. |

## Review locally

From the repository root:

```sh
python3 -m http.server 3135 --bind 127.0.0.1 --directory docs/reviews/2026-09-07
```

1. Open Graph, change the core metric and period, select a decision, and open its report. Use scroll/+/-/Fit for zoom and drag/arrows for pan.
2. Create a portfolio with two projects and a metric, then inspect its Graph and Actions.
3. Open Data → Connections and configure BigQuery or add a custom connection.
4. Open Data → AI → Harnesses. Edit a harness; assign it to an action and save a cost estimate. Inspect that record in Cost after editing the harness again.
5. In Reports, rename the title/sections, format text, and insert a chart. Create → Project keeps these controls in onboarding.

The normal Next.js/Vercel preview does not serve these documentation prototypes. Use the static server above; Proposal A separately requires the original local app described in the [comparison guide](../README.md).

## Boundaries and verification

All edits last until reload. Connections, AI generation, local instances, usage receipts, and graph decisions are illustrative; no account is connected, runner launched, data uploaded, or paid call made. Charts use local sample/imported observations. Graph links represent membership/sequence, not causation. Separate decision lifts are never summed into a portfolio result.

Browser checks covered desktop/390 px layouts, report/onboarding controls, graph filters/zoom/pan/details, portfolio action synchronization, connection forms, harness versions, and saved cost estimates. No final application console errors were observed. Native file pickers and touch pinch were not automated; pinch is not implemented.

Packaging checks: both editor builds; 12 metric/CSV/chart/cost tests across C/D; typecheck; zero-warning lint; syntax and local asset/reference checks. Handwritten prototype code remains linted; only generated vendor bundles are excluded. The parent PR's app/engine/database results are separate from this PR's hosted checks.

```sh
npm run test:ui-proposals
node docs/reviews/2026-09-07/ui-proposals/d/build.cjs
```

The browser bundle includes [dependency notices](assets/workbench.LICENSE.txt). No runtime backend, schema, worker, or Impact model changes are part of this UI PR.
