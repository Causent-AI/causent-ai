import assert from "node:assert/strict";
import test from "node:test";
import type { Metric } from "../types.ts";
import type { EdgeReadout } from "./graph.ts";
import { summarizeMetricImpact, summarizeObservedImprovement } from "./impact-summary.ts";
const metric: Metric = {
  id: "m", name: "Failure rate", format: "percent", percentScale: "points", definitionId: "d",
  beneficialDirection: "lower", higherIsBetter: false, source: "CSV", color: "#000000",
  cadence: "Daily", lastUpdated: "2026-09-01", rows: 1, series: [{date: "2026-09-01",value: 0.5}],
};
const edge: EdgeReadout = {
  actionId: "a", metricId: "m", provenance: "computed", interpretation: "observational",
  dbDirection: "POSITIVE", beliefScore: 1, beliefReason: null, lift: 0.1,
  ciLow: 0.08, ciHigh: 0.12, nPre: 50, nPost: 60, descriptiveLift: null,
  descriptiveCiLow: null, descriptiveCiHigh: null, descriptiveNPre: null,
  descriptiveNPost: null, descriptiveClustered: false,
};
test("workspace summary preserves explicit percent scale and desired direction", () => {
  assert.equal(summarizeMetricImpact([metric],[edge])[0].label, "+0.1pp");
  assert.equal(summarizeMetricImpact([metric],[edge])[0].good, false);
  assert.equal(summarizeMetricImpact([{...metric,percentScale:"ratio"}],[edge])[0].label, "+10.0pp");
});
test("legacy and unconfirmed measurements cannot enter workspace summaries", () => {
  assert.equal(summarizeMetricImpact([metric],[{...edge,interpretation:"legacy_unverified"}])[0].label, "—");
  assert.equal(summarizeMetricImpact([{...metric,definitionId:null,percentScale:"unknown"}],[edge])[0].label, "—");
  assert.equal(summarizeObservedImprovement([{...metric,beneficialDirection:"unknown"}],[edge])[0].value, "—");
});
test("distinct registered windows are not summed into a claimed net effect", () => {
  const rows = summarizeMetricImpact([metric],[edge,{...edge,actionId:"another-activation"}]);
  assert.equal(rows[0].label,"—");
  assert.equal(rows[0].direction,"neutral");
});
