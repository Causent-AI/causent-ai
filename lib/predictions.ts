// Pure validation for the prediction-capture flow (epic #6, #10).
// Elicit-not-assert is structural here: nothing in this module (or anywhere in
// the capture path) generates, suggests, or pre-fills a magnitude — it only
// validates what the HUMAN committed.

export type PredictionInput = {
  metricId: string;
  direction: "POSITIVE" | "NEGATIVE";
  /** %-of-metric-mean, as committed by the team. */
  magnitudePctMean: number;
  /** ISO yyyy-mm-dd. */
  resolutionDate: string;
  /** null = no lever mapped (allowed, but resolves UNATTRIBUTED). */
  leverActionId: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Hard errors — the commit is blocked until these are empty. */
export function validatePrediction(input: PredictionInput): string[] {
  const errors: string[] = [];
  if (!input.metricId) errors.push("Pick the metric this prediction is about.");
  if (input.direction !== "POSITIVE" && input.direction !== "NEGATIVE") {
    errors.push("Commit a direction: up (POSITIVE) or down (NEGATIVE).");
  }
  if (
    typeof input.magnitudePctMean !== "number" ||
    !Number.isFinite(input.magnitudePctMean) ||
    input.magnitudePctMean <= 0
  ) {
    errors.push("Commit a magnitude as a positive % of the metric's mean.");
  }
  if (!ISO_DATE.test(input.resolutionDate) || Number.isNaN(Date.parse(input.resolutionDate))) {
    errors.push("Set a resolution date (yyyy-mm-dd) — the day the engine measures this.");
  }
  return errors;
}

/**
 * Soft warnings — surfaced at commit, never blocking. The UNATTRIBUTED warning
 * is load-bearing: a prediction with no lever has nothing to measure.
 */
export function predictionWarnings(input: PredictionInput): string[] {
  const warnings: string[] = [];
  if (input.leverActionId === null) {
    warnings.push(
      "No lever mapped — without the action that carries the mechanism, this prediction resolves UNATTRIBUTED (nothing to measure).",
    );
  }
  return warnings;
}

/**
 * v1 one-lever invariant, UI side: a decision carries at most ONE lever (it
 * levers all of the decision's predictions). Returns "set" when no lever
 * exists, "replace" when the candidate would swap the current lever, "noop"
 * when the candidate already is the lever. The server action applies
 * set/replace atomically (clear-then-set), so two levers can never coexist —
 * the resolution runner's LeverConflictError stays a backstop, not a path.
 */
export function leverChange(
  currentLeverActionId: string | null,
  candidateActionId: string,
): "set" | "replace" | "noop" {
  if (currentLeverActionId === null) return "set";
  return currentLeverActionId === candidateActionId ? "noop" : "replace";
}

/** A revision requires a logged reason — a revision is data, not a failure. */
export function validateRevision(params: {
  newMagnitudePct: number;
  reason: string;
}): string[] {
  const errors: string[] = [];
  if (
    typeof params.newMagnitudePct !== "number" ||
    !Number.isFinite(params.newMagnitudePct) ||
    params.newMagnitudePct <= 0
  ) {
    errors.push("The revised magnitude must be a positive % of the metric's mean.");
  }
  if (!params.reason || params.reason.trim().length < 5) {
    errors.push("Log why the prediction changed — the reason is part of the record.");
  }
  return errors;
}
