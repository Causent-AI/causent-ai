import assert from "node:assert/strict";
import test from "node:test";

import { calculateNativePredictionTarget } from "./prediction-calibration.ts";

test("calculates an implied target while retaining percent-of-mean semantics", () => {
  const result = calculateNativePredictionTarget({
    baselineNative: 100,
    format: "count",
    direction: "NEGATIVE",
    magnitudePctMean: 12.5,
  });
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.signedMagnitudePctMean, -12.5);
  assert.equal(result.deltaNative, -12.5);
  assert.equal(result.impliedTargetNative, 87.5);
  assert.equal(result.baselineLabel, "100");
  assert.equal(result.impliedTargetLabel, "88");
});

test("formats ratio percentages and currency on their native display scales", () => {
  const percent = calculateNativePredictionTarget({
    baselineNative: 0.4,
    format: "percent",
    percentScale: "ratio",
    direction: "POSITIVE",
    magnitudePctMean: 25,
  });
  assert.equal(percent.available, true);
  if (percent.available) {
    assert.equal(percent.impliedTargetNative, 0.5);
    assert.equal(percent.baselineLabel, "40.0%");
    assert.equal(percent.impliedTargetLabel, "50.0%");
  }

  const currency = calculateNativePredictionTarget({
    baselineNative: 200_000,
    format: "currency",
    direction: "POSITIVE",
    magnitudePctMean: 10,
  });
  assert.equal(currency.available, true);
  if (currency.available) assert.equal(currency.impliedTargetNative, 220_000);
});

test("refuses to imply a native target without a usable baseline", () => {
  assert.deepEqual(calculateNativePredictionTarget({
    baselineNative: null,
    format: "count",
    direction: "POSITIVE",
    magnitudePctMean: 10,
  }), { available: false, reason: "missing-baseline" });
  assert.deepEqual(calculateNativePredictionTarget({
    baselineNative: 0,
    format: "count",
    direction: "POSITIVE",
    magnitudePctMean: 10,
  }), { available: false, reason: "zero-baseline" });
});
