import type { ImpactCell, ImpactStat, Metric, MetricImpact } from "../types.ts";
import type { EdgeReadout } from "./graph.ts";
import { toImpactCell } from "./readout.ts";

/** Use the same definition/provenance gate as the action readout. */
export function observationalCells(metrics: Metric[], edges: EdgeReadout[]): ImpactCell[] {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  return edges.flatMap((edge) => {
    const metric = byId.get(edge.metricId);
    if (!metric || edge.provenance !== "computed" || edge.interpretation !== "observational") return [];
    const cell = toImpactCell(metric, edge);
    return cell.evidence === "observational" && cell.value !== null ? [cell] : [];
  });
}

/** Distinct registered windows cannot be summed into one purported net effect. */
export function summarizeMetricImpact(metrics: Metric[], edges: EdgeReadout[]): MetricImpact[] {
  const cells = observationalCells(metrics, edges);
  return metrics.map((metric) => {
    const candidates = cells.filter((cell) => cell.metricId === metric.id);
    const cell = candidates.length === 1 ? candidates[0] : null;
    return {
      metricId: metric.id, value: cell?.value ?? 0, label: cell?.label ?? "—",
      direction: cell?.direction ?? "neutral", good: cell?.good ?? null,
    };
  });
}

export function summarizeObservedImprovement(metrics: Metric[], edges: EdgeReadout[]): ImpactStat[] {
  const cells = observationalCells(metrics, edges).filter((cell) => cell.good !== null);
  const improved = cells.filter((cell) => cell.good === true).length;
  const rate = cells.length ? Math.round(improved / cells.length * 100) : null;
  return [{
    label: "Observed improvement", value: rate === null ? "—" : `${rate}%`,
    comparison: `${improved} / ${cells.length} interpretable observational readouts`,
    tone: rate === null ? "neutral" : rate >= 50 ? "positive" : "negative",
  }];
}
