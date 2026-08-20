import { formatMetricValue } from "../format.ts";
import type { ReportActivationMetric } from "./materialization.ts";

export type DecisionReportActionSelectionInput = {
  active: boolean;
  reportActionSourceItemIds: string[];
  draftSelectedActionSourceItemIds: string[];
  draftPrimaryActionSourceItemId: string | null;
  activationSelectedActionSourceItemIds: string[];
  activationPrimaryActionSourceItemId: string | null;
};

export type DecisionReportActionSelection = {
  selectedActionIds: string[];
  primaryActionId: string;
};

/**
 * Report actions are keyed by their stable source-item identity. Canonical
 * action UUIDs belong to the materialized graph and must never be compared to
 * these editor keys.
 */
export function resolveDecisionReportActionSelection(
  input: DecisionReportActionSelectionInput,
): DecisionReportActionSelection {
  const hasCanonicalActivation =
    input.active && input.activationSelectedActionSourceItemIds.length > 0;
  const selectedActionIds = hasCanonicalActivation
    ? [...input.activationSelectedActionSourceItemIds]
    : input.active
      ? [...input.draftSelectedActionSourceItemIds]
      : [...input.reportActionSourceItemIds];
  const primaryActionId = hasCanonicalActivation
    ? input.activationPrimaryActionSourceItemId ?? ""
    : input.draftPrimaryActionSourceItemId ?? selectedActionIds[0] ?? "";

  return { selectedActionIds, primaryActionId };
}

type MetricReadinessDetail = Pick<
  ReportActivationMetric,
  | "unit"
  | "format"
  | "percentScale"
  | "lastObservationDate"
  | "lastObservationValue"
  | "preHistoryObservationCount"
  | "preHistoryDays"
  | "earliestConfidentReviewDate"
>;

export function formatMetricReadinessDetail(metric: MetricReadinessDetail): string {
  const unit = metric.unit?.trim() || metric.format;
  const scale = metric.format === "percent" ? ` (${metric.percentScale} scale)` : "";
  let latestObservation = "No observations";

  if (metric.lastObservationDate) {
    if (
      metric.lastObservationValue !== null &&
      Number.isFinite(metric.lastObservationValue)
    ) {
      const displayValue = metric.format === "percent" && metric.percentScale === "ratio"
        ? metric.lastObservationValue * 100
        : metric.lastObservationValue;
      latestObservation =
        `Last ${formatMetricValue(displayValue, metric.format)} on ${metric.lastObservationDate}`;
    } else {
      latestObservation = `Last ${metric.lastObservationDate}`;
    }
  }

  return `${unit}${scale} · ${latestObservation} · ` +
    `${metric.preHistoryObservationCount} obs / ${metric.preHistoryDays}d · ` +
    `Review ${metric.earliestConfidentReviewDate}`;
}

export function isSupportingActionForMonitoring(
  actionSourceItemId: string,
  primaryActionSourceItemId: string,
): boolean {
  return actionSourceItemId !== primaryActionSourceItemId;
}
