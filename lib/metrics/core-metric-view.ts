import type { Metric } from "../types.ts";

export type CoreMetricRole = "report" | "context";

export type CoreMetricChoice = {
  metric: Metric;
  role: CoreMetricRole;
};

export type CoreMetricDrawerView = {
  choices: CoreMetricChoice[];
  summaryChoices: CoreMetricChoice[];
  selectedChoice: CoreMetricChoice | null;
  reportMetric: Metric | null;
  contextMetricCount: number;
  countLabel: string;
};

/**
 * Order and select the metrics shown in the persistent drawer without changing
 * any durable metric relationship. The activated report metric is a pinned
 * target; every other metric is workspace context only.
 */
export function selectCoreMetricDrawerView(input: {
  metrics: Metric[];
  reportMetricId: string | null;
  selectedMetricId: string | null;
}): CoreMetricDrawerView {
  const seen = new Set<string>();
  const uniqueMetrics = input.metrics.filter((metric) => {
    if (seen.has(metric.id)) return false;
    seen.add(metric.id);
    return true;
  });
  const reportMetric = input.reportMetricId
    ? uniqueMetrics.find((metric) => metric.id === input.reportMetricId) ?? null
    : null;
  const orderedMetrics = reportMetric
    ? [reportMetric, ...uniqueMetrics.filter((metric) => metric.id !== reportMetric.id)]
    : uniqueMetrics;
  const choices = orderedMetrics.map((metric): CoreMetricChoice => ({
    metric,
    role: reportMetric?.id === metric.id ? "report" : "context",
  }));
  const selectedChoice = choices.find(
    ({ metric }) => metric.id === input.selectedMetricId,
  ) ?? choices[0] ?? null;
  const summaryChoices = selectedChoice
    ? [
        selectedChoice,
        ...choices.filter(({ metric }) => metric.id !== selectedChoice.metric.id),
      ]
    : choices;
  const contextMetricCount = choices.filter(({ role }) => role === "context").length;

  return {
    choices,
    summaryChoices,
    selectedChoice,
    reportMetric,
    contextMetricCount,
    countLabel: reportMetric
      ? `1 report + ${contextMetricCount} core`
      : choices.length === 0
        ? "no core metrics"
        : `${choices.length} core`,
  };
}
