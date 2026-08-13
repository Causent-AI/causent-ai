import type { MetricProjection } from "../decision-reports/schema.ts";
import { formatMetricValue } from "../format.ts";
import {
  buildPredictionOutcomeViewModel,
  formatSignedPredictionPct,
  type PredictionOutcomeState,
} from "../scorecard-chart.ts";
import type { Action, Decision, ImpactCell, Metric } from "../types.ts";
import { formatImpactMagnitude } from "../data/readout.ts";

export type ReportImpactActionState =
  | "measured"
  | "preliminary"
  | "gathering"
  | "not-completed"
  | "not-independently-estimated";

export type ReportImpactActionTrace = {
  actionId: string;
  displayCode: string;
  title: string;
  completedOn: string | null;
  isPrimary: boolean;
  state: ReportImpactActionState;
  stateLabel: string;
  impactLabel: string;
  detail: string;
  ci95Label: string | null;
  sampleLabel: string | null;
  href: string;
};

export type ReportImpactTimelineLevel = {
  kind: "baseline" | "target";
  /** Value on the connected series' stored scale. */
  value: number;
  label: string;
  displayLabel: string;
};

export type ReportImpactViewModel = {
  reportTitle: string;
  decisionTitle: string;
  metricName: string;
  predictionState: PredictionOutcomeState;
  predictionStatus: string;
  predictionDetail: string;
  plannedLabel: string;
  measuredLabel: string;
  varianceLabel: string;
  hasMeasurement: boolean;
  observationCount: number;
  analysisObservationCount: number;
  nPre: number | null;
  nPost: number | null;
  plannedActions: number;
  completedActions: number;
  primaryActionId: string | null;
  timelineLevels: ReportImpactTimelineLevel[];
  actionTraces: ReportImpactActionTrace[];
};

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Ratio-form percentage CSVs store 40% as 0.4; older datasets store 40. */
export function usesRatioPercentScale(metric: Metric): boolean {
  return metric.format === "percent" &&
    metric.series.length > 0 &&
    metric.series.every((observation) => Math.abs(observation.value) <= 1);
}

export function formatReportMetricLevel(value: number, metric: Metric): string {
  const displayValue = usesRatioPercentScale(metric) ? value * 100 : value;
  return formatMetricValue(displayValue, metric.format);
}

/** Overlay planning levels only when the connected series has the same percent unit. */
export function buildReportTimelineLevels(
  metric: Metric,
  projection: MetricProjection,
): ReportImpactTimelineLevel[] {
  if (metric.format !== "percent") return [];
  const ratioScale = usesRatioPercentScale(metric);
  const levels: ReportImpactTimelineLevel[] = [];
  const baseline = finiteNumber(projection.baselinePct);
  const target = finiteNumber(projection.predictedPct);

  if (baseline !== null) {
    const value = ratioScale ? baseline / 100 : baseline;
    levels.push({
      kind: "baseline",
      value,
      label: "Report baseline",
      displayLabel: formatReportMetricLevel(value, metric),
    });
  }
  if (target !== null) {
    const value = ratioScale ? target / 100 : target;
    levels.push({
      kind: "target",
      value,
      label: "Planned target",
      displayLabel: formatReportMetricLevel(value, metric),
    });
  }
  return levels;
}

function actionCode(action: Action): string {
  const code = action.displayCode?.trim();
  if (code) return code;
  const reference = action.referenceLabel?.trim();
  if (reference) return reference;
  return action.pr > 0 ? `#${action.pr}` : "Action";
}

function intervalLabel(cell: ImpactCell | undefined, metric: Metric): string | null {
  const low = finiteNumber(cell?.readout?.ciLow);
  const high = finiteNumber(cell?.readout?.ciHigh);
  if (low === null || high === null) return null;
  return `95% CI ${formatImpactMagnitude(Math.min(low, high), metric.format)} to ${formatImpactMagnitude(Math.max(low, high), metric.format)}`;
}

function sampleLabel(cell: ImpactCell | undefined): string | null {
  const nPre = finiteNumber(cell?.readout?.nPre);
  const nPost = finiteNumber(cell?.readout?.nPost);
  if (nPre === null || nPost === null) return null;
  return `${Math.max(0, Math.floor(nPre))} pre · ${Math.max(0, Math.floor(nPost))} post`;
}

function traceForAction(
  action: Action,
  metric: Metric,
  primaryActionId: string | null,
): ReportImpactActionTrace {
  const isPrimary = action.id === primaryActionId;
  const cell = action.impact.find((candidate) => candidate.metricId === metric.id);
  const base = {
    actionId: action.id,
    displayCode: actionCode(action),
    title: action.title,
    completedOn: action.shippedAt,
    isPrimary,
    href: `/actions?selected=${encodeURIComponent(action.id)}#${encodeURIComponent(action.id)}`,
  };

  if (!action.shippedAt) {
    return {
      ...base,
      state: "not-completed",
      stateLabel: "Not completed",
      impactLabel: "—",
      detail: "This action has no completion date, so no outcome is attributed to it.",
      ci95Label: null,
      sampleLabel: null,
    };
  }

  if (!isPrimary) {
    return {
      ...base,
      state: "not-independently-estimated",
      stateLabel: "Not independently estimated",
      impactLabel: "—",
      detail: `Completed support action connected to ${metric.name}. The action-level causal readout is reserved for the pre-registered primary lever.`,
      ci95Label: null,
      sampleLabel: null,
    };
  }

  if (cell?.evidence === "causal" && cell.value !== null) {
    return {
      ...base,
      state: "measured",
      stateLabel: "ITS estimate",
      impactLabel: cell.label,
      detail: "Estimated impact—not proof. This is the confident causal readout for the pre-registered primary lever.",
      ci95Label: intervalLabel(cell, metric),
      sampleLabel: sampleLabel(cell),
    };
  }

  if (cell?.evidence === "descriptive" && cell.value !== null) {
    return {
      ...base,
      state: "preliminary",
      stateLabel: "Preliminary only",
      impactLabel: cell.label,
      detail: cell.detail ?? "A descriptive comparison is available, but it is not a causal estimate.",
      ci95Label: intervalLabel(cell, metric),
      sampleLabel: sampleLabel(cell),
    };
  }

  return {
    ...base,
    state: "gathering",
    stateLabel: "No confident estimate yet",
    impactLabel: "—",
    detail: "The primary lever is complete, but the engine has not produced a confident causal estimate. No zero is substituted.",
    ci95Label: null,
    sampleLabel: sampleLabel(cell),
  };
}

function orderActionTraces(actions: Action[]): Action[] {
  return actions
    .map((action, inputIndex) => ({ action, inputIndex }))
    .sort((left, right) => {
      const leftCode = left.action.displayCode?.trim();
      const rightCode = right.action.displayCode?.trim();
      if (leftCode && rightCode) {
        const byCode = leftCode.localeCompare(rightCode, undefined, { numeric: true });
        if (byCode !== 0) return byCode;
      }
      return left.inputIndex - right.inputIndex;
    })
    .map(({ action }) => action);
}

export function buildReportImpactViewModel(input: {
  reportTitle: string;
  decision: Decision;
  predictionId: string | null;
  projection: MetricProjection;
  metric: Metric;
  actions: Action[];
}): ReportImpactViewModel {
  const prediction = input.decision.predictions.find(
    (candidate) => candidate.id === input.predictionId,
  ) ?? null;
  const outcome = buildPredictionOutcomeViewModel({
    prediction,
    metricName: input.metric.name,
    observationCount: input.metric.series.length,
  });
  const primaryActionId = input.decision.leverActionId;
  const primaryAction = input.actions.find((action) => action.id === primaryActionId);
  const primaryCell = primaryAction?.impact.find(
    (cell) => cell.metricId === input.metric.id,
  );
  const nPre = finiteNumber(primaryCell?.readout?.nPre);
  const nPost = finiteNumber(primaryCell?.readout?.nPost);
  const normalizedNPre = nPre === null ? null : Math.max(0, Math.floor(nPre));
  const normalizedNPost = nPost === null ? null : Math.max(0, Math.floor(nPost));
  const hasWindowCounts = normalizedNPre !== null && normalizedNPost !== null;
  const variancePct = outcome.plannedPct !== null && outcome.measuredPct !== null
    ? outcome.measuredPct - outcome.plannedPct
    : null;

  return {
    reportTitle: input.reportTitle,
    decisionTitle: input.decision.title,
    metricName: input.metric.name,
    predictionState: outcome.state,
    predictionStatus: outcome.statusTitle,
    predictionDetail: outcome.statusDetail,
    plannedLabel: outcome.plannedLabel ?? "—",
    measuredLabel: outcome.measuredLabel ?? "—",
    varianceLabel: variancePct === null ? "—" : formatSignedPredictionPct(variancePct),
    hasMeasurement: outcome.hasMeasurement,
    observationCount: input.metric.series.length,
    analysisObservationCount: hasWindowCounts
      ? normalizedNPre + normalizedNPost
      : input.metric.series.length,
    nPre: normalizedNPre,
    nPost: normalizedNPost,
    plannedActions: input.actions.length,
    completedActions: input.actions.filter((action) => action.shippedAt !== null).length,
    primaryActionId,
    timelineLevels: buildReportTimelineLevels(input.metric, input.projection),
    actionTraces: orderActionTraces(input.actions).map((action) =>
      traceForAction(action, input.metric, primaryActionId)
    ),
  };
}
