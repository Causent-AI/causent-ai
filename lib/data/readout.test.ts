import assert from "node:assert/strict";
import test from "node:test";
import type { Metric } from "../types.ts";
import type { EdgeReadout } from "./graph.ts";
import { toImpactCell } from "./readout.ts";

const metric: Metric = {
  id: "adoption",
  name: "Adoption Rate",
  format: "percent",
  source: "CSV",
  color: "#00A29C",
  cadence: "Daily",
  lastUpdated: "2026-07-22T00:00:00.000Z",
  rows: 1,
  higherIsBetter: true,
  series: [{ date: "2026-07-22", value: 0.31 }],
};

function edge(overrides: Partial<EdgeReadout> = {}): EdgeReadout {
  return {
    actionId: "action",
    metricId: "metric",
    dbDirection: "INCONCLUSIVE",
    beliefScore: null,
    beliefReason: "INSUFFICIENT_HISTORY",
    lift: null,
    ciLow: null,
    ciHigh: null,
    nPre: 30,
    nPost: 24,
    descriptiveLift: 0.0310214,
    descriptiveCiLow: 0.0201683,
    descriptiveCiHigh: 0.0418745,
    descriptiveNPre: 14,
    descriptiveNPost: 14,
    descriptiveClustered: true,
    ...overrides,
  };
}

test("shows the 14-day descriptive estimate while ITS gathers history", () => {
  const cell = toImpactCell(metric, edge());
  assert.equal(cell.label, "+3.1pp");
  assert.equal(cell.direction, "up");
  assert.equal(cell.evidence, "descriptive");
  assert.deepEqual(cell.readout, {
    methodology: "BEFORE_AFTER_14D",
    ciLow: 2.01683,
    ciHigh: 4.18745,
    nPre: 14,
    nPost: 14,
    beliefReason: "INSUFFICIENT_HISTORY",
  });
  assert.match(cell.detail ?? "", /Not a causal claim/);
  assert.match(cell.detail ?? "", /Overlaps another completed action/);
});

test("a confident ITS estimate remains authoritative", () => {
  const cell = toImpactCell(metric, edge({
    dbDirection: "POSITIVE",
    beliefScore: 1,
    beliefReason: null,
    lift: 0.052,
    ciLow: 0.041,
    ciHigh: 0.063,
    nPre: 75,
    nPost: 47,
  }));
  assert.equal(cell.label, "+5.2pp");
  assert.equal(cell.evidence, "causal");
  assert.deepEqual(cell.readout, {
    methodology: "ITS",
    ciLow: 4.1000000000000005,
    ciHigh: 6.3,
    nPre: 75,
    nPost: 47,
    beliefReason: null,
  });
});

test("does not promote descriptive evidence for a falsified causal readout", () => {
  const cell = toImpactCell(metric, edge({ beliefScore: 0, beliefReason: "PLACEBO" }));
  assert.equal(cell.label, "—");
  assert.equal(cell.value, null);
  assert.equal(cell.readout?.methodology, "ITS");
  assert.equal(cell.readout?.beliefReason, "PLACEBO");
});
