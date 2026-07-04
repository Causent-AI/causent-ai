import type { Direction, Metric } from "@/lib/types";
import {
  formatCount,
  formatCurrencyDelta,
  formatMetricValue,
  formatPpDelta,
} from "@/lib/format";

export type MetricDelta = {
  latest: number;
  latestLabel: string;
  direction: Direction;
  /** Is the movement a good business outcome (accounts for inverted metrics)? */
  good: boolean;
  /** e.g. "+$212K (9.6%)", "+6.3pp (18.0%)", "-4.1K (-32.1%)". */
  changeLabel: string;
};

/** Latest value + change vs `lookback` days ago, formatted per the metric. */
export function getMetricDelta(metric: Metric, lookback = 30): MetricDelta {
  const s = metric.series;
  const latest = s[s.length - 1].value;
  const priorIdx = Math.max(0, s.length - 1 - lookback);
  const prior = s[priorIdx].value;
  const abs = latest - prior;
  const pct = prior !== 0 ? (abs / prior) * 100 : 0;

  const direction: Direction = abs > 0.0001 ? "up" : abs < -0.0001 ? "down" : "neutral";
  const good = direction === "neutral" ? true : (direction === "up") === metric.higherIsBetter;

  let magnitude: string;
  if (metric.format === "currency") magnitude = formatCurrencyDelta(abs);
  else if (metric.format === "percent") magnitude = formatPpDelta(abs);
  else magnitude = `${abs > 0 ? "+" : ""}${formatCount(abs)}`;

  const pctStr = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;

  return {
    latest,
    latestLabel: formatMetricValue(latest, metric.format),
    direction,
    good,
    changeLabel: `${magnitude} (${pctStr})`,
  };
}
