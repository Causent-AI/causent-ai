// Shared mapping from a materialized ACTION -> METRIC readout to a UI ImpactCell.
// Used by both getActions() (per-action cell row) and getImpactByMetric() (per-metric
// aggregate), so the honesty rule lives in exactly one place.

import type { ImpactCell, Metric, MetricFormat } from "../types.ts";
import { formatCount, formatCurrencyDelta, formatPpDelta } from "../format.ts";
import { directionFromEdge, isConfident, isGoodOutcome } from "./config.ts";
import { measurementReason } from "../metrics/measurement.ts";
import type { EdgeReadout } from "./graph.ts";

/** Signed magnitude label per metric format. Mirrors lib/derive.ts. */
export function formatImpactMagnitude(value: number, format: MetricFormat): string {
  if (format === "currency") return formatCurrencyDelta(value);
  if (format === "percent") return formatPpDelta(value);
  return `${value > 0 ? "+" : ""}${formatCount(value)}`;
}

/** The neutral "no measured effect" cell for a metric ("—"). */
export function neutralCell(metricId: string): ImpactCell {
  return { metricId, direction: "neutral", value: null, label: "—", good: true };
}

function directionFromValue(value: number): "up" | "down" | "neutral" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}

/** Convert only an explicitly declared ratio; observed magnitude is not a unit. */
function displayValue(value: number, metric: Metric): number {
  if (
    metric.format === "percent" && metric.percentScale === "ratio"
  ) {
    return value * 100;
  }
  return value;
}

function displayOptionalValue(
  value: number | null,
  metric: Metric,
): number | null {
  return value === null ? null : displayValue(value, metric);
}

/**
 * Map one (metric, edge-readout) pair to an ImpactCell. A confident directional
 * ITS edge is authoritative. While ITS is gathering history, an evaluable 14-day
 * mean shift may appear only as an explicitly descriptive preliminary readout.
 */
export function toImpactCell(metric: Metric, edge: EdgeReadout | undefined): ImpactCell {
  if (metric.definitionId === null || metric.percentScale === "unknown") {
    return { ...neutralCell(metric.id), good: null,
      detail: "Confirm this metric's definition before interpreting its effect." };
  }
  const provenance = edge?.provenance === undefined ? {} : {
    evaluationId: edge.evaluationId,
    provenance: edge.provenance,
  };
  if (edge?.provenance && edge.provenance !== "computed") {
    const detail = {
      legacy_unverified: "Historical evidence awaits verified recomputation.",
      manual: "Manual assertion; no computed result.",
      incomplete: "The current evaluation has no complete result yet.",
    }[edge.provenance];
    return { ...neutralCell(metric.id), detail };
  }
  if (edge?.interpretation === "cannot_attribute" || edge?.interpretation === "waiting") {
    return { ...neutralCell(metric.id), good: null, interpretation: edge.interpretation, detail: measurementReason(edge.refusalReason) };
  }
  if (edge?.interpretation === "legacy_unverified") {
    return { ...neutralCell(metric.id), good: null, detail: "Historical result has no registered measurement contract." };
  }
  if (edge && isConfident(edge.dbDirection, edge.beliefScore) && edge.lift != null) {
    const direction = directionFromEdge(edge.dbDirection);
    const value = displayValue(edge.lift, metric);
    return {
      metricId: metric.id,
      direction,
      value,
      label: formatImpactMagnitude(value, metric.format),
      good: metric.beneficialDirection === "neutral" || metric.beneficialDirection === "unknown"
        ? null : isGoodOutcome(direction, metric.higherIsBetter),
      evidence: "observational",
      interpretation: "observational",
      detail: "Observed level change around registered exposure. Work and AI contribution are not identified.",
      readout: {
        ...provenance,
        methodology: "ITS",
        ciLow: displayOptionalValue(edge.ciLow, metric),
        ciHigh: displayOptionalValue(edge.ciHigh, metric),
        nPre: edge.nPre,
        nPost: edge.nPost,
        beliefReason: edge.beliefReason,
      },
    };
  }

  // The design contract explicitly keeps the 45-day causal floor while showing
  // an evaluable 14-day mean shift as a labeled descriptive cross-check. It must
  // never inherit the edge's causal direction or belief.
  if (
    edge?.beliefReason === "INSUFFICIENT_HISTORY" &&
    edge.descriptiveLift != null
  ) {
    const direction = directionFromValue(edge.descriptiveLift);
    const value = displayValue(edge.descriptiveLift, metric);
    const overlap = edge.descriptiveClustered
      ? " Overlaps another completed action, so attribution is not isolated."
      : "";
    return {
      metricId: metric.id,
      direction,
      value,
      label: formatImpactMagnitude(value, metric.format),
      good: metric.beneficialDirection === "neutral" || metric.beneficialDirection === "unknown"
        ? null : isGoodOutcome(direction, metric.higherIsBetter),
      evidence: "descriptive",
      detail: `Preliminary 14-day before/after mean shift. Not an attribution claim; statistical confidence is limited.${overlap}`,
      readout: {
        ...provenance,
        methodology: "BEFORE_AFTER_14D",
        ciLow: displayOptionalValue(edge.descriptiveCiLow, metric),
        ciHigh: displayOptionalValue(edge.descriptiveCiHigh, metric),
        nPre: edge.descriptiveNPre,
        nPost: edge.descriptiveNPost,
        beliefReason: edge.beliefReason,
      },
    };
  }

  const neutral = neutralCell(metric.id);
  if (!edge) return neutral;
  return {
    ...neutral,
    readout: {
      ...provenance,
      methodology: "ITS",
      ciLow: displayOptionalValue(edge.ciLow, metric),
      ciHigh: displayOptionalValue(edge.ciHigh, metric),
      nPre: edge.nPre,
      nPost: edge.nPost,
      beliefReason: edge.beliefReason,
    },
  };
}
