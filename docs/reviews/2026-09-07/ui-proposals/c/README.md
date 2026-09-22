# Proposal C — combined direction

[Open C](http://localhost:3135/ui-proposals/c/) · [Compare A / B / C](http://localhost:3135/ui-proposals/)

Standalone design prototype. Proposal A, Proposal B, and all application/backend files remain unchanged. This revision combines B’s visible editing controls with A’s metric import, core metric selection, and impact estimate workflow.

## Current controls

| Area | Behavior |
|---|---|
| Typography | Regular-weight navigation, buttons, headings, labels, metrics, and action details throughout. Document authors can still apply bold with the editor toolbar. |
| Report title | Editing a report title also renames its current project folder immediately. The top navigation label and tooltip, project list, Actions heading, and Impact context stay aligned. Existing project/report IDs and other report titles stay intact. |
| Header | The plain project selector sits directly beside the pill tabs. Navigation text is 10% larger than the preceding C revision: 12.32 px at full desktop width, with proportional increases at smaller breakpoints. Create retains its rounded rectangle and matched tab height. |
| Onboarding brief | **What are we building?** replaces the previous heading. The Business challenge subtitle and Evidence dropdown are removed. **Add website, pdf or text for your new project** opens a context dialog directly below the brief. Website, PDF, and pasted text selections carry into the report. |
| Reports and onboarding | The same Tiptap editor is used in both. Paragraph/heading styles, bold, italic, underline, strikethrough, lists, quotes, links, clear formatting, undo, redo, and keyboard shortcuts. |
| Sections | Click any of the four default headings to rename it. **＋ Section** adds another editable heading and body. The report outline follows renamed and added sections. Formatting and section names survive report switching and project creation. |
| Rewrite | B’s Rewrite control is restored. Preview, Keep, and Discard apply to the selected text or active section. A stale preview cannot overwrite a later edit. This is a prepared local shortening interaction, not connected AI. |
| Charts | Chart → metric/type/title → Generate → Insert. Line and bar charts use the chosen metric’s actual local observations. Existing charts can be edited or removed. Sources and sample/imported provenance remain attached. |
| Metrics | Add from Create, Data, report controls, or either onboarding phase. Upload/drop a CSV or paste it, choose date/value columns, confirm the definition, preview, then import. Unit, percentage scale, beneficial direction, daily aggregation, population, and definition are available. |
| Core metrics | **Select core metrics** is available in normal reports and onboarding review. Selections carry into the project and control the bottom drawer outside Data. Available sample metrics are explicitly labeled. |
| Impact estimates | Select a primary core metric, expected change, relative percent or percentage-point units, and review date. Estimate shows the baseline and target. Values are not prefilled as commitments. Estimates are labeled separately from measured results. |
| Onboarding action review | Prepared draft actions appear below the metric/impact controls, with an **Actions ↓** shortcut by the report title. Edit, add, or remove actions before creating the project. Actions, harness recommendations, cost assumptions, and PR URLs carry into the Actions tab. Back/Build retains edits; a changed brief refreshes untouched actions or flags edited actions for review. Nothing starts automatically. |
| Actions | Expand any action to edit its title, owner, status, completion date, summary, acceptance criteria, and instructions. Recommended harness and security level are editable. Completion counts and Impact rows follow the edited status. |
| GitHub PR | Each expanded action has a **GitHub PR** URL field and a working **Open PR #…** link after a valid GitHub pull-request URL is supplied. Sample PR #41/#44 are explicitly identified as samples with no linked repository. Links are not fetched or verified by the prototype. |
| AI cost | Each action shows a planning range. Expand **Estimated AI cost** to edit input/output token budgets, per-million token rates, and maximum passes. The preview calculates one pass through the selected maximum. Manual work shows **No AI**. |
| Less copy | Removed “In this report,” “Edited locally,” the report metadata row, the repeated implementation subtitle, and the Metric Library exploration hint. Metric names have no leading icons. |

## Review path

1. In Reports, rename **Overview**, format a paragraph, and add a section. Switch to another report and return.
2. Choose **Rewrite**, then Preview and Keep/Discard. Choose **Chart**, Generate and Insert; edit or remove it afterward.
3. Choose **Create → Project**. Start with a business challenge or the original Gummy Alpha / Northstar example. Add a metric before building the report or during review.
4. In metric import, use the [sample CSV template](assets/metric-template.csv), your own CSV, or Paste CSV. Preview the mapping and definition before importing.
5. In the onboarding report, rename sections, select core metrics, estimate impact, and insert a chart. Use **Actions ↓** to review the draft actions. Edit/add/remove actions, then create the project and verify the same document, metrics, and actions in the four tabs.

6. In Actions, expand a task and edit its details. Change the harness or status. Expand **Estimated AI cost** and adjust the assumptions; the summary range updates immediately.

## Data and persistence

- Everything stays in this browser tab until reload. There is no database saving, publishing, deployment, or external AI invocation.
- CSV files are read locally and do not leave the browser. The limit is 1 MiB / 10,000 observations. Dates must be unique, valid `YYYY-MM-DD` UTC dates; values must be finite numbers. Invalid data does not create a metric. Percentage ratios are explicitly converted to percentage points for display.
- Latest, L7, L28, and WoW use the imported observations. L7/L28 require every day in the corresponding calendar window; incomplete windows display “—”. WoW also requires a complete previous seven-day window and a non-zero denominator. These are arithmetic means of the provided daily values.
- Generated line charts display the available daily series. Bar charts show at most the most recent 28 observations, with their actual dates. Charts are never created from invented data when a project has no metrics.
- The original First session observations and causal illustration remain labeled sample data. New projects and imported metrics do not inherit a synthetic causal result. An entered target is a user estimate, not a fitted model or measured effect.
- Optional onboarding website/PDF/text context stays local. URLs are not fetched, PDFs are not extracted or uploaded, and prepared drafts do not use the context as model input. Pasted text is retained in the report. The context dialog validates website schemes and PDF size/type before continuing.
- The template and original example data are illustrative, not customer evidence.
- Action cost presets are illustrative planning assumptions, not vendor pricing or actual usage: $5 per million input tokens, $25 per million output tokens, and one to two passes. The four preset task ranges are $0.50–$1.00, $1.00–$2.00, $0.75–$1.50, and $0.25–$0.50. Adjust the rates and budgets to the selected model. Subscription charges, engineering time, and external tool fees are excluded. Harness recommendations are editable examples; no agent is launched.

## Verification

The typography pass confirmed regular (400) computed font weight across Reports, Data, Actions, Impact, and onboarding. Editor-applied emphasis remains available.

Browser checks covered desktop and 390 px phone layouts, adjacent project/tabs positioning and font sizes, formatting persistence, section renaming and addition, list undo/redo, Rewrite Preview/Keep, chart generation/insertion/editing, both onboarding metric entry points, CSV paste/import, explicit percentage scale conversion, duplicate-date rejection and recovery, core selection, estimate calculation, Back/Build preservation, and the complete onboarding-to-project handoff. Chart and Rewrite stay visible on phone; other formatting tools scroll within their row. Action editing checks covered title/owner/harness/status changes, summary/instructions/acceptance edits, recalculated AI cost ranges, tab-switch persistence, escaped text in Impact rows, and completion counts. The action form also fits the 390 px layout. No document-level horizontal overflow or final console errors were observed.

Six focused data tests cover CSV quoting/BOM/CRLF, malformed data and duplicate dates, missing calendar windows, zero denominators, percentage versus percentage-point estimates, constant/single-point charts, escaping, and AI cost arithmetic/invalid assumptions. JavaScript syntax, HTML references/assets, whitespace checks, A/B hashes, and the empty backend diff were verified. Native file-picker/drop interaction was not automated; the same parser/import path was exercised through Paste CSV. The full application and engine suites were not rerun for this isolated prototype.

The onboarding action pass verified website validation/recovery, text-context retention, blank context for a second project, Gummy Alpha and Northstar action plans, action edits, add/remove, Back/Build preservation, project-to-Actions handoff, valid PR link rendering, rejection of a JavaScript URL, regular font weights, and phone field widths. Native PDF picker interaction was not automated.

## Pull request

[Engineering PR #35](https://github.com/Causent-AI/causent-ai/pull/35) was verified open and draft on September 21, 2026. It contains the earlier engineering work. These latest UI proposal edits remain local and are not included in that PR.

## Local build

The shared editor uses the repository’s installed Tiptap packages. Rebuild its local browser bundle after editing `src/workbench.js` or `src/metric-data.mjs`:

```sh
node docs/reviews/2026-09-07/ui-proposals/c/build.cjs
node --test docs/reviews/2026-09-07/ui-proposals/c/src/metric-data.test.mjs
```

No dependencies or application build settings were changed. The build writes [license notices](assets/workbench.LICENSE.txt) for all 33 bundled dependency packages.
