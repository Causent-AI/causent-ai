import { formatMetricValue } from "../format.ts";
import type { MetricFormat, PredictionDirection } from "../types.ts";

export type PercentStorageScale = "ratio" | "points";

export type NativePredictionTarget =
  | {
      available: true;
      baselineNative: number;
      deltaNative: number;
      impliedTargetNative: number;
      signedMagnitudePctMean: number;
      baselineLabel: string;
      deltaLabel: string;
      impliedTargetLabel: string;
    }
  | {
      available: false;
      reason: "missing-baseline" | "zero-baseline" | "invalid-commitment";
    };

function displayValue(
  value: number,
  format: MetricFormat,
  percentScale: PercentStorageScale,
): number {
  return format === "percent" && percentScale === "ratio" ? value * 100 : value;
}

/**
 * Translate the stored percent-of-mean commitment into the metric's native
 * scale for review. The percent commitment remains authoritative; this helper
 * is a transparent calculator and never changes the activation payload.
 */
export function calculateNativePredictionTarget(input: {
  baselineNative: number | null;
  format: MetricFormat;
  percentScale?: PercentStorageScale;
  direction: PredictionDirection;
  magnitudePctMean: number | null;
}): NativePredictionTarget {
  const baseline = input.baselineNative;
  if (baseline === null || !Number.isFinite(baseline)) {
    return { available: false, reason: "missing-baseline" };
  }
  if (Math.abs(baseline) < Number.EPSILON) {
    return { available: false, reason: "zero-baseline" };
  }
  const magnitude = input.magnitudePctMean;
  if (magnitude === null || !Number.isFinite(magnitude) || magnitude <= 0) {
    return { available: false, reason: "invalid-commitment" };
  }

  const signedMagnitudePctMean = input.direction === "POSITIVE"
    ? magnitude
    : -magnitude;
  const deltaNative = Math.abs(baseline) * signedMagnitudePctMean / 100;
  const impliedTargetNative = baseline + deltaNative;
  const scale = input.percentScale ?? "points";
  const baselineDisplay = displayValue(baseline, input.format, scale);
  const deltaDisplay = displayValue(deltaNative, input.format, scale);
  const targetDisplay = displayValue(impliedTargetNative, input.format, scale);

  return {
    available: true,
    baselineNative: baseline,
    deltaNative,
    impliedTargetNative,
    signedMagnitudePctMean,
    baselineLabel: formatMetricValue(baselineDisplay, input.format),
    deltaLabel: `${deltaNative >= 0 ? "+" : ""}${formatMetricValue(deltaDisplay, input.format)}`,
    impliedTargetLabel: formatMetricValue(targetDisplay, input.format),
  };
}
