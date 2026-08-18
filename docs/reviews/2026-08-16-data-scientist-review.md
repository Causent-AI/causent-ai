# Causent Decision Report — Data Scientist Review

Date: 2026-08-16

Scope: current local multi-metric Decision Report contract, materialization, dashboard read model, and causal-impact presentation

Method: source and statistical-contract review; no new model run, data audit, or production claim

## Founder-selected disposition — 2026-08-16

The findings below are retained as the before-state review. The selected contracts are implemented
in the current working tree, but the coordinated reset, integration/RLS, full engine, production
build, and browser gates have not yet completed for this combined source. Nothing here is a new
causal result or partner result.

| Finding | Selected response | Current implementation |
| --- | --- | --- |
| Scientific meaning and data integrity | Option 1 | Current-report readers load selected metrics and action assignments directly from `decision_report_activation_metrics` and `decision_report_activation_action_metrics`. A malformed or incomplete normalized contract fails closed instead of falling back to action rationale metadata. |
| Prediction interpretation and calibration | Option 2 | Percent-of-mean remains the immutable commitment unit. The editor and downstream commitment views calculate and show the observed baseline plus the implied target in the metric's native unit; no second prediction is created. |
| Expectation management | Option 1 | The checked metric catalog reports unit, latest observation, observation count, history days, earliest confident review date, percent scale, and one of **Ready to monitor**, **Needs data**, or **Causal window not ready**. Readiness is descriptive and does not silently lower or bypass the 45-day-per-side ITS floor. |
| Causal attribution | Modified option 1 | The registered primary action and primary outcome remain the pre-registered commitment. For a multi-action activation, Causent does not establish an intervention until every included action is complete; the last completed included action becomes the package intervention action/date. Recompute then measures the whole **Decision package**, preserves all action markers, and makes no individual-action attribution claim. |
| Learning quality | Option 1 | Supporting action bindings are explicitly monitoring context and may carry an optional expected direction and check date. Those values are stored with the normalized immutable binding and are never scored as additional causal predictions. |

Primary source: `lib/data/decision-report-activation-contract.ts`,
`lib/decision-reports/prediction-calibration.ts`,
`components/decision-report/ActionPlanCanvas.tsx`, and
`supabase/migrations/20260817055407_decision_report_scientific_contracts.sql`.

## Executive verdict

The core scientific boundary is directionally sound: one human pre-registered prediction targets one primary outcome metric; one primary action anchors the intervention; causal belief comes only from the checked ITS path; supporting actions and secondary metrics do not automatically receive causal credit. The implementation also preserves the essential distinction between a prediction and a later measurement.

The multi-metric planning contract now survives the downstream read model. Causent records up to five selected metrics and one metric assignment per action; Actions and Impact both retain those exact bindings while the causal estimate remains restricted to the primary action and primary outcome. This is the correct scientific boundary: a multi-metric execution plan is not presented as a multi-outcome experiment.

The highest-priority remaining change is not “run more causal models.” It is to make the existing contract legible and numerically consistent everywhere:

- **Primary outcome metric:** the one metric with the team prediction and eligible causal readout.
- **Primary action:** the intervention anchor tied to that outcome.
- **Monitoring metric:** a metric attached to a supporting action for execution tracking, not an independent causal target.

## Implemented statistical contract

| Object | Current meaning | Assessment |
|---|---|---|
| Selected metrics | 1–5 metrics can be retained with the activation | Useful plan context |
| Primary outcome | `confirmedMetricId`, which must be in the selected set | Correct single causal target |
| Action metric assignment | Exactly one selected metric per activated action | Useful traceability, not yet a hypothesis |
| Primary action | Must be assigned to the primary outcome | Correct attribution invariant |
| Prediction | One direction, percent-of-mean magnitude, and resolution date | Methodologically coherent but hard to enter/interpret |
| Recompute | Enqueued only for the primary outcome | Honest current engine boundary |
| Supporting actions | No independent causal estimate | Correct unless the UI implies otherwise |

The activation validator enforces the selected-metric and action-binding invariants ([activation.ts:177-197](../../lib/decision-reports/activation.ts#L177-L197), [activation.ts:229-285](../../lib/decision-reports/activation.ts#L229-L285)). Materialization writes a single prediction against the primary outcome ([20260817012313_decision_report_multi_metric_activation.sql:760-780](../../supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql#L760-L780)) and creates the lever and recompute request only for the primary action/outcome pair ([20260817012313_decision_report_multi_metric_activation.sql:945-988](../../supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql#L945-L988)). That is the correct boundary to preserve for this MVP.

## Resolved during review — secondary metric assignments retain their meaning downstream

Severity before fix: D0 scientific-meaning and data-integrity risk

Evidence:

- The database stores selected activation metrics and normalized action-to-metric bindings ([20260817012313_decision_report_multi_metric_activation.sql:32-81](../../supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql#L32-L81), [20260817012313_decision_report_multi_metric_activation.sql:905-938](../../supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql#L905-L938)).
- The current-report selector now retains the primary outcome first and only the registered metrics needed by the isolated report actions; aggregate causal impact still receives only the primary outcome ([report-project-view.ts:111-137](../../lib/data/report-project-view.ts#L111-L137)).
- Action rendering reconstructs each assignment from a denormalized metric name in `rationale_richtext`, not from the normalized activation binding ([actions.ts:86-108](../../lib/data/actions.ts#L86-L108)).
- Impact resolves each support action's assigned metric for display, labels it **Monitoring metric**, labels the primary pair **Outcome metric**, and fails closed as **Metric unavailable** if an ID cannot be resolved ([report-impact.ts:133-180](../../lib/impact/report-impact.ts#L133-L180), [ReportImpactOverview.tsx:176-191](../../components/impact/ReportImpactOverview.tsx#L176-L191)).

Why this matters:

Before the fix, an action assigned to **Support Tickets** could appear under **Activation Rate** in Impact. Browser acceptance reproduced that mismatch and then verified the correction across four actions: support actions show their exact monitoring metric, while only the primary action shows the outcome metric. The remaining denormalized action metadata is compatible with existing readers but should eventually be replaced by a direct normalized join.

Longer-term options:

1. **Recommended — join the normalized activation contract directly.** Load selected metrics and action bindings into the dashboard repository rather than continuing to use the canonical action's compatibility metadata. Keep the current display labels and primary-only causal estimate.
2. **Keep Impact single-metric.** Continue to show only the primary outcome on Impact, but remove support-action “metric link” rows from that surface. Show action monitoring metrics only in Actions and Core Metrics with a clear non-causal badge.
3. **Expand to multiple causal targets later.** Add one prediction, intervention definition, resolution window, and multiple-testing family per action/metric pair. This is a materially larger contract and should not be inferred from the current dropdown.

Recommended acceptance test: assign three actions to three different metrics, activate, reload, and verify the exact bindings in Reports, Actions, Data Workshop, and Impact. Only the primary pair should expose a causal state.

## Major finding 2 — The plan chart and the committed prediction use different data and units

Severity: D0 interpretation and calibration risk

Evidence:

- The editor’s plan chart is driven by a fixed `MetricProjection` containing a metric name plus 0–100 baseline and predicted percentages ([schema.ts:255-263](../../lib/decision-reports/schema.ts#L255-L263)).
- The chart displays the absolute difference as percentage points ([PredictedImpactChart.tsx:14-29](../../components/decision-report/PredictedImpactChart.tsx#L14-L29), [PredictedImpactChart.tsx:53-60](../../components/decision-report/PredictedImpactChart.tsx#L53-L60)).
- The activation commitment instead asks for a signed **percent of mean** using separate direction and positive magnitude controls ([ReportActivationPanel.tsx:195-224](../../components/decision-report/ReportActivationPanel.tsx#L195-L224)).
- The plan chart receives only the original projection, even after the user changes the primary metric or committed magnitude ([ActionPlanCanvas.tsx:516-519](../../components/decision-report/ActionPlanCanvas.tsx#L516-L519), [DecisionReportEditor.tsx:419-470](../../components/decision-report/DecisionReportEditor.tsx#L419-L470)).

Why this matters:

For a percentage metric, moving from 40% to 55% is both **+15 percentage points** and **+37.5% of the baseline mean**. Those are not interchangeable labels. For currency or count metrics, a 0–100 percentage projection is not a native target at all. A stale chart can therefore disagree with the exact prediction that the engine later scores.

Options:

1. **Recommended — let users enter a native target and derive the model unit.** Show `current baseline -> target` in the metric’s real unit, calculate the signed percent-of-mean commitment for storage/scoring, and display both values in the review summary.
2. **Retain percent-of-mean but add an inline calculator.** Once a metric is selected, show its baseline and the implied native target while the user edits magnitude. This preserves the existing schema but makes the unit understandable.
3. **Use direction plus target only for percentage metrics.** Keep percent-of-mean for count/currency metrics. This is friendlier but creates metric-type-dependent activation behavior.

Recommended acceptance test: use a percentage, count, and currency metric; change both the primary metric and prediction; confirm the editor chart, activation payload, Actions header, and Impact chart all describe the same commitment.

## Major finding 3 — Metric choice exposes no measurement readiness

Severity: D1 expectation-management risk

Evidence:

- The metric repository already returns source, unit, `hasObservations`, and Core Metric status ([materialization.ts:9-16](../../lib/decision-reports/materialization.ts#L9-L16), [materialization.ts:83-108](../../lib/decision-reports/materialization.ts#L83-L108)).
- The selection UI displays only the metric name, a checkbox, and an **Outcome** radio ([ActionPlanCanvas.tsx:99-171](../../components/decision-report/ActionPlanCanvas.tsx#L99-L171)).
- Database activation validates workspace membership and daily granularity, but not observation count or usable pre/post coverage ([20260817012313_decision_report_multi_metric_activation.sql:570-585](../../supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql#L570-L585)).
- The causal contract requires at least 45 days on each side for a confident readout and distinguishes insufficient history from no effect ([decision-graph.md:138-171](../designs/decision-graph.md#L138-L171)).

Why this matters:

A metric with zero observations looks equivalent to a mature daily series. Activation should remain possible so Causent can prospectively collect data, but the user should not infer that selecting a metric makes it measurable or that the chosen resolution date can produce a confident causal result.

Options:

1. **Recommended — show concise readiness states in the selector.** For each metric show unit, last observation, available pre-history, and one of `Ready to monitor`, `Needs data`, or `Causal window not ready`. Keep activation allowed and estimate the earliest confident review date.
2. **Separate outcome candidates from monitoring-only metrics.** Metrics without sufficient pre-history can still be selected for monitoring but cannot be chosen as the primary causal outcome without an explicit acknowledgement.
3. **Route through a measurement check.** Choosing an unready outcome opens a focused Data Workshop step before returning to the report. This is rigorous but adds flow friction.

Recommended acceptance test: activate once with no observations, once with 30 days, and once with 90+ days; the UI should forecast the measurement state without calling any of them zero effect.

## Major finding 4 — A multi-action plan is treated as one-action attribution

Severity: D1 causal-attribution risk

Evidence:

- All report actions are included by default before activation ([DecisionReportEditor.tsx:154-175](../../components/decision-report/DecisionReportEditor.tsx#L154-L175)).
- The outcome timeline draws completion markers for every report action while emphasizing one primary action ([ReportImpactTimeline.tsx:150-183](../../components/charts/ReportImpactTimeline.tsx#L150-L183)).
- The UI correctly says timing markers are descriptive and only the checked ITS estimate is causal ([ReportImpactTimeline.tsx:270-272](../../components/charts/ReportImpactTimeline.tsx#L270-L272)).
- Impact nevertheless reserves the causal estimate for the primary action and describes supporting actions as not independently estimated ([ReportImpactOverview.tsx:134-140](../../components/impact/ReportImpactOverview.tsx#L134-L140), [report-impact.ts:161-170](../../lib/impact/report-impact.ts#L161-L170)).
- The underlying graph design already recognizes co-occurring actions as a collision/cluster problem ([decision-graph.md:118-133](../designs/decision-graph.md#L118-L133)).

Why this matters:

If the primary action and two support actions complete within the same intervention window, an interrupted time series can estimate a change around that window, but it cannot identify which member of the package caused it without additional variation or controls. Calling the readout an estimate for the primary action is stronger than the design supports in that scenario.

Options:

1. **Recommended — estimate the decision package when actions collide.** Keep the primary action as the pre-registered intervention anchor, but label the measured result **Decision package estimate** whenever supporting actions fall inside the collision window. Preserve every action marker and state that individual attribution is unavailable.
2. **Use the existing cluster model.** Materialize a cluster for co-occurring report actions and attach the authoritative edge to that cluster. This is statistically cleaner but expands recompute/materialization behavior.
3. **Require staggered interventions for action-level claims.** Allow a primary-action estimate only if no other plan action falls within the exclusion window. This is rigorous but often unrealistic for product launches.

Recommended acceptance test: complete support actions on the same day, nearby days, and far outside the primary window; verify the label changes from package-level to primary-action-level only when the design can support it.

## Major finding 5 — An action-to-metric binding is not yet a monitoring hypothesis

Severity: D1 learning-quality risk

Evidence:

- `DraftAction` stores only an optional metric ID alongside execution text; it has no expected direction, baseline, review date, or mechanism field for that action-metric pair ([schema.ts:150-163](../../lib/decision-reports/schema.ts#L150-L163)).
- `ReportActivationInputV2` likewise sends the one report-level prediction plus bare action/metric assignments ([activation.ts:22-36](../../lib/decision-reports/activation.ts#L22-L36)).
- Only the primary outcome receives a prediction row ([20260817012313_decision_report_multi_metric_activation.sql:760-780](../../supabase/migrations/20260817012313_decision_report_multi_metric_activation.sql#L760-L780)).

Why this matters:

Assigning **Support Tickets** to an action does not say whether tickets should rise or fall, when to evaluate them, or why the action should move them. Without those semantics, the assignment is useful as an operational tag but weak as accumulated decision memory. The UI must not make it look like an unregistered secondary prediction.

Options:

1. **Recommended — explicitly call it a Monitoring Metric.** Keep the current lightweight binding and add a short optional expected-direction/check-date pair. Store it as plan context, not a causal prediction, and never score it as one.
2. **Require a one-sentence monitoring hypothesis.** “We expect this action to decrease Support Tickets because …” gives richer learning but adds editing effort to every action.
3. **Leave the contract unchanged and narrow the promise.** Treat assigned metrics as tags used to filter execution work; remove outcome language from supporting action rows.

Recommended acceptance test: ask a user to explain the difference between the primary outcome and an action’s monitoring metric. They should not expect both to receive causal verdicts.

## Scientifically honest elements to preserve

- One human commitment is distinct from the later engine estimate.
- The primary action must use the primary outcome metric.
- Insufficient history remains unknown, never zero effect.
- Supporting actions do not receive invented individual causal estimates.
- The timeline explicitly distinguishes observed timing from causal attribution.
- Exact activation retries and immutable activated reports protect pre-registration integrity.

## Prioritized data-science recommendation

1. Make the editor chart use the live commitment and one unambiguous unit system.
2. Add data-readiness states without blocking prospective activation.
3. Join normalized activation bindings directly in the dashboard repository when the read model is hardened.
4. Treat co-occurring actions as a decision package or cluster rather than claiming isolated primary-action attribution.
5. Add lightweight monitoring hypotheses only after the labels above are stable.

## Review conclusion

The primary causal loop is **methodologically plausible and bounded**. The multi-metric layer is correctly a planning feature, not a multi-outcome causal system: one causal outcome is paired with clearly marked per-action monitoring metrics. The largest remaining scientific UX risks are the stale/mixed-unit plan chart, invisible data readiness, and over-attribution when several plan actions land in one intervention window.
