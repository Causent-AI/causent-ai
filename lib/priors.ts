// On-the-fly priors (epic #6, child #9) — the "graph pays off at prediction #2"
// surface. v1 computes priors by reference-class query over stored resolution
// tuples: no ML, no learned decay (that is the deferred P2 platform track).
//
// Honesty rules:
//   - Include REFUTED + INCONCLUSIVE — a non-result is information ("this class
//     of change is noisy/unreliable"); filtering to CONFIRMED-only would be
//     survivorship bias.
//   - Weight numeric aggregates by belief_score — a confident outcome informs
//     the prior more than an inconclusive one. When NO tuple carries confident
//     weight, the weighted figures are null (never fabricated), while the raw
//     distribution (n/min/max) still describes the class.
//   - Empty class → { hasPrecedent: false } so the capture UI can honestly say
//     "no precedent yet — record your prior." (Elicit-not-assert: nothing here
//     ever GENERATES a prediction; it only describes what happened before.)

// PURE module (no DB, no server-only imports) so it stays unit-testable under
// node --test — the RLS-scoped query wrapper lives in lib/data/priors.ts,
// mirroring the ingest pure-core + adapter split.
import type { PredictionVerdict } from "./types";

/** One stored resolution outcome, as persisted in predictions.resolution_tuple. */
export type ResolutionTuple = {
  metricId: string;
  mechanismCategory: string | null;
  verdict: PredictionVerdict;
  /** The committed magnitude, %-of-mean, SIGNED by the predicted direction. */
  predictedPct: number;
  /** The measured lift, %-of-mean, signed; null when nothing was measurable. */
  measuredPct: number | null;
  /** The edge's belief score at resolution; null when belief was withheld. */
  beliefScore: number | null;
};

export type ReferenceClassPriors = {
  /** false = empty class: show "no precedent yet — record your prior". */
  hasPrecedent: boolean;
  /** Resolved tuples in the class (all verdicts — no survivorship filter). */
  supportCount: number;
  verdictCounts: Partial<Record<PredictionVerdict, number>>;
  evaluation: {
    measuredCount: number;
    confidentCount: number;
    coveragePct: number;
    meanAbsoluteErrorPct: number | null;
  };
  /** Distribution of measured lifts for the class (the base rate). */
  baseRate: {
    /** Tuples with a measured figure. */
    n: number;
    /** Belief-weighted mean measured %-of-mean; null if no confident weight. */
    weightedMeanPct: number | null;
    minPct: number | null;
    maxPct: number | null;
  };
  /** Signed error `predicted − measured` (e.g. "over-predicts activation ~2x"). */
  calibration: {
    n: number;
    /** Belief-weighted mean signed error; null if no confident weight. */
    weightedMeanErrorPct: number | null;
  };
};

const EMPTY: ReferenceClassPriors = {
  hasPrecedent: false,
  supportCount: 0,
  verdictCounts: {},
  evaluation: { measuredCount: 0, confidentCount: 0, coveragePct: 0, meanAbsoluteErrorPct: null },
  baseRate: { n: 0, weightedMeanPct: null, minPct: null, maxPct: null },
  calibration: { n: 0, weightedMeanErrorPct: null },
};

/** Pure prior computation over resolution tuples (unit-testable, no DB). */
export function computePriors(tuples: ResolutionTuple[]): ReferenceClassPriors {
  tuples = tuples.filter((t) => Number.isFinite(t.predictedPct)
    && (t.measuredPct === null || Number.isFinite(t.measuredPct))
    && (t.beliefScore === null || (Number.isFinite(t.beliefScore) && t.beliefScore >= 0 && t.beliefScore <= 1)));
  if (tuples.length === 0) return EMPTY;

  const verdictCounts: Partial<Record<PredictionVerdict, number>> = {};
  for (const t of tuples) {
    verdictCounts[t.verdict] = (verdictCounts[t.verdict] ?? 0) + 1;
  }

  const measured = tuples.filter(
    (t): t is ResolutionTuple & { measuredPct: number } => t.measuredPct !== null,
  );
  // 1.0 is the engine's passed-checks bucket, never a calibrated probability.
  const confident = measured.filter((t) => t.beliefScore === 1);

  let weightSum = 0;
  let weightedMeasured = 0;
  let weightedError = 0;
  for (const t of measured) {
    const w = t.beliefScore ?? 0;
    weightSum += w;
    weightedMeasured += w * t.measuredPct;
    weightedError += w * (t.predictedPct - t.measuredPct);
  }

  return {
    hasPrecedent: true,
    supportCount: tuples.length,
    verdictCounts,
    evaluation: {
      measuredCount: measured.length,
      confidentCount: confident.length,
      coveragePct: 100 * confident.length / tuples.length,
      meanAbsoluteErrorPct: confident.length
        ? confident.reduce((sum, t) => sum + Math.abs(t.predictedPct - t.measuredPct), 0) / confident.length
        : null,
    },
    baseRate: {
      n: measured.length,
      weightedMeanPct: confident.length && weightSum > 0 ? weightedMeasured / weightSum : null,
      minPct: measured.length ? Math.min(...measured.map((t) => t.measuredPct)) : null,
      maxPct: measured.length ? Math.max(...measured.map((t) => t.measuredPct)) : null,
    },
    calibration: {
      n: measured.length,
      weightedMeanErrorPct: confident.length && weightSum > 0 ? weightedError / weightSum : null,
    },
  };
}

/** Map a stored resolution_tuple (resolve.py's shape) to a ResolutionTuple. */
export function fromStoredTuple(row: {
  resolved_verdict: string;
  resolution_tuple: Record<string, unknown> | null;
}): ResolutionTuple | null {
  const tup = row.resolution_tuple;
  if (!tup) return null;
  if (!["CONFIRMED", "DIRECTION_CONFIRMED", "REFUTED", "INCONCLUSIVE", "UNRESOLVABLE", "VOIDED", "UNATTRIBUTED"].includes(row.resolved_verdict)) return null;
  // Observational changes cannot calibrate predictions about work or AI effects.
  if (tup.interpretation) return null;
  const mag = typeof tup.predicted_magnitude_pct === "number" ? tup.predicted_magnitude_pct : null;
  if (tup.predicted_direction !== "NEGATIVE" && tup.predicted_direction !== "POSITIVE") return null;
  const dir = tup.predicted_direction === "NEGATIVE" ? -1 : 1;
  if (mag === null || !Number.isFinite(mag) || mag < 0) return null;
  if (tup.measured_pct != null && (typeof tup.measured_pct !== "number" || !Number.isFinite(tup.measured_pct))) return null;
  if (tup.belief_score != null && (typeof tup.belief_score !== "number" || !Number.isFinite(tup.belief_score) || tup.belief_score < 0 || tup.belief_score > 1)) return null;
  return {
    metricId: typeof tup.metric_id === "string" ? tup.metric_id : "",
    mechanismCategory:
      typeof tup.mechanism_category === "string" ? tup.mechanism_category : null,
    verdict: row.resolved_verdict as PredictionVerdict,
    predictedPct: dir * mag,
    measuredPct: typeof tup.measured_pct === "number" ? tup.measured_pct : null,
    beliefScore: typeof tup.belief_score === "number" ? tup.belief_score : null,
  };
}
