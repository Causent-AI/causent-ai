import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPredictionOutcomeViewModel,
  formatSignedPredictionPct,
} from "./scorecard-chart.ts";
import type { Prediction } from "./types.ts";

function prediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: "prediction-1",
    metricId: "activation",
    direction: "POSITIVE",
    magnitudePctMean: 13.5,
    resolutionDate: "2026-09-15",
    committedAt: "2026-07-01",
    verdict: null,
    resolvedAt: null,
    measuredPct: null,
    revisions: [],
    ...overrides,
  };
}

test("measured outcome keeps the signed commitment and normalizes the native 95% CI", () => {
  const view = buildPredictionOutcomeViewModel({
    metricName: "Activation rate",
    prediction: prediction({
      verdict: "CONFIRMED",
      measuredPct: 13,
      resolutionTuple: {
        pre_window_mean: 2_000,
        measured_pct: 13,
        measured_lift: 260,
        ci_low: 200,
        ci_high: 320,
        verdict: "CONFIRMED",
      },
    }),
  });

  assert.equal(view.state, "measured");
  assert.equal(view.hasMeasurement, true);
  assert.equal(view.plannedPct, 13.5);
  assert.equal(view.plannedLabel, "+13.5%");
  assert.equal(view.measuredPct, 13);
  assert.equal(view.measuredLabel, "+13.0%");
  assert.deepEqual(view.ci95Pct, { low: 10, high: 16 });
  assert.equal(view.ci95Label, "95% CI +10.0% to +16.0%");
  assert.ok(view.axis.minPct < 0, "zero must sit inside the graph domain");
  assert.ok(view.axis.maxPct > 16, "the graph domain must contain the CI");
  assert.ok(view.axis.zeroPositionPct > 0 && view.axis.zeroPositionPct < 100);
});

test("a negative human commitment stays negative while a refuting measurement keeps its engine sign", () => {
  const view = buildPredictionOutcomeViewModel({
    metricName: "Churn",
    prediction: prediction({
      direction: "NEGATIVE",
      magnitudePctMean: 5,
      verdict: "REFUTED",
      measuredPct: 2.25,
    }),
  });

  assert.equal(view.state, "measured");
  assert.equal(view.plannedPct, -5);
  assert.equal(view.measuredPct, 2.25);
  assert.equal(view.plannedLabel, "-5.0%");
  assert.equal(view.measuredLabel, "+2.3%");
  assert.equal(view.ci95Pct, null, "a missing tuple must not manufacture an interval");
  assert.ok(view.axis.minPct < -5);
  assert.ok(view.axis.maxPct > 2.25);
});

test("an inconclusive numeric estimate is graphable but remains a no-signal claim", () => {
  const view = buildPredictionOutcomeViewModel({
    metricName: "Activation rate",
    prediction: prediction({
      verdict: "INCONCLUSIVE",
      measuredPct: 1.2,
      resolutionTuple: {
        pre_window_mean: 100,
        measured_pct: 1.2,
        measured_lift: 1.2,
        ci_low: -0.5,
        ci_high: 3,
        verdict: "INCONCLUSIVE",
      },
    }),
  });

  assert.equal(view.state, "no-signal");
  assert.equal(view.hasMeasurement, true);
  assert.deepEqual(view.ci95Pct, { low: -0.5, high: 3 });
  assert.match(view.statusDetail, /not as a confident causal claim/i);
});

test("an unresolved prediction reports connected history without plotting zero", () => {
  const view = buildPredictionOutcomeViewModel({
    metricName: "Activation rate",
    observationCount: 91,
    prediction: prediction(),
  });

  assert.equal(view.state, "unresolved");
  assert.equal(view.hasMeasurement, false);
  assert.equal(view.measuredPct, null);
  assert.equal(view.measuredLabel, null);
  assert.match(view.statusDetail, /91 observations are connected/i);
  assert.match(view.statusDetail, /has not produced a measured outcome yet/i);
});

test("terminal no-result states preserve the engine reason and never invent a measurement", () => {
  const view = buildPredictionOutcomeViewModel({
    metricName: "Activation rate",
    prediction: prediction({ verdict: "UNMEASURABLE_NO_METRIC" }),
  });

  assert.equal(view.state, "no-signal");
  assert.equal(view.hasMeasurement, false);
  assert.equal(view.measuredPct, null);
  assert.equal(view.statusTitle, "No metric wired");
  assert.match(view.statusDetail, /never connected a data source/i);
});

test("partial or non-finite confidence bounds are omitted", () => {
  const view = buildPredictionOutcomeViewModel({
    metricName: "Activation rate",
    prediction: prediction({
      verdict: "CONFIRMED",
      measuredPct: 4,
      resolutionTuple: {
        pre_window_mean: 100,
        measured_pct: 4,
        ci_low: 2,
        ci_high: Number.NaN,
        verdict: "CONFIRMED",
      },
    }),
  });

  assert.equal(view.ci95Pct, null);
  assert.equal(view.ci95Label, null);
  assert.equal(formatSignedPredictionPct(0), "0.0%");
});
