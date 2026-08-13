import assert from "node:assert/strict";
import test from "node:test";
import type { Action, Decision, Metric } from "../types.ts";
import type { DashboardDecisionReport } from "./decision-reports.ts";
import { selectReportProjectView } from "./report-project-view.ts";
import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "../decision-reports/fixtures/gummy-alpha.ts";

const action = (id: string, impact: Action["impact"] = []): Action => ({
  id, pr: 0, title: id, shippedAt: null, primaryMetricId: "completion", impact,
});
const decision = (
  id: string,
  actionIds: string[],
  leverActionId: string | null = null,
): Decision => ({
  id, origin: id === "report-decision" ? "decision_report" : "legacy", title: id,
  createdAt: "2026-07-22", rationale: { body: [] }, actionIds,
  leverActionId, predictions: [],
});
const metric = (id: string): Metric => ({
  id, name: id, color: "#000", format: "percent", source: "CSV", cadence: "Daily",
  lastUpdated: "2026-07-22T00:00:00Z", rows: 0, higherIsBetter: true, series: [],
});

function report(): DashboardDecisionReport {
  return {
    id: "report", revisionId: "revision", title: "Report", status: "active",
    updatedAt: "2026-07-22T00:00:00Z", report: GUMMY_ALPHA_GOLDEN_EXAMPLE.report,
    metricProjection: GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    decisionId: "report-decision", predictionId: "prediction", metricId: "metric-uuid",
    seriesId: "series", iterationNumber: 1, predecessorReportId: null,
    iterationReason: null, isCurrent: true,
  };
}

test("explicit current pointer wins over report order and timestamps", () => {
  const historical = { ...report(), id: "historical", isCurrent: false, updatedAt: "2099-01-01T00:00:00Z", decisionId: "old" };
  const current = { ...report(), id: "current", updatedAt: "2020-01-01T00:00:00Z" };
  const view = selectReportProjectView({
    reports: [historical, current], actions: [action("report-action")],
    decisions: [decision("report-decision", ["report-action"]), decision("old", [])],
    metrics: [metric("completion")], metricUiIdByDbId: new Map([["metric-uuid", "completion"]]),
    aggregatedImpact: [], impactByMetric: [],
  });
  assert.equal(view.activeReport?.id, "current");
});

test("an active report isolates every dashboard dataset to its project", () => {
  const view = selectReportProjectView({
    reports: [report()],
    actions: [action("report-action"), action("legacy-action")],
    decisions: [decision("report-decision", ["report-action"]), decision("legacy", ["legacy-action"])],
    metrics: [metric("completion"), metric("arr")],
    metricUiIdByDbId: new Map([["metric-uuid", "completion"]]),
    aggregatedImpact: [{ label: "Improvement Rate", value: "50%", comparison: "legacy", tone: "positive" }],
    impactByMetric: [
      { metricId: "completion", value: 0, label: "—", direction: "neutral", good: true },
      { metricId: "arr", value: 10, label: "+10", direction: "up", good: true },
    ],
  });

  assert.equal(view.activeReport?.id, "report");
  assert.deepEqual(view.decisions.map((item) => item.id), ["report-decision"]);
  assert.deepEqual(view.actions.map((item) => item.id), ["report-action"]);
  assert.deepEqual(view.metrics.map((item) => item.id), ["completion"]);
  assert.deepEqual(view.impactByMetric.map((item) => item.metricId), ["completion"]);
  assert.equal(view.aggregatedImpact[0].value, "—");
});

test("current report impact uses only the primary lever's causal cell", () => {
  const current = action("report-action", [
    {
      metricId: "completion", direction: "up", value: 3,
      label: "+3.0pp", good: true, evidence: "causal",
    },
  ]);
  const descriptive = action("report-descriptive", [
    {
      metricId: "completion", direction: "down", value: -50,
      label: "-50.0pp", good: false, evidence: "descriptive",
    },
  ]);
  const supportWithCausalCell = action("report-support", [
    {
      metricId: "completion", direction: "up", value: 40,
      label: "+40.0pp", good: true, evidence: "causal",
    },
  ]);
  const unrelated = action("legacy-action", [
    {
      metricId: "completion", direction: "down", value: -100,
      label: "-100.0pp", good: false, evidence: "causal",
    },
  ]);
  const view = selectReportProjectView({
    reports: [report()],
    actions: [current, descriptive, supportWithCausalCell, unrelated],
    decisions: [
      decision(
        "report-decision",
        [current.id, descriptive.id, supportWithCausalCell.id],
        current.id,
      ),
      decision("legacy", [unrelated.id]),
    ],
    metrics: [metric("completion")],
    metricUiIdByDbId: new Map([["metric-uuid", "completion"]]),
    aggregatedImpact: [{ label: "Improvement Rate", value: "0%", comparison: "workspace", tone: "negative" }],
    impactByMetric: [{ metricId: "completion", value: -147, label: "-147.0pp", direction: "down", good: false }],
  });

  assert.deepEqual(
    view.actions.map((item) => item.id),
    [current.id, descriptive.id, supportWithCausalCell.id],
  );
  assert.deepEqual(view.impactByMetric, [{
    metricId: "completion", value: 3, label: "+3.0pp", direction: "up", good: true,
  }]);
  assert.deepEqual(view.aggregatedImpact, [{
    label: "Improvement Rate", value: "100%",
    comparison: "1 / 1 confident readouts for this report", tone: "positive",
  }]);
});

test("legacy workspaces retain their complete dashboard payload", () => {
  const actions = [action("legacy-action")];
  const decisions = [decision("legacy", ["legacy-action"])];
  const metrics = [metric("arr")];
  const view = selectReportProjectView({
    reports: [], actions, decisions, metrics, metricUiIdByDbId: new Map(),
    aggregatedImpact: [], impactByMetric: [],
  });
  assert.equal(view.activeReport, null);
  assert.equal(view.actions, actions);
  assert.equal(view.decisions, decisions);
  assert.equal(view.metrics, metrics);
});

test("orphaned report-native graph rows do not leak through legacy fallback", () => {
  const legacyAction = action("legacy-action");
  const removedReportAction = action("removed-report-action");
  const legacyDecision = decision("legacy", [legacyAction.id]);
  const removedReportDecision = decision("report-decision", [removedReportAction.id]);
  const view = selectReportProjectView({
    reports: [],
    actions: [removedReportAction, legacyAction],
    decisions: [removedReportDecision, legacyDecision],
    metrics: [metric("arr")],
    metricUiIdByDbId: new Map(),
    aggregatedImpact: [],
    impactByMetric: [],
  });
  assert.deepEqual(view.decisions.map((item) => item.id), ["legacy"]);
  assert.deepEqual(view.actions.map((item) => item.id), ["legacy-action"]);
});
