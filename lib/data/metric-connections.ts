export type MetricConnectionSummary = {
  connected: number;
  total: number;
};

export function summarizeMetricConnections(
  metrics: ReadonlyArray<{ series: readonly unknown[] }>,
): MetricConnectionSummary {
  return {
    connected: metrics.filter((metric) => metric.series.length > 0).length,
    total: metrics.length,
  };
}
