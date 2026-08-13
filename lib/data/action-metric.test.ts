import assert from "node:assert/strict";
import test from "node:test";
import { metricUiIdForExpectedName } from "./action-metric.ts";

const metrics = [
  { id: "activation", name: "Activation Rate" },
  {
    id: "metric-42a75312-bda5-407b-a2cb-c8a7640b96a1",
    name: "First-week Setup Completion",
  },
];

test("resolves a report-created metric through its loaded UI identity", () => {
  assert.equal(
    metricUiIdForExpectedName(metrics, "First-week Setup Completion"),
    "metric-42a75312-bda5-407b-a2cb-c8a7640b96a1",
  );
});

test("resolves a configured metric and fails closed for absent names", () => {
  assert.equal(metricUiIdForExpectedName(metrics, "Activation Rate"), "activation");
  assert.equal(metricUiIdForExpectedName(metrics, "activation rate"), null);
  assert.equal(metricUiIdForExpectedName(metrics, null), null);
});
