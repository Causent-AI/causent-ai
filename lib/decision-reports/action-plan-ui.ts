import { formatMetricValue } from "../format.ts";
import type { ReportActivationMetric } from "./materialization.ts";

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
