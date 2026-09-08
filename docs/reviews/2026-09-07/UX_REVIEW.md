# Causent: a document workspace with AI on request

## Overview

Make the report the place where the user works. The proposed experience is a continuous, editable document with ordinary paragraphs, a compact toolbar, and a few useful chart, table, and action objects. Sources, history, settings, and AI suggestions open beside it. The same concise controls and request → preview → accept pattern should carry through Data, Actions, and Impact.

This is a substantial revamp of presentation and interaction. It can reuse Causent's existing Tiptap editor, autosave, typed claims, provenance checks, and immutable activation records. The current problem is not a lack of rich text: the interface surrounds rich text with so many fixed sections, borders, and explanations that it feels like a form.

**Review the [interactive proposal](ux-proposal/index.html).** It includes all four tabs, editable paragraphs, a prepared AI revision with Keep/Discard, and chart insertion. It uses illustrative content, makes no network requests, and saves changes only until reload. It is a design demonstration, not implemented product functionality.

## Executive Summary

The first redesign should combine UX01–05 and UX10–11: one report destination, a continuous document, contextual AI, data-backed artifacts, short controls, and reliable evidence through edits. Then apply the shared pattern to the other tabs. Retain manual editing as an immediate option; AI should remove blank-form work without becoming an obligation.

I recommend keeping **Data, Reports, Actions, Impact** as visible one-word destinations. They already have icons. Removing those four words would save little space while making unfamiliar destinations harder to recognize. Familiar secondary actions—close, more, attach, format—can use icons with accessible names. Paragraphs, metrics, units, and meaningful result limitations need enough words to remain useful.

The strongest objection to a Word-like surface is loss of semantic integrity. A pleasant freeform editor is insufficient if moving a paragraph severs its source or an AI rewrite silently changes an approved prediction. Preserve stable claim, metric, action, and revision identities underneath the document. Keep activation and real exposure explicitly confirmed.

## Methodology & Data

The source baseline is merged PR #34 (`dd1901d`). The review traced the database-backed routes for all four tabs and the full report editor, with an independent source/design-consistency pass. It inspected a real authenticated local session in the retained **Measurement review / Registered outcomes** synthetic workspace. Captures show the actual application; the proposal is separately labeled. This fixture contains a registered exposure mismatch, so its unavailable outcome is intentional evidence of a limiting state.

Desktop captures cover Reports, the full report, Data, Actions, and Impact. Phone-width checks cover the full report, Data, Actions, and Impact; the proposal was checked at phone, tablet, and desktop widths. Captures confirm layout only. This was not a screen-reader audit, contrast measurement, paid-model acceptance test, real-device test, or study with representative customers. Draft editing and persistence foundations were verified in source; the captured active report is immutable. No causal or business improvement is inferred from these screenshots.

Microsoft's documented Word workflow supports drafting in a document, working on selected content, and keeping or discarding proposed text. Borrow this local editing interaction, rather than making every edit a new chat. [Microsoft Support](https://support.microsoft.com/en-us/word/copilot/draft-and-add-content-with-copilot-in-word)

Perplexity documents prompt-created artifacts, side-panel previews, follow-up edits, history, and export. Its Research update also describes reports enriched with charts and tables. Borrow the finished-artifact workflow and rapid refinement. For Causent, values should come from authorized data or clearly labeled illustrative scenarios. [Perplexity assets](https://www.perplexity.ai/help-center/en/articles/12528830-creating-assets-with-perplexity-overview), [Research update](https://www.perplexity.ai/changelog/what-we-shipped-june-13th)

## Analysis

### What the current screens show

| Evidence | Observation | Recommended change |
|---|---|---|
| [Full report, desktop](ux-evidence/report-desktop.jpg) | Background, Problem, Decision, and three optional Evidence headings sit inside a bordered canvas. An empty chart frame and upload-processing copy remain in the active report. | UX01/04: ordinary document headings; no empty media block; Insert offers Chart, Table, Image. |
| [Reports](ux-evidence/reports-desktop.jpg) | A version list and reconstructed summary precede an Open full report link. The full report then loses the main tabs. | UX02: selecting a report opens its complete document in the same workspace; History is secondary. |
| [Data](ux-evidence/data-desktop.jpg) | Measurement setup and an import form precede two overlapping metric lists. | UX06/07: lead with one metric library; open import or plan review on demand. |
| [Actions](ux-evidence/actions-desktop.jpg) | Decision text, commitment, history, tags, handoff controls, and metrics compete with the work list. | UX08: title, owner, state, next action; open context in one drawer. |
| [Impact](ux-evidence/impact-desktop.jpg) | Five summary tiles precede a separate prediction panel and history chart; attribution limitations recur in several places. | UX09/10: one clear verdict and primary timeline; one visible limiting explanation; diagnostics in Details. |
| [Report on phone](ux-evidence/report-mobile.jpg) | The long sequence of bordered sections and the lifecycle bar consumes substantial reading space. | UX01/12: a fluid document, compact status, collapsible outline, and a sheet for secondary controls. |

The active fixture also shows **Set the expected change** and empty disabled commitment inputs inside the full report, while Actions correctly shows the stored +15% commitment and November 30 resolution. Treat this as a lifecycle presentation defect to resolve in UX02: render the immutable active commitment consistently across views. The fixture establishes the mismatch; its prevalence in other reports is unverified.

### Recommended backlog

Priority denotes redesign order, not a new production incident severity. Detailed file references and acceptance criteria are in the [source audit](UX_SOURCE_AUDIT.md).

| ID | Priority | Recommendation | Completion criterion |
|---|---|---|---|
| UX01 | First | Continuous document | Paragraphs share one reading surface; formatting, undo, save/reload, and semantic identities survive. |
| UX02 | First | One report workspace | Open full content directly; retain tabs; History and Revise sit alongside; active commitments render correctly. |
| UX03 | First | AI in context | Draft, Rewrite, or Shorten a selected paragraph; preview, Keep/Discard, cancel, and undo work without replacing unrelated edits. |
| UX04 | First | Generated artifacts | Ask for a chart/table from selected data; edit its specification; inspect the source table and date window. |
| UX05 | First | Concise controls | Routine labels use one or two words; familiar icon actions have names and keyboard support. |
| UX06 | Next | One metric library | Inspect existing data immediately; Import opens its own focused flow; optional AI proposes mappings. |
| UX07 | Next | Draft measurement plans | AI proposes from known context; the user confirms scale, population, dates, and registration. Actual exposure requires real evidence. |
| UX08 | Next | Execution-focused Actions | Find unfinished work and its owner without rereading the report; ask for editable task instructions in a drawer. |
| UX09 | Next | Chart-first Impact | Identify outcome, period, primary value, and main limitation at a glance; Explain summarizes the stored result. |
| UX10 | First | One status explanation | Saved/Updating/Review stay compact; repeated copy disappears; errors and disqualifying limitations remain visible. |
| UX11 | First | Evidence-preserving edits | An AI suggestion never becomes sourced merely because it was accepted; citations remain bound to supporting text. |
| UX12 | Throughout | Accessible responsive system | Current navigation, focus, drawers, touch controls, zoom, and reading order work across the supported widths. |
| UX13 | Later | Read and export | One renderer serves reading and Word/PDF export; saved revision, citations, and charts remain consistent. |
| UX14 | Throughout | Validate usefulness | Measure retained suggestions, correction/undo, task completion, and understanding—not generation volume. |

### How a report should work

Start with a brief or a source and choose **Draft**. AI produces a short editable narrative with sources and clearly marked proposals. The user edits paragraphs directly or selects a passage and chooses **Rewrite**. A suggestion stays separate until Keep; Discard leaves the original intact. A stale result cannot overwrite a later edit. Ask should know the selected paragraph, report revision, and authorized source context.

Use a narrow optional outline for Summary, Decision, Plan, and Measurement. Those are useful defaults, not mandatory paragraphs of help text. Most content is prose. Embed an action list where work becomes concrete, one primary chart where it answers a question, and a compact commitment summary when ready. Put explanations of storage, sanitization, and model mechanics in help or operational documentation.

For **Chart**, a request such as “Show weekly activation for the last three months” proposes a metric, range, aggregation, and chart type. Causent fetches authorized observations and renders a typed chart object. The user can adjust labels or switch chart/table views. Missing data produces a request to connect data, not invented history. Public research, workspace measurements, and simulations must remain distinguishable. Generated charts should not require uploading a screenshot.

Read mode removes editing chrome. Active reports show their saved commitment and offer **Revise** to create a successor. Changing prose or asking AI for ideas must never silently change an active measurement contract. Sources and method details stay close enough to inspect without making the whole document read like a checklist.

### A shared AI pattern across tabs

| Tab | User request | Proposed output | Human confirmation |
|---|---|---|---|
| Reports | Draft / Rewrite | Paragraphs, outline, evidence-backed explanation | Keep edits; review before activation |
| Data | Map / Chart / Explain | Suggested columns, metric definition, chart specification | Confirm ambiguous meaning before import |
| Actions | Draft / Refine | Editable task instructions or proposed decomposition | Accept changes; explicitly copy or mark complete |
| Impact | Explain / Compare | Short interpretation and chart using stored results | Keep narrative; estimates and limitations remain server-owned |

T13 provides initial admission, request identity, cancellation, and budget controls. The redesign still needs revision-bound AI proposals and typed chart/table artifacts. Existing human text edits deliberately clear source links and become user-confirmed; using that same operation for AI would misstate provenance. That boundary deserves implementation and adversarial tests before broader generation ships.

### Sequence and validation

First settle this document direction with the interactive proposal. Build one real report path around UX01–05/10–11, including semantic round-trip and AI acceptance tests. Then apply the established components to Data, Actions, and Impact. Keep export and arbitrary block reordering later; they add persistence and compatibility work without first proving the daily experience.

Run the same tasks on current and revised screens: create a useful draft, shorten one paragraph, inspect its source, insert a valid chart, find the next action, and explain an unavailable outcome. Record where users hesitate and how often they correct or undo AI. Proposed targets are one click from report selection to full content, one coherent document surface, no empty chart frame in Read mode, and all routine controls within the short vocabulary. These are acceptance targets, not measured improvements.

## Appendix

- [Independent source audit and code references](UX_SOURCE_AUDIT.md)
- [Interactive proposal](ux-proposal/index.html), [desktop capture](ux-evidence/proposal-desktop.jpg), [phone capture](ux-evidence/proposal-report-mobile.jpg), [tablet capture](ux-evidence/proposal-tablet.jpg)
- Actual phone captures: [Data](ux-evidence/data-mobile.jpg), [Actions](ux-evidence/actions-mobile.jpg), [Impact](ux-evidence/impact-mobile.jpg)
- [Engineering plan](T11_T14_PLAN.md), [engineering delivery review](T11_T14_ENGINEERING_REVIEW.md)
- [Existing report requirements](../../designs/ai-assisted-decision-report.md)

Screenshots contain synthetic workspace data. Prototype interactions were browser-checked: tab switching, Rewrite → Preview → Keep, and Compare. This review does not claim real AI generation, successful native export, complete accessibility conformance, or partner validation.
