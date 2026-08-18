import assert from "node:assert/strict";
import test from "node:test";

import type { MetricProjection } from "../decision-reports/schema.ts";
import type { Action, Decision, Metric, Prediction } from "../types.ts";
import {
  buildReportImpactViewModel,
  buildCommittedPredictionTimelineLevels,
  buildReportTimelineLevels,
  formatReportMetricLevel,
} from "./report-impact.ts";

const metric: Metric = {
  id: "adoption",
  name: "Adoption Rate",
  color: "#00A29C",
  format: "percent",
  source: "CSV",
  cadence: "Daily",
  lastUpdated: "2026-07-31T00:00:00.000Z",
  rows: 3,
  higherIsBetter: true,
  series: [
    { date: "2026-04-01", value: 0.4 },
    { date: "2026-06-15", value: 0.55 },
    { date: "2026-07-31", value: 0.56 },
  ],
};

const monitoringMetric: Metric = {
  ...metric,
  id: "support",
  name: "Support Tickets",
  format: "count",
  higherIsBetter: false,
};

const projection: MetricProjection = {
  metricName: "Adoption Rate",
  definition: "Share of eligible users who activate.",
  baselinePct: 40,
  predictedPct: 55,
  baselineLabel: "40% baseline",
  predictionLabel: "55% target",
  evidenceState: "prompt_supplied",
};

function action(
  id: string,
  displayCode: string,
  shippedAt: string | null,
  impact: Action["impact"] = [],
  primaryMetricId = metric.id,
): Action {
  return {
    id,
    displayCode,
    pr: 0,
    source: "manual",
    title: `Action ${displayCode}`,
    shippedAt,
    primaryMetricId,
    impact,
  };
}

function prediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: "prediction",
    metricId: metric.id,
    direction: "POSITIVE",
    magnitudePctMean: 37.5,
    resolutionDate: "2026-07-31",
    committedAt: "2026-04-01",
    verdict: "CONFIRMED",
    resolvedAt: "2026-07-31",
    measuredPct: 36.990388,
    revisions: [],
    ...overrides,
  };
}

function decision(predictions: Prediction[] = [prediction()]): Decision {
  return {
    id: "decision",
    title: "Increase product adoption",
    origin: "decision_report",
    createdAt: "2026-04-01",
    rationale: { body: [] },
    actionIds: ["support-1", "primary", "support-2"],
    leverActionId: "primary",
    predictions,
  };
}

test("the active-report view keeps one causal lever and traces support actions without attribution", () => {
  const confidentCell: Action["impact"][number] = {
    metricId: metric.id,
    direction: "up",
    value: 14.7125569,
    label: "+14.7pp",
    good: true,
    evidence: "causal",
    readout: {
      methodology: "ITS",
      ciLow: 14.4930138,
      ciHigh: 14.9321,
      nPre: 75,
      nPost: 47,
      beliefReason: null,
    },
  };
  const misleadingSupportCell = {
    ...confidentCell,
    value: 4,
    label: "+4.0pp",
  };
  const actions = [
    action("support-2", "D1A3", null, [], monitoringMetric.id),
    action("primary", "D1A2", "2026-06-15", [confidentCell]),
    action(
      "support-1",
      "D1A1",
      "2026-04-02",
      [misleadingSupportCell],
      monitoringMetric.id,
    ),
  ];

  const view = buildReportImpactViewModel({
    reportTitle: "Gummy Alpha",
    decision: decision(),
    predictionId: "prediction",
    projection,
    metric,
    metrics: [metric, monitoringMetric],
    actions,
  });

  assert.equal(view.plannedLabel, "+37.5%");
  assert.equal(view.predictionState, "measured");
  assert.equal(view.measuredLabel, "+37.0%");
  assert.equal(view.varianceLabel, "-0.5%");
  assert.equal(view.analysisObservationCount, 122);
  assert.equal(view.nPre, 75);
  assert.equal(view.nPost, 47);
  assert.equal(view.plannedActions, 3);
  assert.equal(view.completedActions, 2);
  assert.deepEqual(
    view.actionTraces.map((trace) => trace.displayCode),
    ["D1A1", "D1A2", "D1A3"],
  );
  assert.equal(view.actionTraces[0].state, "not-independently-estimated");
  assert.equal(view.actionTraces[0].impactLabel, "—", "support evidence must stay hidden");
  assert.equal(view.actionTraces[0].metricName, "Support Tickets");
  assert.equal(view.actionTraces[1].state, "measured");
  assert.equal(view.actionTraces[1].metricName, "Adoption Rate");
  assert.equal(view.actionTraces[1].impactLabel, "+14.7pp");
  assert.equal(view.actionTraces[1].ci95Label, "95% CI +14.5pp to +14.9pp");
  assert.equal(view.actionTraces[1].sampleLabel, "75 pre · 47 post");
  assert.equal(view.actionTraces[2].state, "not-completed");
});

test("timeline references share the connected ratio-form percent scale", () => {
  assert.deepEqual(buildReportTimelineLevels(metric, projection), [
    {
      kind: "baseline",
      value: 0.4,
      label: "Report baseline",
      displayLabel: "40.0%",
    },
    {
      kind: "target",
      value: 0.55,
      label: "Planned target",
      displayLabel: "55.0%",
    },
  ]);
  assert.equal(formatReportMetricLevel(0.56, metric), "56.0%");
  assert.deepEqual(
    buildReportTimelineLevels({ ...metric, format: "count" }, projection),
    [],
    "percentage planning levels must not be overlaid on a different native unit",
  );
});

test("active timeline levels use the commitment baseline and implied native target", () => {
  assert.deepEqual(buildCommittedPredictionTimelineLevels(metric, prediction()), [
    {
      kind: "baseline",
      value: 0.4,
      label: "Baseline at commitment",
      displayLabel: "40.0%",
    },
    {
      kind: "target",
      value: 0.55,
      label: "Implied target",
      displayLabel: "55.0%",
    },
  ]);

  const countMetric = { ...monitoringMetric, series: [{ date: "2026-04-01", value: 100 }] };
  assert.equal(
    buildCommittedPredictionTimelineLevels(countMetric, prediction({ magnitudePctMean: 10 }))[1].value,
    110,
  );
});

test("an unresolved primary action stays blank instead of becoming a zero result", () => {
  const gatheringCell: Action["impact"][number] = {
    metricId: metric.id,
    direction: "neutral",
    value: null,
    label: "—",
    good: true,
    readout: {
      methodology: "ITS",
      ciLow: null,
      ciHigh: null,
      nPre: 30,
      nPost: 18,
      beliefReason: "INSUFFICIENT_HISTORY",
    },
  };
  const unresolved = prediction({
    verdict: null,
    resolvedAt: null,
    measuredPct: null,
  });
  const view = buildReportImpactViewModel({
    reportTitle: "Current report",
    decision: decision([unresolved]),
    predictionId: unresolved.id,
    projection,
    metric,
    metrics: [metric],
    actions: [action("primary", "D1A1", "2026-06-15", [gatheringCell])],
  });

  assert.equal(view.hasMeasurement, false);
  assert.equal(view.predictionState, "unresolved");
  assert.equal(view.measuredLabel, "—");
  assert.equal(view.varianceLabel, "—");
  assert.equal(view.actionTraces[0].state, "gathering");
  assert.equal(view.actionTraces[0].impactLabel, "—");
  assert.match(view.actionTraces[0].detail, /No zero is substituted/);
});

test("decision package uses the latest-effective action as timing without individual attribution", () => {
  const packageCell: Action["impact"][number] = {
    metricId: metric.id,
    direction: "up",
    value: 5,
    label: "+5.0pp",
    good: true,
    evidence: "causal",
  };
  const registered = action("primary", "D1A1", "2026-06-01");
  registered.reportContext = {
    activationId: "activation",
    role: "registered-primary",
    causalObject: "decision_package",
    isPackageIntervention: false,
    packageCompletedAt: "2026-06-15T12:00:00Z",
    monitoringExpectedDirection: null,
    monitoringCheckDate: null,
  };
  const finalAction = action("support-1", "D1A2", "2026-06-15", [packageCell], monitoringMetric.id);
  finalAction.reportContext = {
    activationId: "activation",
    role: "supporting",
    causalObject: "decision_package",
    isPackageIntervention: true,
    packageCompletedAt: "2026-06-15T12:00:00Z",
    monitoringExpectedDirection: "DECREASE",
    monitoringCheckDate: "2026-07-31",
  };
  const unmeasuredDecision = decision([prediction({ verdict: null, measuredPct: null })]);
  const view = buildReportImpactViewModel({
    reportTitle: "Package report",
    decision: unmeasuredDecision,
    predictionId: "prediction",
    projection,
    metric,
    metrics: [metric, monitoringMetric],
    actions: [registered, finalAction],
  });

  assert.equal(view.causalObject, "decision_package");
  assert.equal(view.primaryActionId, "primary");
  assert.equal(view.interventionActionId, "support-1");
  assert.equal(view.packageCompletedAt, "2026-06-15T12:00:00Z");
  assert.equal(view.actionTraces[0].state, "not-independently-estimated");
  assert.equal(view.actionTraces[1].state, "measured");
  assert.match(view.actionTraces[1].detail, /decision-package impact/i);
  assert.match(view.actionTraces[1].detail, /individual action attribution is unavailable/i);
});

test("an inconclusive numeric result stays visibly non-confident", () => {
  const inconclusive = prediction({
    verdict: "INCONCLUSIVE",
    measuredPct: 2.1,
  });
  const view = buildReportImpactViewModel({
    reportTitle: "Current report",
    decision: decision([inconclusive]),
    predictionId: inconclusive.id,
    projection,
    metric,
    metrics: [metric],
    actions: [action("primary", "D1A1", "2026-06-15")],
  });

  assert.equal(view.hasMeasurement, true);
  assert.equal(view.predictionState, "no-signal");
  assert.equal(view.measuredLabel, "+2.1%");
  assert.match(view.predictionDetail, /not as a confident causal claim/i);
});
