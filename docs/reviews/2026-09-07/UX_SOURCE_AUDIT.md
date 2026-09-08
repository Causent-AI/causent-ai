# Causent UX source audit

**Date:** September 7, 2026 · **Source baseline:** `dd1901db247d5ca824d0a8419497d94113d13127`, the merged T05–T10 delivery. **Scope:** independent source review; recommendations only. No application code changed by this audit.

## Overview

The report should become the primary editable document. Causent already has much of the necessary editor foundation: real paragraphs, headings, lists, links, formatting, autosave, and revision conflict handling. The current presentation makes these capabilities feel like a structured intake form. Fixed section boundaries, nested borders, repeated commitment summaries, and permanent support controls interrupt the narrative. Opening a report also leads through a separate summary page before the full document, which lives under the onboarding route.

The recommended revamp is a continuous document with a quiet toolbar, an optional outline, and a small set of useful embedded objects. AI should draft or revise the selected content when requested. Connected data should produce editable charts and tables. Operational settings and historical details should open beside the document. This changes the working surface substantially while preserving the report's structured claims, evidence, and activation records.

## Executive Summary

- **Make the document central.** Open the complete report directly; let users write or ask AI to draft in place. Keep charts, action summaries, and decision commitments as purposeful embedded blocks.
- **Reduce repeated explanation, not essential meaning.** Use one- or two-word controls, hide implementation details in context, and display one clear limitation beside an outcome. Units, dates, evidence status, and consequential confirmation still need words.
- **Extend the existing editor.** Reuse Tiptap, portable rich text, autosave, and typed edit commands. A new generic rich-text store would discard useful foundations and create a migration problem.
- **Use AI as a proposal tool across tabs.** Reports gets Draft and Rewrite; Data gets suggested import mapping; Actions gets draft instructions; Impact gets an evidence-backed explanation and chart request. Every result remains reviewable and editable.
- **The strongest objection is semantic integrity.** A freeform document can become pleasant to edit while losing its reliable mapping to actions, predictions, and evidence. The new document model must retain those identities. AI must not turn a draft into a registered plan or invent observed values.

## Methodology & Data

This review inspected the current route composition and source for all four dashboard tabs; the report creation and full editor flow; Tiptap document nodes and formatting tools; chart upload; report and action lifecycle controls; data import and measurement forms; impact presentation; generation instructions; and rich-text persistence. The source paths below were unchanged between the original branch head `8d9986f` and merged baseline `dd1901d` during this audit.

Observed findings describe rendered structures and available handlers in source. Proposed effects on comprehension or speed are design hypotheses. This audit does **not** supply browser captures, user testing, measured contrast, real device results, or live AI results. The main review should combine it with the separate browser audit. Word and Perplexity are user-supplied design references here; this document makes no independently verified claims about their current products.

The database-backed Reports route uses `DecisionReportsIndex`. The legacy `ReportsPageClient` and `ReportPreview` only render the alternate non-database branch. Findings about that older preview must not be presented as defects observed in the current customer route. See `app/(dashboard)/reports/page.tsx:22–35`.

## Analysis

### Prioritized recommendations

“Now” denotes the first redesign slice; these labels are independent of the engineering review's P1/P2 severity.

**UX01 · Now · Replace the nested report surface with a continuous document.**

The editor mounts separate Decision and Action Plan canvases. Each canvas adds a rounded border, shadow, section rules, and uppercase section labels; required headings are non-editable structural elements. Evidence: `DecisionReportEditor.tsx:1118–1176`, `ReportCanvasEditor.tsx:111–146,698–729`. Keep a readable central text column, use ordinary document headings, and remove borders around normal paragraphs. Retain a compact outline and dedicated blocks for charts, actions, and the commitment. The first slice can preserve existing claim IDs and section constraints behind a simpler surface; arbitrary section reordering needs an explicit presentation-model change. **Acceptance:** paragraph editing, formatting, undo, save, reload, and activation still preserve claim and action identity; prose is not enclosed in individual cards.

**UX02 · Now · Open one report workspace, with history beside it.**

Reports currently shows a 340-pixel list plus a read-only summary. “Open full report” navigates to `/onboarding`, whose layout deliberately omits the dashboard tabs. Evidence: `DecisionReportsIndex.tsx:112–210`; `app/(onboarding)/layout.tsx:7–24`. Open the full document from the report list, with the list collapsible and History available as a drawer. Give established reports a report-specific destination while preserving old links. Rename “Create next version” to “Revise”; show the active version's immutable status and open an editable successor. **Acceptance:** selecting a report reaches its complete content in one action, Back restores the selection, and a revision never silently replaces the active record.

**UX03 · Now · Add contextual AI drafting and rewriting.**

Generation is available from the initial business-challenge form. The full editor and formatting toolbar have no Draft, Rewrite, Shorten, or section-generation handlers. Evidence: `DecisionReportOnboarding.tsx:150–190,358–369`; `DocumentEditorToolbar.tsx:151–270`. Add one Ask control and contextual commands on selection or an empty block. Stream a proposed replacement in place, with Keep, Retry, and Discard; preserve the user's text until accepted. Keep manual editing available. **Acceptance:** a user can shorten one paragraph without regenerating the report, cancel a request, undo an accepted edit, and retry without duplicate paid work. Depends on T13 admission controls and a revision-bound generation receipt.

**UX04 · Now · Create chart and table objects from real data.**

“Add chart or graph” currently uploads a PNG/JPEG. The empty upload tile renders even on a read-only report with no asset, followed by file limits and sanitization details. Evidence: `SuppliedMockup.tsx:6,20–59`. Replace it with an Insert menu offering Chart, Table, and Image; show no empty media frame in a finished report. A chart request should select authorized metrics, dates, aggregation, and a chart type, then render from structured data. Keep labels, units, sources, and filters editable. **Acceptance:** every plotted value resolves to the selected data snapshot or is explicitly marked illustrative; charts have an accessible data table, and refreshing data creates a reviewable update. This needs a typed artifact model: current portable text nodes do not include tables or data charts (`schema.ts:35–94`).

**UX05 · Now · Adopt a short, consistent control vocabulary.**

The main tabs already read Data, Reports, Actions, and Impact, with icons. The larger copy problem is inside pages: “Build Decision Report,” “Open full report,” “Create next version,” and “Copy Task Instructions to.” Evidence: `TabStrip.tsx:8–12`; `DecisionReportOnboarding.tsx:365`; `DecisionReportsIndex.tsx:37,182`; `DecisionDetail.tsx:488`. Use Draft, Open, Revise, and Copy. Keep a one-word text label for primary destinations; use familiar icons for secondary actions with accessible names and keyboard-accessible tooltips. **Acceptance:** routine controls use one or two words, with a documented exception for clarity; icon-only controls remain understandable without hover. Do not shorten metric names, error meaning, or causal limitations merely to satisfy a word count.

**UX06 · Next · Make Data a single metric library.**

The page stacks measurement setup, a complete import form, Core Metrics, and Workspace Metrics. The two metric tables repeat identity and unit information. Evidence: `data-workshop/page.tsx:84–117`; `ConnectedMetrics.tsx:32–43`; `WorkspaceMetricCatalog.tsx:21–36`. Lead with one searchable library showing metric, recent value, freshness, and report selection. Import opens a focused flow. On request, AI can suggest column mapping and descriptions from the uploaded file; show a preview and require confirmation of ambiguous scale, population, aggregation, and beneficial direction. **Acceptance:** existing metric definitions remain immutable, imports retain validation and receipts, and the page does not require scrolling past a full form to inspect connected data.

**UX07 · Next · Turn measurement setup into a reviewed AI proposal.**

The measurement form asks directly for dates, lag, threshold, population, references, and concurrent-change assessment. Its threshold label exposes “stored metric units.” Evidence: `MeasurementPlan.tsx:23–36,62–78`. Let Ask draft a plan from the report, available daily data, and an explicit rollout brief. Present a compact sentence and timeline; put technical settings in Details. Use the actual metric unit beside the threshold. Missing exposure facts stay missing, with focused follow-up prompts. **Acceptance:** the user sees and confirms the proposed outcome, exposure, population, window, threshold, and limitations before registration. AI cannot claim actual exposure, overwrite an immutable plan, or conceal insufficient observations.

**UX08 · Next · Make Actions an execution list.**

Actions repeats the report's decision and commitment, then gives each row a code, drift status, priority stars, tags, metric, handoff instructions, and completion state. Expanded details repeat governance per action. Evidence: `DecisionDetail.tsx:241–265,302–355,440–565`. Lead with title, owner, state, and the next available action. Open detail and AI instruction drafting in one drawer; move report-wide context and governance to shared Details. Preserve the existing expandable rows and action deep links. **Acceptance:** a user can find incomplete work and its owner without reading the report again; Copy and completion actions remain explicitly initiated, and completion does not imply customer exposure.

**UX09 · Next · Make Impact chart-first.**

The report impact view stacks five summary tiles, a separate Prediction panel, a timeline, and action-level outcome rows. Evidence: `ReportImpactOverview.tsx:85–135,137–207`. Lead with one outcome verdict and the primary metric timeline, showing planned and observed values with their proper meaning. Put supporting metrics and action context below or behind selection. Add Explain to draft a concise interpretation from the server-owned result and limitations. **Acceptance:** a user can identify the outcome state, primary value, period, and main limitation from the first view; a measured change is never relabeled as identified action or AI contribution.

**UX10 · Now · Consolidate status and methodological explanation.**

The editor has a sticky multi-line lifecycle bar. Data and Impact show recompute banners; Impact also repeats attribution caveats in the overview and page footer. Evidence: `DecisionReportEditor.tsx:1205–1224`; `CausalRecomputeStatus.tsx:3–27`; `ReportImpactOverview.tsx:118–142`; `TrustCaveat.tsx:8–14`. Use compact Saved, Updating, or Review states, with one next action where needed. Show the essential result qualifier inline; move diagnostics and method explanation into Details. **Acceptance:** the initial view contains one primary status explanation, errors remain actionable and announced, and a disqualifying limitation is never hidden behind a tooltip.

**UX11 · Now · Preserve evidence through edits and AI suggestions.**

Generation already separates source-backed material, inference, suggestion, and missing facts. Text edits deliberately change a claim to user-confirmed and clear old source links. The current canvas section props carry content and invalid state, but not provenance affordances. Evidence: `generate.ts:122–139`; `editing.ts:257–275`; `ReportCanvasEditor.tsx:31–46`. Add a quiet Sources affordance on selection and an inspector showing the underlying quote and claim status. Extend AI edit acceptance with an explicit proposed-claim contract; do not feed model text through a path that silently treats it as human-confirmed evidence. **Acceptance:** a rewrite cannot retain a citation that no longer supports its claim, formatting-only changes preserve support, and an accepted AI suggestion remains distinguishable from observed data.

**UX12 · Next · Use a shared responsive and accessibility contract.**

Controls mix 9–15-pixel type and several height conventions. The report formatting toolbar already supplies accessible names, pressed state, and touch-sized buttons. Main navigation lacks an explicit `aria-current` attribute, report selection is communicated through CSS, and the report history popover has a fixed 320-pixel width. Evidence: `TabStrip.tsx:32–43`; `DecisionReportsIndex.tsx:38,143–160`; `DocumentEditorToolbar.tsx:24–35`. Standardize typography, focus treatment, status badges, toolbar buttons, and drawers. **Acceptance:** keyboard and screen-reader navigation identify the current page and selected report; touch targets stay usable, zoom does not hide controls, and the proposed layout is checked at 390, 768, and 1440 pixels. These are required future checks, not passed checks from this source review.

**UX13 · Later · Give the document a useful reading and export mode.**

The current editor exposes editing and operational chrome around the document, while Reports separately reconstructs a reduced summary from plain claim text (`DecisionReportsIndex.tsx:193–208`). Use one renderer for editing, reading, and export. Offer a clean Read view and a later Export action for Word/PDF, preserving paragraphs, headings, source references, and chart data. **Acceptance:** exported content matches the selected saved revision; normal text remains editable in Word, charts have captions and sources, and unsaved or unpublished changes are clearly identified. This is product scope, not a claim that native document export already exists.

**UX14 · Next · Validate the redesign with task outcomes.**

Causent has a bounded lifecycle telemetry seam that excludes report and source text (`telemetry.ts:14–22`). Extend it with privacy-preserving measures for useful AI acceptance, undo, time to first retained draft, correction effort, and successful report-to-action handoff. Compare the current and proposed experiences with representative users and the same tasks. **Acceptance:** users can create, revise, inspect evidence, and understand an unavailable result without coaching. Measure AI usefulness separately from generation volume and graph size; connect that evaluation to T14's learning-quality work.

### Engineering sequence and reusable foundation

| Dependency | Consequence for the revamp |
|---|---|
| T13: application AI admission | Complete before expanding paid generation to every tab. Reuse one cancellation, concurrency, budget, and idempotency contract. |
| T12: resolution fairness | Keep failures isolated so a poisoned workspace does not leave unrelated outcome views stale. UX should distinguish retrying from user action required. |
| T11: recompute lock telemetry | Establish a measured baseline before adding interactive data transformations or claiming responsive recomputation. A chart request should not trigger unrestricted fitting. |
| T14: descriptive history and evaluation | Use accurate History/Outcomes language. Evaluate forecast and decision usefulness separately from AI request counts. |
| Typed claims and portable rich text | Preserve stable semantic IDs while changing presentation. Version any new block-order, chart, or table schema and support existing reports. |
| Autosave, conflicts, immutable activation | AI proposals bind to a revision. Late results must not replace edits or revise an active commitment. |
| Existing native dialogs and Tiptap selection context | Reuse for Details and AI tools; avoid a second parallel editor or unrelated interaction framework. |

Build the first redesign around UX01–05 and UX10–11: one report workspace, contextual AI, typed artifacts, concise controls, and preserved evidence. Then apply the same interaction patterns to Data, Actions, and Impact. Export and broad document reordering can follow once the editor and semantic round trip are dependable.

## Appendix

### Example copy changes

| Current | Proposed | Where detail belongs |
|---|---|---|
| Build Decision Report | Draft | Prompt helper, only when needed |
| Open full report | Open | Complete document opens directly |
| Create next version | Revise | History drawer explains the active version |
| Customers and stakeholders | People | Optional document section |
| Add chart or graph | Chart | Insert menu includes Chart, Table, Image |
| Copy Task Instructions to | Copy | Menu offers the intended destination |
| Confirm and import | Import | Review step makes confirmation explicit |
| Confirm and register plan | Register | Reviewed plan immediately precedes action |
| Waiting for autosave… | Saving… | Persistent compact save state |
| Measurement review current | Updated | Timestamp and diagnostics in Details |

Do not mechanically shorten every message. “Cannot attribute outcome,” a date mismatch, units, and a conflict recovery instruction carry essential meaning. Simplification should remove repetition and expose the next action.

### Source register

Paths below are repository-relative; line references above refer to the reviewed baseline.

- Shell: `components/shell/TabStrip.tsx`, `GlobalHeader.tsx`, `app/(onboarding)/layout.tsx`, `app/globals.css`.
- Reports route and library: `app/(dashboard)/reports/page.tsx`, `components/reports/DecisionReportsIndex.tsx`; alternate legacy surfaces `ReportsPageClient.tsx`, `ReportPreview.tsx`.
- Full document: `components/decision-report/DecisionReportEditor.tsx`, `DecisionNarrativeCanvas.tsx`, `ActionPlanCanvas.tsx`, `SuppliedMockup.tsx`, `DecisionReportOnboarding.tsx`.
- Editing foundation: `components/decision-report/rich-text/ReportCanvasEditor.tsx`, `DocumentEditorToolbar.tsx`; `lib/decision-reports/schema.ts`, `editing.ts`, `generate.ts`, `telemetry.ts`.
- Data: `app/(dashboard)/data-workshop/page.tsx`; `components/data-workshop/MeasurementPlan.tsx`, `WorkspaceMetricCsvDropzone.tsx`, `ConnectedMetrics.tsx`, `WorkspaceMetricCatalog.tsx`.
- Actions: `components/actions/ActionsPageClient.tsx`, `DecisionDetail.tsx`.
- Impact: `app/(dashboard)/impact/page.tsx`; `components/impact/ReportImpactOverview.tsx`, `PredictionPanel.tsx`, `TrustCaveat.tsx`; `components/causal/CausalRecomputeStatus.tsx`.
- Engineering dependencies: `docs/reviews/2026-09-06/reference/TECHNICAL_REVIEW.md:101–131`; these define task intent, not completion of the concurrent engineering pass.
