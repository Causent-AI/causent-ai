import type { Action, Decision, ImpactStat, Metric, MetricImpact } from "../types.ts";
import type { DashboardDecisionReport } from "./decision-reports.ts";
import { formatImpactMagnitude } from "./readout.ts";

function directionOf(value: number): "up" | "down" | "neutral" {
  if (value > 0.0001) return "up";
  if (value < -0.0001) return "down";
  return "neutral";
}

/**
 * Derive the report-level causal rollup from the already-isolated action list.
 * A legacy report uses its pre-registered primary lever. A completed v2 plan
 * uses its audited latest-effective action only as the package timing marker.
 * Descriptive and other action cells remain outside the rollup, and
 * workspace-wide aggregates are intentionally ignored here.
 */
export function deriveCurrentReportImpact(
  actions: Action[],
  metrics: Metric[],
  primaryActionId: string | null,
): Pick<ReportProjectView, "aggregatedImpact" | "impactByMetric"> {
  const packageInterventionActionId = actions.find(
    (action) =>
      action.reportContext?.causalObject === "decision_package" &&
      action.reportContext.isPackageIntervention,
  )?.id ?? null;
  const causalActionId = packageInterventionActionId ?? primaryActionId;
  const causalCells = actions
    .filter((action) => action.id === causalActionId)
    .flatMap((action) =>
      action.impact.filter(
        (cell) => cell.evidence === "causal" && cell.value !== null,
      ),
    );
  const confidentGood = causalCells.filter((cell) => cell.good).length;
  const confident = causalCells.length;

  const impactByMetric = metrics.map((metric): MetricImpact => {
    const value = causalCells
      .filter((cell) => cell.metricId === metric.id)
      .reduce((sum, cell) => sum + (cell.value ?? 0), 0);
    const hasCausalReadout = causalCells.some((cell) => cell.metricId === metric.id);
    const direction = hasCausalReadout ? directionOf(value) : "neutral";
    return {
      metricId: metric.id,
      value,
      label: hasCausalReadout && direction !== "neutral"
        ? formatImpactMagnitude(value, metric.format)
        : "—",
      direction,
      good:
        direction === "neutral" ||
        (direction === "up") === metric.higherIsBetter,
    };
  });

  const winRate = confident > 0
    ? Math.round((confidentGood / confident) * 100)
    : null;
  return {
    aggregatedImpact: [{
      label: "Improvement Rate",
      value: winRate === null ? "—" : `${winRate}%`,
      comparison: `${confidentGood} / ${confident} confident readouts for this report`,
      tone: winRate === null ? "plain" : winRate >= 50 ? "positive" : "negative",
    }],
    impactByMetric,
  };
}

export type ReportProjectView = {
  activeReport: DashboardDecisionReport | null;
  actions: Action[];
  decisions: Decision[];
  metrics: Metric[];
  aggregatedImpact: ImpactStat[];
  impactByMetric: MetricImpact[];
};

/**
 * An activated report is a project boundary inside the legacy shared demo workspace.
 * Only its canonical decision, selected actions, and their registered metrics may cross it.
 */
export function selectReportProjectView(input: {
  reports: DashboardDecisionReport[];
  actions: Action[];
  decisions: Decision[];
  metrics: Metric[];
  metricUiIdByDbId: Map<string, string>;
  aggregatedImpact: ImpactStat[];
  impactByMetric: MetricImpact[];
}): ReportProjectView {
  const activeReport = input.reports.find(
    (report) => report.isCurrent && report.status === "active" && report.decisionId && report.metricId,
  ) ?? null;
  if (!activeReport) {
    const removedReportDecisions = input.decisions.filter(
      (decision) => decision.origin === "decision_report",
    );
    const removedReportActionIds = new Set(
      removedReportDecisions.flatMap((decision) => decision.actionIds),
    );
    return {
      activeReport: null,
      actions: removedReportDecisions.length === 0
        ? input.actions
        : input.actions.filter((action) => !removedReportActionIds.has(action.id)),
      decisions: removedReportDecisions.length === 0
        ? input.decisions
        : input.decisions.filter((decision) => decision.origin !== "decision_report"),
      metrics: input.metrics,
      aggregatedImpact: input.aggregatedImpact,
      impactByMetric: input.impactByMetric,
    };
  }

  const decisions = input.decisions.filter(
    (decision) => decision.id === activeReport.decisionId,
  );
  const actionIds = new Set(decisions.flatMap((decision) => decision.actionIds));
  const actions = input.actions.filter((action) => actionIds.has(action.id));
  const primaryMetricUiId = activeReport.metricId
    ? input.metricUiIdByDbId.get(activeReport.metricId) ?? null
    : null;
  const actionMetricIds = new Set(actions.map((action) => action.primaryMetricId));
  if (primaryMetricUiId) actionMetricIds.add(primaryMetricUiId);
  const primaryMetric = primaryMetricUiId
    ? input.metrics.find((metric) => metric.id === primaryMetricUiId) ?? null
    : null;
  const metrics = [
    ...(primaryMetric ? [primaryMetric] : []),
    ...input.metrics.filter(
      (metric) => metric.id !== primaryMetricUiId && actionMetricIds.has(metric.id),
    ),
  ];
  const reportImpact = deriveCurrentReportImpact(
    actions,
    primaryMetric ? [primaryMetric] : [],
    decisions[0]?.leverActionId ?? null,
  );

  return {
    activeReport,
    actions,
    decisions,
    metrics,
    aggregatedImpact: reportImpact.aggregatedImpact,
    impactByMetric: reportImpact.impactByMetric,
  };
}
