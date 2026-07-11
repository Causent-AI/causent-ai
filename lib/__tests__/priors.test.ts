// Unit tests for the pure prior computation (epic #6, child #9).
// The honesty properties under test:
//   1. REFUTED + INCONCLUSIVE are INCLUDED (no survivorship bias).
//   2. Aggregates are belief-weighted (1.0 moves the prior more than 0.5).
//   3. An empty class is an explicit "no precedent", never a fabricated number.
//   4. Calibration is the signed error predicted − measured.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePriors, type ResolutionTuple } from "../priors.ts";

function tuple(over: Partial<ResolutionTuple>): ResolutionTuple {
  return {
    metricId: "arr",
    mechanismCategory: "monetization",
    verdict: "CONFIRMED",
    predictedPct: 10,
    measuredPct: 10,
    beliefScore: 1.0,
    ...over,
  };
}

describe("computePriors", () => {
  it("empty class → hasPrecedent false, no fabricated figures", () => {
    const p = computePriors([]);
    assert.equal(p.hasPrecedent, false);
    assert.equal(p.supportCount, 0);
    assert.equal(p.baseRate.weightedMeanPct, null);
    assert.equal(p.calibration.weightedMeanErrorPct, null);
  });

  it("base rate + calibration for a single confident tuple", () => {
    const p = computePriors([tuple({ predictedPct: 12, measuredPct: 8 })]);
    assert.equal(p.hasPrecedent, true);
    assert.equal(p.supportCount, 1);
    assert.equal(p.baseRate.n, 1);
    assert.equal(p.baseRate.weightedMeanPct, 8);
    assert.equal(p.calibration.weightedMeanErrorPct, 4); // over-predicted by 4pp
  });

  it("includes REFUTED in the base rate (a REFUTED row shifts the distribution)", () => {
    const confirmedOnly = computePriors([tuple({ measuredPct: 10 })]);
    const withRefuted = computePriors([
      tuple({ measuredPct: 10 }),
      tuple({ verdict: "REFUTED", predictedPct: -3, measuredPct: 14 }),
    ]);
    assert.notEqual(
      withRefuted.baseRate.weightedMeanPct,
      confirmedOnly.baseRate.weightedMeanPct,
    );
    assert.equal(withRefuted.verdictCounts.REFUTED, 1);
    assert.equal(withRefuted.supportCount, 2);
  });

  it("includes INCONCLUSIVE in support even with nothing measured", () => {
    const p = computePriors([
      tuple({ measuredPct: 10 }),
      tuple({ verdict: "INCONCLUSIVE", measuredPct: null, beliefScore: 0 }),
    ]);
    assert.equal(p.supportCount, 2);
    assert.equal(p.verdictCounts.INCONCLUSIVE, 1);
    assert.equal(p.baseRate.n, 1); // only the measured tuple enters the distribution
  });

  it("belief-weights: a 1.0 tuple moves the prior more than a 0.5 tuple", () => {
    const p = computePriors([
      tuple({ measuredPct: 10, beliefScore: 1.0 }),
      tuple({ verdict: "INCONCLUSIVE", measuredPct: 40, beliefScore: 0.5 }),
    ]);
    // weighted mean = (1.0*10 + 0.5*40) / 1.5 = 20 — closer to the confident 10
    // than the unweighted mean (25) would be.
    assert.equal(p.baseRate.weightedMeanPct, 20);
    assert.ok(p.baseRate.weightedMeanPct! < 25);
  });

  it("all-zero belief → weighted figures null, distribution still described", () => {
    const p = computePriors([
      tuple({ verdict: "INCONCLUSIVE", measuredPct: 7, beliefScore: 0 }),
      tuple({ verdict: "INCONCLUSIVE", measuredPct: -3, beliefScore: null }),
    ]);
    assert.equal(p.hasPrecedent, true);
    assert.equal(p.baseRate.weightedMeanPct, null); // no confident weight — no invented mean
    assert.equal(p.baseRate.n, 2);
    assert.equal(p.baseRate.minPct, -3);
    assert.equal(p.baseRate.maxPct, 7);
  });

  it("negative-direction predictions carry their sign into calibration", () => {
    // Predicted −3 (down), measured +13.5 (up): error = −16.5 — badly wrong, signed.
    const p = computePriors([
      tuple({ verdict: "REFUTED", predictedPct: -3, measuredPct: 13.5 }),
    ]);
    assert.equal(p.calibration.weightedMeanErrorPct, -16.5);
  });
});
