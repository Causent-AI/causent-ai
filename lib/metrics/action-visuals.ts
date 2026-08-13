import type { Action, Observation } from "../types.ts";

export type MetricHistoryContext = {
  totalObservations: number;
  visibleObservations: number;
  visibleStartDate: string | null;
  visibleEndDate: string | null;
  latestDate: string | null;
  latestValue: number | null;
};

export type ReportActionMarker = {
  actionId: string;
  date: string;
  label: string;
  title: string;
  isPrimary: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function actionLabel(action: Action): string {
  const displayCode = action.displayCode?.trim();
  if (displayCode) return displayCode;

  const referenceLabel = action.referenceLabel?.trim();
  if (referenceLabel) return referenceLabel;

  return action.pr > 0 ? `#${action.pr}` : "Action";
}

/**
 * Summarize the exact observation window already selected by the caller.
 * `latest*` always describes the raw series rather than a weekly rollup.
 */
export function buildMetricHistoryContext(
  series: Observation[],
  visibleSeries: Observation[],
): MetricHistoryContext {
  const latest = series.at(-1) ?? null;
  return {
    totalObservations: series.length,
    visibleObservations: visibleSeries.length,
    visibleStartDate: visibleSeries[0]?.date ?? null,
    visibleEndDate: visibleSeries.at(-1)?.date ?? null,
    latestDate: latest?.date ?? null,
    latestValue: latest?.value ?? null,
  };
}

/**
 * Completed actions inside the visible observation window, ordered by date.
 * The caller supplies an already report-isolated action list; this helper never
 * widens that boundary or infers actions from metric movement.
 */
export function buildReportActionMarkers(
  actions: Action[],
  primaryActionId: string | null,
  visibleSeries: Observation[],
): ReportActionMarker[] {
  const startDate = visibleSeries[0]?.date;
  const endDate = visibleSeries.at(-1)?.date;
  if (!startDate || !endDate) return [];

  return actions
    .flatMap((action, inputIndex) => {
      const date = action.shippedAt;
      if (
        date === null ||
        !ISO_DATE.test(date) ||
        date < startDate ||
        date > endDate
      ) {
        return [];
      }

      return [{
        actionId: action.id,
        date,
        label: actionLabel(action),
        title: action.title,
        isPrimary: action.id === primaryActionId,
        inputIndex,
      }];
    })
    .sort((left, right) =>
      left.date.localeCompare(right.date) || left.inputIndex - right.inputIndex,
    )
    .map((marker) => ({
      actionId: marker.actionId,
      date: marker.date,
      label: marker.label,
      title: marker.title,
      isPrimary: marker.isPrimary,
    }));
}
