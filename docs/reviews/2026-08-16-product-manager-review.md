# Causent Decision Report — Product Manager Review

Date: 2026-08-16

Scope: current local two-canvas Decision Report, activation, Actions & Decisions, and Impact implementation

Method: source and product-contract review; no customer evidence or production claim

## Founder-selected disposition — 2026-08-16

The findings below are retained as the before-state review. The founder selected the following
responses, which are implemented in the current working tree. The coordinated database, full test,
production build, browser, and release gates for the combined tree are still pending; this table is
an implementation record, not verification or customer evidence.

| Finding | Selected response | Current implementation |
| --- | --- | --- |
| Product flow | Option 1 | One sticky lifecycle footer now advances through **Finish report**, **Set commitment**, and **Start an action**. It focuses the next missing report or commitment input and never creates canonical state itself. |
| Trust and conversion | Option 1 | The Action Plan chart is driven by the current primary metric and activation draft. It updates the signed commitment immediately and uses the connected baseline when available. |
| Value-loop continuity | Option 1 | Report-native Actions now keeps a compact outcome-commitment header above the action list with the metric, signed prediction, native baseline/target when available, resolution date, registered primary action, execution state, and direct Data/Impact links. |
| Discoverability | Deferred as already addressed | This round preserves the founder-selected global order **Data -> Reports -> Actions -> Impact**. It does not add another loop strip or state-dot system. |
| Plan quality | Option 1 | The Action Plan keeps all suggested actions included by default and shows one always-visible review row per action and assigned metric, with the primary outcome/action summarized above it. The action-level **Start** is the sole activation gesture and activates the complete reviewed action count. |

Primary source: `lib/decision-reports/product-continuity.ts`,
`components/decision-report/DecisionReportEditor.tsx`,
`components/decision-report/ActionPlanCanvas.tsx`,
`components/decision-report/PredictedImpactChart.tsx`, and
`components/actions/DecisionDetail.tsx`.

## Executive verdict

The product now contains the complete conceptual loop:

`business challenge -> editable decision -> action plan -> metric and prediction commitment -> tracked work -> causal outcome`

The two-canvas editor is a meaningful improvement. It turns the report into one decision document and one execution document, keeps evidence optional, includes generated actions by default, and lets the user add actions and assign metrics. The first-session artifact and the eventual Impact payoff both exist.

The loop is not yet clear enough without coaching. The previous false **Report complete** finish line was removed during this review, but editing readiness and activation still appear as two separated surfaces: the document ends, then a prediction panel begins below it. A second break occurs immediately after activation: Causent redirects to Actions & Decisions, but report-native Actions hides the prediction being tracked. The user therefore moves from a strong document to a task list before the product has reinforced the central promise: *what we decided, what we expect to change, and when we will know*.

## What is working

- The opening question is casual and problem-first. It asks for a business challenge and promises refinement, measurement, and tracking without demanding a structured brief ([DecisionReportOnboarding.tsx:223-256](../../components/decision-report/DecisionReportOnboarding.tsx#L223-L256)).
- The generated result is exactly two document surfaces: Decision and Action Plan ([DecisionReportEditor.tsx:851-918](../../components/decision-report/DecisionReportEditor.tsx#L851-L918)).
- Background, Problem, Decision, and optional Evidence are kept inside the first canvas ([DecisionNarrativeCanvas.tsx:51-85](../../components/decision-report/DecisionNarrativeCanvas.tsx#L51-L85)).
- The second canvas keeps the action-plan summary, Core Metrics, and action sections in one document; all current actions are included by default and a new action can be added ([ActionPlanCanvas.tsx:439-529](../../components/decision-report/ActionPlanCanvas.tsx#L439-L529), [DecisionReportEditor.tsx:154-175](../../components/decision-report/DecisionReportEditor.tsx#L154-L175)).
- Activation is atomic and ends at tracked work, then Impact has a real plan-versus-outcome destination ([ReportActivationPanel.tsx:132-164](../../components/decision-report/ReportActivationPanel.tsx#L132-L164), [ReportImpactOverview.tsx:82-132](../../components/impact/ReportImpactOverview.tsx#L82-L132)).

## Current value-loop read

| Stage | Current surface | Is the user payoff clear? |
|---|---|---|
| Challenge | One casual onboarding prompt with optional URL/PDF evidence | Yes |
| Refine | Decision canvas with required gaps highlighted | Mostly |
| Plan | Action Plan canvas with metrics and actions | Mostly, but control density rises quickly |
| Commit | Prediction/activation panel below the report | Partly; the false completion state is gone, but it still reads like a second workflow |
| Execute | Actions & Decisions | Partly; actions are clear, prediction context disappears |
| Measure | Data Workshop and recompute state | Partly; next required measurement action is not carried through the journey |
| Learn | Impact plan/outcome and causal readout | Yes once populated, but too detached from the earlier commitment |

## Major finding 1 — Readiness and activation still use separate lifecycle surfaces

Severity: P1 product-flow risk

Evidence:

- The required-field footer now disappears when report readiness passes; it no longer claims the overall job is complete ([DecisionReportEditor.tsx:969-1022](../../components/decision-report/DecisionReportEditor.tsx#L969-L1022)).
- A separate `ReportActivationPanel` still appears after the entire report ([DecisionReportEditor.tsx:921-941](../../components/decision-report/DecisionReportEditor.tsx#L921-L941)).
- That panel introduces another job, **Set the prediction**, before the user can activate ([ReportActivationPanel.tsx:167-193](../../components/decision-report/ReportActivationPanel.tsx#L167-L193)).

Why users will get confused:

The misleading completion claim is fixed, but the transition remains spatial rather than procedural. The differentiated Causent artifact is not merely a report; it is a pre-registered decision, prediction, action, and measurement commitment. When the prediction panel appears only after a long document, activation can still feel like administration instead of the culmination of the report.

Options:

1. **Recommended — one lifecycle footer.** Let one footer progress through `Finish report -> Set prediction -> Activate`. When the document is ready, its primary CTA scrolls to or expands the prediction controls. Keep one persistent status surface rather than a separate transition.
2. **Embed commitment in canvas two.** Put direction, target, and review date directly after the primary outcome metric and primary action. The bottom CTA becomes the only activation boundary.
3. **Use an explicit review sheet.** After editing, open a compact final review containing the outcome metric, prediction, primary action, action count, and resolution date. This is clearest but adds a modal/step that may feel heavier than the two-document interaction.

Acceptance signal: in an unassisted test, a user who sees “ready” should correctly predict the next action and explain what activation creates.

## Major finding 2 — The visible prediction can diverge from the commitment

Severity: P0 trust and conversion risk

Evidence:

- The Action Plan displays `PredictedImpactChart` from the generation-time `projection` before the metric/action controls ([ActionPlanCanvas.tsx:516-528](../../components/decision-report/ActionPlanCanvas.tsx#L516-L528)).
- That chart reads fixed `baselinePct` and `predictedPct` values and presents their difference in percentage points ([PredictedImpactChart.tsx:14-29](../../components/decision-report/PredictedImpactChart.tsx#L14-L29), [PredictedImpactChart.tsx:42-60](../../components/decision-report/PredictedImpactChart.tsx#L42-L60)).
- The actual activation commitment is edited later through separate direction, percent-of-mean magnitude, and date inputs ([ReportActivationPanel.tsx:190-249](../../components/decision-report/ReportActivationPanel.tsx#L190-L249)).
- Changing the outcome metric updates the activation draft, not the generation-time projection passed to the chart ([DecisionReportEditor.tsx:419-453](../../components/decision-report/DecisionReportEditor.tsx#L419-L453)).

Why users will get confused:

The chart looks authoritative and current, but it may represent an earlier proposed metric or target. A user can choose another outcome metric or edit the prediction and still see the old graph. That makes the most persuasive visual in the editor an unreliable summary of the decision they are about to activate.

Options:

1. **Recommended — make the chart live.** Drive it from the currently selected primary metric and the current activation draft. Show the connected baseline when available, derive the target from the entered commitment, and update immediately.
2. **Hide until commitment exists.** Replace the chart with a compact empty state until the user chooses an outcome metric and enters a prediction. This is safest and simplest, but delays the visual payoff.
3. **Separate proposal from commitment.** Keep the generated projection, label it **Suggested from your brief**, and show a second **Your commitment** view. This can surface useful disagreement but adds conceptual weight.

Acceptance signal: after changing the primary metric or prediction magnitude, every visible plan number and chart should agree without reload.

## Major finding 3 — The activation destination drops the prediction context

Severity: P1 value-loop continuity risk

Evidence:

- Successful activation sends the user directly to Actions & Decisions ([ReportActivationPanel.tsx:138-160](../../components/decision-report/ReportActivationPanel.tsx#L138-L160)).
- Report-native Actions renders the report summary, history, and action rows ([DecisionDetail.tsx:515-555](../../components/actions/DecisionDetail.tsx#L515-L555)).
- The prediction and resolution card is explicitly rendered only when `!report`, so it is omitted for the report-native path ([DecisionDetail.tsx:594-623](../../components/actions/DecisionDetail.tsx#L594-L623)).

Why users will get confused:

The prediction is the bridge between the decision and future causal learning. Hiding it on the first post-activation screen reduces Causent to an action tracker at the exact moment the product should reinforce its differentiated promise. Users can see each action’s assigned metric, but not the single team commitment tying the plan together.

Options:

1. **Recommended — add a compact commitment header to report-native Actions.** Show outcome metric, signed prediction, resolution date, primary action, and current state above the action list. Link the outcome to Impact and data readiness.
2. **Redirect to a decision overview.** Land on a dedicated report/decision summary containing the commitment and next step, with Actions and Impact as subordinate links.
3. **Redirect to Impact.** Land on the plan view of Impact immediately after activation, then offer **Start executing actions**. This emphasizes payoff but may feel premature before work begins.

Acceptance signal: immediately after activation, a user should be able to answer “What did we predict, for which metric, by when, and which action carries it?” without navigating elsewhere.

## Major finding 4 — The global navigation presents product modules, not the causal loop

Severity: P1 discoverability risk

Evidence:

- The global order is `Data Workshop -> Actions & Decisions -> Impact -> Reports` ([TabStrip.tsx:8-13](../../components/shell/TabStrip.tsx#L8-L13)).
- The actual first-run contract is challenge/report first, followed by metric confirmation and activation ([DecisionReportOnboarding.tsx:231-256](../../components/decision-report/DecisionReportOnboarding.tsx#L231-L256), [ai-assisted-decision-report.md:433-444](../designs/ai-assisted-decision-report.md#L433-L444)).
- The product design says Impact is the future measurement destination, not the first step ([ai-assisted-decision-report.md:484-492](../designs/ai-assisted-decision-report.md#L484-L492)).

Why users will get confused:

The navigation is organized by internal capability rather than by the job the user is doing. A first-time user scanning left to right sees data before deciding and Reports last, even though the Decision Report is the product’s entry and coordinating object. Nothing in the chrome shows whether the current decision needs action completion, metric data, recomputation, or outcome review.

Options:

1. **Recommended — order the tabs around the loop:** `Reports -> Actions -> Data -> Impact`. Add a subtle state dot only when a stage requires attention; avoid explanatory copy.
2. **Keep module order but add one stage-aware next CTA.** Each current-report screen exposes one clear next action, such as **Complete primary action**, **Connect outcome data**, or **Review outcome**.
3. **Add a compact loop strip.** Show `Decide -> Execute -> Measure -> Learn` under the project header, with the current stage highlighted. This is clearest for review but adds another navigation layer.

Acceptance signal: a first-time user should predict the product sequence from the navigation alone and should always have one obvious next step.

## Major finding 5 — Default-included actions need a clearer final commitment boundary

Severity: P1 plan-quality risk

Evidence:

- Before activation, every report action is automatically included ([DecisionReportEditor.tsx:154-175](../../components/decision-report/DecisionReportEditor.tsx#L154-L175)).
- Removing an action is inside collapsed **Action details**, not visible at the row’s primary level ([ActionPlanCanvas.tsx:275-383](../../components/decision-report/ActionPlanCanvas.tsx#L275-L383)).
- The activation panel summarizes only the count as “N actions ready” and sends the complete set ([ReportActivationPanel.tsx:252-270](../../components/decision-report/ReportActivationPanel.tsx#L252-L270)).

Why users will get confused:

Default inclusion is the correct low-friction behavior requested for this iteration, but generated suggestions become canonical tracked actions unless the user notices a removal control hidden in details. With several actions, there is no compact final view of action, owner, assigned metric, and primary status before activation.

Options:

1. **Recommended — add a compact activation summary.** Keep all actions included by default, but show an always-visible one-line summary per action in the activation area and label the button **Activate N actions**.
2. **Expose inclusion at row level.** Add an **Included** checkbox/chip to each action, selected by default. This is explicit but introduces another control into an already dense row.
3. **Use a final confirmation sheet.** List the actions and assignments only after the user clicks Activate. This keeps the editor clean but adds one click.

Acceptance signal: before confirming, users should correctly identify how many actions will be created and which one is primary.

## Prioritized product recommendation

1. Unify readiness, prediction, and activation into one lifecycle footer.
2. Make the prediction visualization derive from the current commitment.
3. Keep the prediction visible on report-native Actions.
4. Carry one stage-aware next action across Actions, Data, and Impact.
5. Add a compact activation summary for all default-included actions.

## Review conclusion

The product value loop is **credible but not yet self-evident**. The report creation payoff is clear, and the completed Impact screen is strong. Removing the false completion bar fixes the most misleading signal; the middle still reads as a document, a separate activation form, and then a task list. Closing those continuity gaps should be higher priority than adding more explanatory copy or more dashboard modules.
