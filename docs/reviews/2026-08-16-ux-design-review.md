# Causent Decision Report: UX Design Review

Date: 2026-08-16

Scope: local Decision Report onboarding, two-canvas editor, multi-metric action planning, activation, and the handoff into the dashboard loop

Method: rendered browser review at `http://localhost:3100`, desktop at 1280 x 720 and mobile at 390 x 844, plus source inspection to identify the exact cause of rendered issues. This is a design review, not customer evidence.

Founder follow-up: the selected response to every major finding is recorded in
[Decision Report UX review follow-up](2026-08-16-ux-design-review-follow-up.md). That implementation
record supersedes the earlier “implemented” option choices in this review where the founder selected
a different option. It does not change this document's original rendered evidence or turn it into
partner evidence.

## Executive verdict

The new two-canvas structure is the right product shape. The opening question is direct, the generated report reads like a real document, evidence is visibly optional, all suggested actions are present, multiple metrics can be selected, and a metric can be tied to each action. The interface looks calm and deliberate rather than like a generic dashboard.

The loop is not yet self-evident. Two P0 defects found during the rendered review were fixed before
handoff: the sample no longer changes project identity after reload, and the shared toolbar now stays
at the viewport edge while editing later actions. Three remaining breaks matter most:

1. The final commitment sits several screens below the report and summarizes only an action count, not the decision the user is activating.
2. Each action mixes a rich-text paragraph with a duplicate title field and dense form controls.
3. The mobile layout fits, but the title, toolbar, and touch targets still need a mobile-specific interaction design.

Headline scores:

| Measure | Grade | Read |
|---|---:|---|
| Visual design | B | Calm, legible, and consistent, with good restraint |
| Workflow clarity | B- | Identity and editor continuity are fixed; the path from edit to commit to learn is not |
| Mobile editing | C | No horizontal overflow, but title, toolbar, and touch-target behavior need a mobile design |
| AI-slop resistance | A- | No gradient hero, decorative card grid, ornamental icons, or inflated copy |

## First impression

The onboarding communicates one job: describe the business challenge and let Causent form the decision. My eye goes first to the question, then the large challenge field, then the two examples. That is the intended hierarchy.

The generated report communicates a serious planning document. My eye goes to the report title, then Decision, then the section headings inside the first editor. The second half becomes less obvious because rich text, Core Metrics, action controls, execution metadata, the prediction chart, and activation all compete inside one long page.

One-word verdict: **credible**.

## Rendered evidence

The following measurements came from the current local page, not from source inference:

| Observation | Desktop evidence | Mobile evidence |
|---|---:|---:|
| Rich editors | Exactly 2 `contenteditable` surfaces | Exactly 2 |
| Total report page height | 3,643 px at 720 px viewport height | 5,713 px at 844 px viewport height |
| Formatting toolbar | y = 298-334 px initially; pinned at top 0 beside Action 4 after fix | Wraps across three visual rows |
| Action Plan rich editor | Begins at y = 1,914 px | Far below the first screen |
| Activation panel | Begins at y = 3,347 px | Appears near the end of the 5,713 px page |
| Horizontal overflow | None | None; document width remains 390 px |
| Small controls | Several 36 px toolbar controls | Account control 32 px; toolbar controls 36 px; evidence removal controls approximately 15 px high |

The rendered review initially reproduced an identity change and a non-sticking toolbar. The final tree
uses the real `Orbit · Gummy Alpha` context both before and after reload, and browser acceptance at
scrollY 2,951 measured the toolbar at viewport top `0`. The fourth action still renders all of these
in one block: editable prose, a duplicate title field, monitoring metric, primary-action radio, Owner,
Time, Cost, Tags, Skills, priority stars, and Remove action.

## What is working

- The opening is casual, business-first, and scannable. The challenge prompt and examples are the focal point ([DecisionReportOnboarding.tsx:223-280](../../components/decision-report/DecisionReportOnboarding.tsx#L223-L280)).
- Evidence is optional and separated from the required challenge instead of blocking report creation ([DecisionReportOnboarding.tsx:282-328](../../components/decision-report/DecisionReportOnboarding.tsx#L282-L328)).
- The report is exactly two document surfaces in the rendered DOM and in composition: Decision Narrative followed by Action Plan ([DecisionReportEditor.tsx:875-918](../../components/decision-report/DecisionReportEditor.tsx#L875-L918)).
- The first editor has a clear fixed structure: Background, Problem, Decision, and optional Evidence ([DecisionNarrativeCanvas.tsx:51-85](../../components/decision-report/DecisionNarrativeCanvas.tsx#L51-L85)).
- Core Metrics distinguishes selected metrics from the Primary outcome without an explanatory paragraph ([ActionPlanCanvas.tsx:99-172](../../components/decision-report/ActionPlanCanvas.tsx#L99-L172)).
- Mobile layout avoids horizontal scrolling, and the activation form stacks into a readable single column.
- The previously overlapping **Report complete** sticky bar is absent from the current render. Keep it removed.

## Resolved during review: Report identity changed after reload

Severity before fix: P0 trust failure

Evidence:

- The Northstar fixture now supplies the real demo context `workspaceName: "Orbit"` and `projectName: "Gummy Alpha"` ([northstar-support.ts:52-58](../../lib/decision-reports/fixtures/northstar-support.ts#L52-L58)).
- The generated draft passes those values directly into the editor ([DecisionReportOnboarding.tsx:150-164](../../components/decision-report/DecisionReportOnboarding.tsx#L150-L164)).
- A saved-report reload replaces them with the shared demo scope's project and workspace names ([page.tsx:93-109](../../app/%28onboarding%29/onboarding/page.tsx#L93-L109)).
- Browser verification originally reproduced the change, then confirmed the final active direct link as `Orbit · Gummy Alpha` with zero issue overlays.

Why users will get confused:

Names answer “where am I?” A report that changes projects after autosave looks misfiled, even if its database scope is technically correct. The selected MVP fix keeps Northstar as a named scenario while the report consistently identifies its real Gummy Alpha project.

Options:

1. **Implemented for the MVP: make examples scenarios, not fake project identities.** Keep the real breadcrumb `Orbit · Gummy Alpha` from generation through reload. Northstar remains the named sample scenario, not a database project.
2. **Persist report display context.** Save the generated project label as report metadata and use it for every direct link and report index row. This preserves Northstar but creates a second identity layer inside one shared workspace.
3. **Create real project/workspace fixtures.** Provision Northstar as a genuine project boundary. This is the clean long-term model, but it expands the current single-workspace MVP.

Acceptance signal: generate, autosave, reload, activate, and open Reports. The breadcrumb and report card must use the same project name at every step.

## Resolved during review: The shared toolbar was functionally unreachable

Severity before fix: P0 editing failure

Evidence:

- The toolbar wrapper declares `sticky top-0` ([DecisionReportEditor.tsx:853-873](../../components/decision-report/DecisionReportEditor.tsx#L853-L873)).
- Its parent article previously declared `overflow-hidden`; it now uses `overflow-clip`, which preserves the rounded clipping without becoming the toolbar's scrolling ancestor ([DecisionReportEditor.tsx:819-820](../../components/decision-report/DecisionReportEditor.tsx#L819-L820)).
- Browser measurement originally placed the toolbar at y = 298-334 px while the Action Plan began at y = 1,914 px. The final browser pass scrolled to the last action and measured the sticky toolbar at viewport top `0`.
- The toolbar is the only shared formatting surface for both editors ([DocumentEditorToolbar.tsx:122-220](../../components/decision-report/rich-text/DocumentEditorToolbar.tsx#L122-L220)).

Why users will get confused:

The second editor promises rich editing, so its controls must remain available throughout the long action plan. The overflow-ancestor fix restores that contract on desktop; the mobile toolbar still needs a compact interaction design.

Options:

1. **Implemented: keep one contextual toolbar genuinely pinned to the viewport.** `overflow-clip` removes the wrong scrolling ancestor while preserving the card boundary.
2. **Give each canvas its own toolbar.** One toolbar above Decision and one above Action Plan. This is mechanically clear but duplicates chrome and increases page height.
3. **Use a selection bubble.** Show formatting controls beside selected text. This shortens travel but is less discoverable and harder on touch devices.

Acceptance signal: focus Action 4 at desktop and mobile sizes. Bold, list, link, undo, and redo must remain reachable without leaving the action.

## Major finding 3: Mobile editing has no mobile-specific interaction design

Severity: P1 responsive and accessibility risk

Evidence:

- At 390 px, the single-line title displayed only `Northstar setup` while the saved value remained `Northstar setup assistant rollout`.
- The title is a one-line `<input>` at 28 px rather than a wrapping title surface ([DecisionReportEditor.tsx:831-840](../../components/decision-report/DecisionReportEditor.tsx#L831-L840)).
- The toolbar uses `flex-wrap` with 36 px controls ([DocumentEditorToolbar.tsx:125-159](../../components/decision-report/rich-text/DocumentEditorToolbar.tsx#L125-L159)); it consumed three rows in the rendered mobile view.
- Runtime measurement found a 32 px account button, many 36 px toolbar controls, 32 px priority buttons, and approximately 15 px-high evidence removal controls. The action priority controls explicitly use `min-h-8 min-w-8` ([ActionPlanCanvas.tsx:345-364](../../components/decision-report/ActionPlanCanvas.tsx#L345-L364)), and evidence removal is rendered as small text-only buttons ([DecisionNarrativeCanvas.tsx:129-140](../../components/decision-report/DecisionNarrativeCanvas.tsx#L129-L140)).

Why users will get confused:

The page technically fits the viewport, but “no horizontal scroll” is not the same as a designed mobile editor. The clipped title hides document identity, the toolbar dominates the first screen, and small destructive or formatting controls are easy to miss or mistap.

Options:

1. **Recommended: add a mobile editing mode.** Use an auto-growing title textarea, a single 44 px-high formatting row that scrolls horizontally, and 44 px minimum targets for account, priority, evidence, and remove controls.
2. **Use a compact formatting drawer.** Show one **Format** button and open a bottom sheet for style, list, link, and undo controls. This preserves space but adds one tap.
3. **Make mobile review-first.** Allow text edits and activation, but direct advanced formatting and execution metadata to desktop. This is honest but limits the product promise.

Acceptance signal: at 390 x 844, the full report title is visible, every interactive target is at least 44 x 44 px, and formatting one late action requires no page-scale navigation.

## Major finding 4: The action block has two editing models at once

Severity: P1 comprehension and error risk

Evidence:

- Each action section heading is derived from the title draft, for example `Action 4 · New action` ([ActionPlanCanvas.tsx:455-467](../../components/decision-report/ActionPlanCanvas.tsx#L455-L467)).
- The rich editor then exposes a separate prose body, followed by another title `<input>` and three primary controls ([ActionPlanCanvas.tsx:218-268](../../components/decision-report/ActionPlanCanvas.tsx#L218-L268)).
- Expanding **Action details** adds Owner, Time, Cost, Tags, Skills, priority, and removal inside the same visual document block ([ActionPlanCanvas.tsx:270-378](../../components/decision-report/ActionPlanCanvas.tsx#L270-L378)).
- The rendered fourth action showed `ACTION 4 · NEW ACTION`, `Write here…`, another `New action` field, a metric selector, primary radio, and the full metadata form.

Why users will get confused:

The duplicate title answers the same question twice. The prose is part of the rich editor, while title and metadata behave like a form attached beneath it. Users must infer which text becomes the tracked action and which text is only report prose.

Options:

1. **Recommended: make each action one structured editor block.** Edit the action title directly in the visible section heading, edit the paragraph below it, show metric and primary status as compact inline chips, and move execution metadata into a side sheet or popover.
2. **Keep the embedded form but remove duplication.** Make the section heading static `Action 4`, then keep one labeled Title field and one labeled Summary field. This is less document-like but unambiguous.
3. **Move action setup to a review table.** Keep only action prose in the editor, then map title, owner, metric, and primary status in a compact plan table below. This improves scanning but separates content from configuration.

Acceptance signal: ask a new user to change an action title and explain what will be created after activation. They should choose one control without trial and error.

## Major finding 5: Multi-metric selection cannot be reviewed as a plan

Severity: P1 commitment-quality risk

Evidence:

- Core Metrics supports multiple checked metrics and one Primary outcome ([ActionPlanCanvas.tsx:129-160](../../components/decision-report/ActionPlanCanvas.tsx#L129-L160)).
- Every action has a separate dropdown limited to selected metrics ([ActionPlanCanvas.tsx:237-256](../../components/decision-report/ActionPlanCanvas.tsx#L237-L256)).
- Those dropdowns are distributed through a long editor, so the complete mapping is never visible at once.
- The activation summary collapses the commitment to `4 actions ready`; it does not show selected metrics, the primary outcome, the primary action, or action-to-metric coverage ([ReportActivationPanel.tsx:251-271](../../components/decision-report/ReportActivationPanel.tsx#L251-L271)).

Why users will get confused:

Selecting two metrics feels successful, but there is no scannable answer to “Which action measures what?” Exact database validation does not help a user review intent before making the report immutable.

Options:

1. **Recommended: add a compact activation summary.** Show the Primary outcome, Primary action, resolution date, and one row per action with its Monitoring metric. Label the button **Activate 4 actions**.
2. **Put metric chips in action headings.** A user can scan the document and see `Support Tickets` or `Activation Rate` beside every action. Keep activation compact.
3. **Use a metric-action matrix.** Metrics are columns and actions are rows. This is excellent for many assignments but too heavy for the common three-action plan.

Acceptance signal: with two metrics and four actions, a user should identify every mapping and the primary pair in under ten seconds without opening details.

## Major finding 6: The commitment and payoff arrive too late in the page

Severity: P1 value-loop continuity risk

Evidence:

- Desktop measurement placed activation at y = 3,347 px on a 720 px viewport. Mobile page height reached 5,713 px.
- Activation is rendered outside the report article only after editor readiness passes ([DecisionReportEditor.tsx:921-943](../../components/decision-report/DecisionReportEditor.tsx#L921-L943)).
- The prediction controls introduce direction, percent-of-mean change, and resolution date only at that point ([ReportActivationPanel.tsx:167-250](../../components/decision-report/ReportActivationPanel.tsx#L167-L250)).
- The generated prediction chart appears much earlier in the Action Plan ([ActionPlanCanvas.tsx:492-524](../../components/decision-report/ActionPlanCanvas.tsx#L492-L524)), so the visual promise and the actual commitment are separated.

Why users will get confused:

The page looks finished before the action that makes Causent different appears. Users can spend several minutes refining a document before discovering that they also need to translate its target into a technical percent-of-mean prediction and date.

Options:

1. **Recommended: put a compact Decision commitment inside the second canvas.** Place Primary outcome, target, resolution date, and Primary action after Core Metrics and before the action list. Keep the final activation button at the end, but do not introduce a new concept there.
2. **Add a document outline with a visible Review & activate destination.** This preserves the current structure while making the end state discoverable from the top.
3. **Use a focused final review step.** After the two editors, open a concise commitment sheet. It adds a step but sharply separates editing from immutable activation.

Acceptance signal: before scrolling, a first-time user should know that the report ends in a metric prediction and activation, not just a document.

## Major finding 7: Navigation describes modules instead of the learning loop

Severity: P1 wayfinding risk

Evidence:

- Dashboard navigation is ordered `Data Workshop -> Actions & Decisions -> Impact -> Reports` ([TabStrip.tsx:8-13](../../components/shell/TabStrip.tsx#L8-L13)).
- The observed first-run journey begins with a Decision Report, continues into actions and metric data, and pays off in Impact.
- After activation, the user leaves the document for Actions, while the mature causal chart remains a separate downstream destination.

Why users will get confused:

The browser chrome does not tell the same story as the product. Reports is last even though it is the entry and coordinating artifact. Data is first even though users first need a decision to measure. Impact is visually a peer tab, not the payoff of the loop.

Options:

1. **Recommended: order navigation around the loop:** `Reports -> Actions -> Data -> Impact`. Use one small attention state when the current report needs work in a stage.
2. **Keep the module order and add one next-step CTA.** Each report-native page shows only the next action, such as **Complete primary action**, **Connect outcome data**, or **Review impact**.
3. **Add a compact loop rail:** `Decide -> Execute -> Measure -> Learn`. This makes the model explicit but adds another navigation layer.

Acceptance signal: a user dropped on any dashboard page should identify where they are in the active decision and where the payoff lives without reading instructions.

## Goodwill flow

This is a heuristic design score, not measured customer data.

| Step | Score change | Reason |
|---|---:|---|
| Start | 70 | Neutral starting point |
| Casual challenge prompt | 70 -> 80 | The top task is obvious and examples save work |
| Generated two-canvas report | 80 -> 88 | Strong immediate artifact payoff |
| Rich editing | 88 -> 84 | Sticky toolbar works, but mobile formatting remains dense |
| Four-action setup | 84 -> 74 | Duplicate action title and dense mixed controls require interpretation |
| Direct-link reload | 74 -> 74 | The final tree keeps the real project identity stable |
| Activation | 74 -> 80 | Clear primary button and atomic commitment restore confidence |
| Dashboard handoff | 80 -> 75 | The loop sequence and Impact payoff are not visible in navigation |

Final: **75/100 - promising, with workflow debt**. The largest remaining drains are action-block density and commitment continuity.

## Quick wins

1. Change the activation summary from `4 actions ready` to a compact `Primary outcome · Primary action · 4 actions · 2 metrics` review.
2. Raise toolbar, account, priority, evidence, and removal controls to a 44 px minimum target on mobile.
3. Make the report title wrap on mobile.
4. Show each assigned metric as a chip in the action heading.

## Prioritized design recommendation

1. Remove the duplicate action title and turn each action into one structured editor block.
2. Surface the full commitment before the bottom of the page.
3. Add a compact action-to-metric activation review.
4. Design the sticky toolbar and title for mobile with 44 px targets.
5. Reorder or connect dashboard navigation around `Decide -> Execute -> Measure -> Learn`.

## Review conclusion

The value proposition is visible at the two ends: Causent turns a casual business problem into a credible plan, and Impact can show the later causal payoff. Fixing identity and toolbar reach removes two trust-breaking defects found by the review. The middle still feels like a document editor, a configuration form, and a dashboard joined together; simplifying action blocks and commitment review will make the same functionality feel like one product loop without adding explanatory copy.
