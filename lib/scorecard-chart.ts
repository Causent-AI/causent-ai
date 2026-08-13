// Pure view-model shaping for the canonical prediction outcome chart.
//
// The chart compares the activation-time human commitment with the engine's
// signed measured percent on the same %-of-mean scale. It deliberately reuses
// the resolution scorecard's native-CI conversion instead of reimplementing
// measurement math in the UI.

import { shapeScorecard } from "./scorecard.ts";
import type { Prediction, PredictionVerdict } from "./types.ts";

export type PredictionOutcomeState = "measured" | "unresolved" | "no-signal";

export type PredictionOutcomeAxis = {
  minPct: number;
  maxPct: number;
  zeroPositionPct: number;
};

export type PredictionOutcomeViewModel = {
  metricName: string;
  state: PredictionOutcomeState;
  plannedPct: number | null;
  plannedLabel: string | null;
  measuredPct: number | null;
  measuredLabel: string | null;
  ci95Pct: { low: number; high: number } | null;
  ci95Label: string | null;
  hasMeasurement: boolean;
  verdict: PredictionVerdict | null;
  verdictLabel: string | null;
  statusTitle: string;
  statusDetail: string;
  axis: PredictionOutcomeAxis;
  ariaLabel: string;
};

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatSignedPredictionPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function outcomeAxis(values: Array<number | null>): PredictionOutcomeAxis {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const rawMin = Math.min(0, ...finite);
  const rawMax = Math.max(0, ...finite);
  const magnitude = Math.max(1, Math.abs(rawMin), Math.abs(rawMax));
  const pad = Math.max(1, magnitude * 0.12);
  const minPct = rawMin === 0 ? -pad : rawMin - pad;
  const maxPct = rawMax === 0 ? pad : rawMax + pad;

  return {
    minPct,
    maxPct,
    zeroPositionPct: ((0 - minPct) / (maxPct - minPct)) * 100,
  };
}

function unresolvedDetail(observationCount: number, resolutionDate: string): string {
  if (observationCount > 0) {
    return `${observationCount} observations are connected. The engine has not produced a measured outcome yet; it will re-evaluate against the ${resolutionDate} resolution date and causal gates.`;
  }
  return "No engine measurement is available yet. Connect daily metric data so the prediction can be evaluated after the action ships and the causal gates pass.";
}

export function buildPredictionOutcomeViewModel(input: {
  prediction: Prediction | null;
  metricName: string;
  observationCount?: number;
}): PredictionOutcomeViewModel {
  const { prediction, metricName } = input;
  const observationCount = Math.max(0, Math.floor(finiteNumber(input.observationCount) ?? 0));

  if (!prediction) {
    const axis = outcomeAxis([]);
    return {
      metricName,
      state: "unresolved",
      plannedPct: null,
      plannedLabel: null,
      measuredPct: null,
      measuredLabel: null,
      ci95Pct: null,
      ci95Label: null,
      hasMeasurement: false,
      verdict: null,
      verdictLabel: null,
      statusTitle: "No tracked prediction",
      statusDetail:
        "This report does not expose an activation-time prediction to compare with an outcome yet.",
      axis,
      ariaLabel: `${metricName}: no activation-time prediction or engine measurement is available.`,
    };
  }

  const committedMagnitude = finiteNumber(prediction.magnitudePctMean);
  const plannedPct = committedMagnitude === null
    ? null
    : prediction.direction === "POSITIVE"
      ? Math.abs(committedMagnitude)
      : -Math.abs(committedMagnitude);

  const scorecard = prediction.verdict !== null && committedMagnitude !== null
    ? shapeScorecard({
        verdict: prediction.verdict,
        committedDirection: prediction.direction,
        committedMagnitudePct: Math.abs(committedMagnitude),
        tuple: prediction.resolutionTuple ?? null,
      })
    : null;

  // Seed/demo decisions predate resolutionTuple persistence, so the top-level
  // measuredPct remains a valid fallback. In database mode both values come
  // from the same engine-authored tuple.
  const measuredPct = finiteNumber(prediction.measuredPct)
    ?? finiteNumber(scorecard?.measured?.pct);
  const rawCiLow = finiteNumber(scorecard?.measured?.ciLowPct);
  const rawCiHigh = finiteNumber(scorecard?.measured?.ciHighPct);
  const ci95Pct = rawCiLow !== null && rawCiHigh !== null
    ? { low: Math.min(rawCiLow, rawCiHigh), high: Math.max(rawCiLow, rawCiHigh) }
    : null;
  const hasMeasurement = measuredPct !== null;
  const scorecardKind = scorecard?.kind ?? null;
  const state: PredictionOutcomeState = hasMeasurement
    ? scorecardKind === "no-signal" || scorecardKind === "no-lever" || scorecardKind === "unmeasurable"
      ? "no-signal"
      : "measured"
    : prediction.verdict === null || scorecardKind === "gathering"
      ? "unresolved"
      : "no-signal";

  let statusTitle: string;
  let statusDetail: string;
  if (state === "measured") {
    statusTitle = scorecard?.presentation.label ?? "Measured outcome";
    statusDetail = scorecard?.presentation.caveat
      ?? "The engine produced a measured outcome for the activation-time commitment.";
  } else if (state === "unresolved") {
    statusTitle = scorecard?.presentation.label ?? "Outcome not measured yet";
    statusDetail = scorecard?.presentation.caveat
      ?? unresolvedDetail(observationCount, prediction.resolutionDate);
  } else if (hasMeasurement) {
    statusTitle = scorecard?.presentation.label ?? "No confident signal";
    statusDetail = `${scorecard?.presentation.caveat ?? "The engine did not classify this as a confident causal result."} The estimate is shown for context, not as a confident causal claim.`;
  } else if (scorecard?.kind === "measured") {
    statusTitle = "Measured result unavailable";
    statusDetail =
      "The prediction has a resolved verdict, but no numeric engine estimate is available to graph. No zero has been substituted.";
  } else {
    statusTitle = scorecard?.presentation.label ?? "No confident signal";
    statusDetail = scorecard?.presentation.caveat
      ?? "The engine did not produce a numeric result. No zero has been substituted.";
  }

  const axis = outcomeAxis([
    plannedPct,
    measuredPct,
    ci95Pct?.low ?? null,
    ci95Pct?.high ?? null,
  ]);
  const plannedLabel = plannedPct === null ? null : formatSignedPredictionPct(plannedPct);
  const measuredLabel = measuredPct === null ? null : formatSignedPredictionPct(measuredPct);
  const ci95Label = ci95Pct === null
    ? null
    : `95% CI ${formatSignedPredictionPct(ci95Pct.low)} to ${formatSignedPredictionPct(ci95Pct.high)}`;
  const ariaParts = [
    `${metricName}.`,
    plannedLabel === null
      ? "No activation-time commitment is available."
      : `Activation-time commitment ${plannedLabel} of the metric mean.`,
    measuredLabel === null
      ? "No numeric engine measurement is available."
      : `Engine measured ${measuredLabel} of the metric mean.`,
    ci95Label === null ? null : `${ci95Label}.`,
    statusTitle,
  ].filter((part): part is string => part !== null);

  return {
    metricName,
    state,
    plannedPct,
    plannedLabel,
    measuredPct,
    measuredLabel,
    ci95Pct,
    ci95Label,
    hasMeasurement,
    verdict: prediction.verdict,
    verdictLabel: scorecard?.presentation.label ?? null,
    statusTitle,
    statusDetail,
    axis,
    ariaLabel: ariaParts.join(" "),
  };
}
